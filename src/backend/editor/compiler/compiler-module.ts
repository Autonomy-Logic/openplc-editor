import { exec, spawn } from 'node:child_process'
import crypto, { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { join } from 'node:path'
import { promisify } from 'node:util'

// strucpp is loaded lazily because it uses ESM features (import.meta) that are
// incompatible with Jest's CJS transform — see `backend/shared/library/strucpp-runtime`.
// Only the `CompileError` type leaks into this module's surface (via the
// `handleOutputData` callback) — every other strucpp interaction goes through
// the shared `runProgramBuildPipeline`.
type StrucppCompileError = import('strucpp').CompileError

import { buildArduinoCliCompileArgs } from '@root/backend/shared/firmware/build-arduino-cli-args'
import {
  describeIncompatibleRuntime,
  isStrucppCompatibleRuntime,
} from '@root/backend/shared/firmware/runtime-version-gate'
import {
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  prepareXmlForLibraryBuild,
} from '@root/backend/shared/library/build-pipeline'
import { deployRuntimeProgram } from '@root/backend/shared/library/deploy-runtime-program'
import { buildKnownPous } from '@root/backend/shared/library/program-build-helpers'
import { runProgramBuildPipeline } from '@root/backend/shared/library/program-build-pipeline'
import { loadStrucpp } from '@root/backend/shared/library/strucpp-runtime'
import type { KnownPou } from '@root/backend/shared/utils/PLC/split-program-st'

/**
 * Shared bridge contract between `compileLibrary` and its inner
 * `runVerificationCompile` step.  Both paths talk to the same
 * runtime API and library-resolution helper.  `loadEnabledArchives`
 * resolves project-enabled library names to parsed `.stlib`
 * archives — bundled libs are always-included, user-installed
 * subset is filtered by name, missing-but-enabled names come back
 * for the caller to surface as a pre-compile error.  The same call
 * feeds the program build (`strucpp.compile`'s `libraries:` option)
 * and the library build (`compileStlib`'s dependency list), so
 * there's exactly one resolution path and no chance of the program
 * compile seeing a different library set than the verification
 * compile.
 */
type LibraryCompileBridge = {
  makeRuntimeApiRequest: <T = void>(
    ipAddress: string,
    jwtToken: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
  loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
}

type LibraryVerificationBridge = LibraryCompileBridge

/**
 * Project data with the optional C++ POU sidecar attached. The base
 * PLCProjectData type doesn't carry C++ POUs because they're an
 * editor-side editor-only artefact; we splice them in for the compile
 * pipeline. Centralised here so the cast appears once instead of
 * inline at every read site.
 */
type ProjectDataWithCppPous = PLCProjectData & {
  originalCppPous?: CppPouDataCode[]
}

/**
 * Post-build PLC start retry loop bounds. Why these numbers:
 *   - 5000 ms total: longer than the slowest STOP transition observed
 *     end-to-end (worst case ~3 s on a Pi 4 with EtherCAT teardown).
 *   - 150 ms poll: tight enough to feel responsive, loose enough to
 *     avoid hammering the runtime's unix socket.
 * If the runtime ABI changes the STOP transition pattern (e.g. adds
 * an explicit "ready for START" event), retire this loop.
 */
const POST_BUILD_START_TIMEOUT_MS = 5000
const POST_BUILD_START_POLL_INTERVAL_MS = 150

import { assertPathContained } from '@root/backend/editor/utils/path-containment'
import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { generateEthercatConfig } from '@root/backend/shared/ethercat/generate-ethercat-config'
import { validateEthercatConfig } from '@root/backend/shared/ethercat/validate-ethercat-config'
import type { DeviceConfiguration, DevicePin } from '@root/backend/shared/types/PLC/devices'
import type { PLCProject, PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import {
  type CppPouData as CppPouDataCode,
  generateCBlocksCode,
} from '@root/backend/shared/utils/cpp/generateCBlocksCode'
import {
  type CppPouData as CppPouDataHeader,
  generateCBlocksHeader,
} from '@root/backend/shared/utils/cpp/generateCBlocksHeader'
import { generateModbusMasterConfig } from '@root/backend/shared/utils/modbus/generate-modbus-master-config'
import { validatePathId } from '@root/backend/shared/utils/path-safety'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import { parsePlcStatus } from '@root/backend/shared/utils/plc-status'
import { generateVendorPluginConfig } from '@root/backend/shared/utils/vpp/generate-vendor-plugin-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { generateModbusSlaveConfig } from '@root/frontend/utils/modbus/generate-modbus-slave-config'
import { generateOpcUaConfig, OpcUaConfigError } from '@root/frontend/utils/opcua'
import { generateS7CommConfig } from '@root/frontend/utils/s7comm'
import type { CompileLibraryResult, PlatformOption } from '@root/middleware/shared/ports/types'
import { composeRuntimeV4Bundle } from '@root/middleware/shared/utils/library/compose-runtime-v4-bundle'
import { app as electronApp, dialog, MessageChannelMain } from 'electron'
import type { MessagePortMain } from 'electron/main'
import JSZip from 'jszip'

import type { PackageManifest } from '../package-manager'
import { type BoardBuildInfo, BoardInfoResolver } from '../hardware'
import { PackageManagerModule } from '../package-manager'
import { CreateXMLFile } from '../utils'
import type { ArduinoCoreControl, HalsFile, ToolchainProperties } from './types'

interface MethodsResult<T> {
  success: boolean
  data?: T
}
type HandleOutputDataCallback = (chunk: Buffer | string, logLevel?: 'info' | 'error') => void

/**
 * Decode a `MessagePortMain` payload back to a string, handling the
 * forms a Node `Buffer` survives V8's structured clone as:
 *
 *   - `string` — passthrough.
 *   - `Uint8Array` / `ArrayBuffer` — typed-array decode (this is the
 *     shape Buffers ride as when the channel stays inside the main
 *     process; `.toString()` on a Uint8Array returns the comma-
 *     separated number list and was the cause of the `[verify]
 *     67,111,109,…` console flood).
 *   - `{ type: 'Buffer', data: number[] }` — Electron's IPC
 *     serialisation form, same shape `decodeMessage` in the
 *     `compiler-adapter` already handles.
 *   - anything else — `String(...)` fallback.
 */
function decodePortMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw)
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw))
  if (raw && typeof raw === 'object' && 'type' in raw) {
    const obj = raw as Record<string, unknown>
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return new TextDecoder().decode(new Uint8Array(obj.data as number[]))
    }
  }
  return String(raw)
}

type CompileArduinoProgramArgs = {
  boardTarget: string
  boardHalsContent: HalsFile[string]
  compilationPath: string
  handleOutputData: HandleOutputDataCallback
  cleanBuild?: boolean
}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string
  halsFilePath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  xml2stBinaryPath: string

  strucppRuntimeDir: string

  // Memoised arduino-cli `--show-properties=expanded` output keyed by FQBN.
  // Resetting requires a fresh CompilerModule instance — adequate for the
  // MVP where the editor recreates the module per compile session.
  #toolchainPropsCache: Map<string, ToolchainProperties> = new Map()

  // ############################################################################
  // =========================== Static properties ==============================
  // ############################################################################
  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  static readonly DEVELOPMENT_MODE = process.env.NODE_ENV === 'development'
  // This will later be replaced by platform specific libraries
  static readonly GLOBAL_LIBRARIES = [
    'Arduino_EdgeControl',
    'ArduinoJson',
    'Arduino_MachineControl',
    'ArduinoMqttClient',
    'AVR_PWM',
    'CAN',
    'CONTROLLINO',
    'DallasTemperature',
    'Ethernet',
    'megaAVR_PWM',
    'OneWire',
    'P1AM',
    'Portenta_H7_PWM',
    'PubSubClient',
    'RP2040_PWM',
    'SAMD_PWM',
    'SAMDUE_PWM',
    'STM32_CAN',
    'STM32_PWM',
    'WiFiNINA',
  ]

  // Runtime API polling configuration (important-comment)
  // 20 minutes — large projects (50+ POUs) on a Pi 4 can take 10–15 min
  // to compile generated.cpp + generated_debug.cpp at -O1, so 5 min was
  // cutting off legitimate builds. The runtime side keeps emitting status
  // while alive; this is just an absolute ceiling. (important-comment)
  static readonly COMPILATION_STATUS_TIMEOUT_MS = 20 * 60 * 1000
  static readonly COMPILATION_STATUS_POLL_INTERVAL_MS = 1000 // 1 second (important-comment)

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()
    this.halsFilePath = this.#constructHalsFilePath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.xml2stBinaryPath = this.#constructXml2stBinaryPath()

    this.strucppRuntimeDir = this.#constructStrucppRuntimeDir()
  }

  // ############################################################################
  // =========================== Static methods =================================
  // ############################################################################
  static async readJSONFile<T>(filePath: string): Promise<T> {
    const data = await readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
  }

  /**
   * Append user-selected (or default) FQBN sub-options to the base platform
   * string. Used by handleCompileArduinoProgram and the orchestrator's
   * upload step to apply the VPP-declared `target.platformOptions` choices
   * the user made on the device screen (e.g. Nano `cpu=atmega328old`).
   *
   * Pure / deterministic: every key in `platformOptions` becomes a segment
   * `:<key>=<id>` appended in declaration order. Missing entries in
   * `selected` fall back to each option's `default`. Returns the input
   * `platform` verbatim when the manifest declares no platformOptions.
   */
  static applyPlatformOptions(
    platform: string,
    platformOptions: PlatformOption[] | undefined,
    selected: Record<string, string> | undefined,
  ): string {
    if (!platformOptions || platformOptions.length === 0) return platform
    const segments: string[] = []
    for (const opt of platformOptions) {
      const chosen = selected?.[opt.key] ?? opt.default
      segments.push(`${opt.key}=${chosen}`)
    }
    return `${platform}:${segments.join(':')}`
  }

  // Pure parser for `arduino-cli compile --show-properties=expanded` stdout.
  // Values can contain '=' (e.g. -DARDUINO=10607) so we split on the FIRST '='
  // only. Empty lines and lines without '=' are silently skipped.
  static parseShowPropertiesOutput(stdout: string): Record<string, string> {
    const properties: Record<string, string> = {}
    for (const line of stdout.split('\n')) {
      if (!line) continue
      const eqIdx = line.indexOf('=')
      if (eqIdx < 0) continue
      properties[line.slice(0, eqIdx)] = line.slice(eqIdx + 1)
    }
    return properties
  }

  // ############################################################################
  // =========================== Private methods ================================
  // ############################################################################

  private parseLogLevel(message: string): { level: 'info' | 'warning' | 'error'; cleanedMessage: string } {
    const logLevelMatch = message.match(/^\[(INFO|WARNING|ERROR)\]\s*/)

    if (logLevelMatch) {
      const level = logLevelMatch[1].toLowerCase() as 'info' | 'warning' | 'error'
      const cleanedMessage = message.replace(/^\[(INFO|WARNING|ERROR)\]\s*/, '')
      return {
        level,
        cleanedMessage,
      }
    }

    return {
      level: 'info',
      cleanedMessage: message,
    }
  }

  // Initialize paths based on the environment
  #constructBinaryDirectoryPath(): string {
    if (CompilerModule.HOST_ARCHITECTURE !== 'x64' && CompilerModule.HOST_ARCHITECTURE !== 'arm64') return ''
    const platformSpecificPath = join(CompilerModule.HOST_PLATFORM, CompilerModule.HOST_ARCHITECTURE)
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'bin',
      CompilerModule.DEVELOPMENT_MODE ? platformSpecificPath : '',
    )
  }

  #constructSourceDirectoryPath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
    )
  }

  #constructHalsFilePath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
      'boards',
      'hals.json',
    )
  }

  #constructArduinoCliBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'arduino-cli')
  }

  #constructXml2stBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'xml2st', CompilerModule.HOST_PLATFORM === 'darwin' ? 'xml2st' : '')
  }

  #constructStrucppRuntimeDir(): string {
    // strucpp's runtime headers (`src/runtime/include/`) live in two
    // places depending on whether we're running dev or a packaged app:
    //
    //   - **Dev** (`npm run dev`): read from the root install at
    //     `node_modules/strucpp/src/runtime/include` — that's what
    //     `scripts/download-binaries.ts` populates via `npm install
    //     <tarball> --no-save`.
    //
    //   - **Packaged**: read from `process.resourcesPath/strucpp/
    //     runtime/include` — copied there by electron-builder's
    //     `extraResources` config.  We *cannot* read from the asar's
    //     own node_modules because electron-builder packs the asar
    //     based on `release/app/package.json`'s dependency tree and
    //     strucpp isn't a declared dep (the version is pinned in
    //     `binary-versions.json` instead), so the package gets pruned
    //     out of the asar entirely.
    //
    // arduino-cli still only ever sees the destination copy under
    // `build/[target]/` after `copyStrucppRuntimeHeaders` runs.
    if (electronApp.isPackaged) {
      return join(process.resourcesPath, 'strucpp', 'runtime', 'include')
    }
    return join(electronApp.getAppPath(), 'node_modules', 'strucpp', 'src', 'runtime', 'include')
  }

  // Path to the empty sketch arduino-cli compiles against when extracting
  // toolchain properties via `--show-properties=expanded`. The sketch itself
  // is never linked — its only role is to give arduino-cli a valid sketch
  // structure so the recipe templates resolve.
  #constructShowPropertiesDummyPath(): string {
    return join(this.sourceDirectoryPath, 'show_properties_dummy')
  }

  /**
   * Resolve a board target to the arduino-cli core ID
   * (`arduino-cli core install` target — e.g. `arduino:avr`).
   *
   * Single source of truth: reads from `resources/sources/boards/
   * hals.json`, the same file the renderer's
   * `bridge.getAvailableBoards()` exposes via `boardInfo.core`.
   * Used internally by the library-project verification path so a
   * future hals.json edit (rename, new board, version bump)
   * propagates to verification automatically — without any code
   * change here.
   */
  async #getBoardCore(board: string): Promise<string | null> {
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    return halsFileContent[board]?.['core'] ?? null
  }

  /**
   * Pull the user's platformOption selections out of a project's
   * devices/configuration.json. Returns `{}` on any read/parse error —
   * a missing file or stale config without the field means the user
   * never touched the dropdown, so the compile path should fall back to
   * each manifest option's `default`.
   */
  async #readSelectedPlatformOptions(projectPath: string): Promise<Record<string, string>> {
    const configPath = join(projectPath, 'devices', 'configuration.json')
    try {
      const raw = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as { selectedPlatformOptions?: Record<string, string> }
      return parsed.selectedPlatformOptions ?? {}
    } catch {
      return {}
    }
  }

  async #getBoardRuntime(board: string) {
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    if (halsFileContent[board]) {
      return halsFileContent[board]['compiler']
    }

    // Fallback: check installed VPP packages for the board
    try {
      const packageManager = new PackageManagerModule()
      const installed = packageManager.listInstalled()
      for (const pkg of installed) {
        const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
        if (!manifest) continue
        for (const device of manifest.devices) {
          if (device.name === board) {
            return device.target.type === 'runtime-v4' ? 'openplc-compiler' : 'arduino-cli'
          }
        }
      }
    } catch {
      // ignore package manager errors
    }

    throw new Error(`Board "${board}" not found in hals.json or installed VPP packages`)
  }

  #executeXml2st(args: string[]) {
    let xml2stBinaryPath = this.xml2stBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      xml2stBinaryPath += '.exe'
    }
    return spawn(xml2stBinaryPath, args)
  }

  #executeArduinoCliCommand(args: string[]) {
    let arduinoCliBinaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      arduinoCliBinaryPath += '.exe'
    }
    return spawn(arduinoCliBinaryPath, args)
  }

  // ############################################################################
  // =========================== Public methods =================================
  // ############################################################################

  // ++ ========================= Utility methods ============================= ++

  getHostHardwareInfo() {
    return `
      System Architecture - ${process.arch}
      Operating System - ${process.platform}
      Processor - ${process.env.PROCESSOR_IDENTIFIER}
      Logical CPU Cores - ${os.cpus().length}
      CPU Frequency - ${os.cpus()[0].speed} MHz
      CPU Model - ${os.cpus()[0].model}
    `
  }

  async checkArduinoCliAvailability(): Promise<MethodsResult<string>> {
    let binaryPath = this.arduinoCliBinaryPath
    const [flag, configFilePath] = this.arduinoCliBaseParameters
    const executeCommand = promisify(exec)

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    // INFO: We use the version command to check if the arduino-cli is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await executeCommand(`"${binaryPath}" version ${flag} "${configFilePath}" --json`)
    if (stderr) {
      throw new Error(`Arduino CLI not available: ${stderr}`)
    }

    /**
     * Parses the JSON output from the Arduino CLI.
     * @example The output will be like:
     * {
     *  "Application": "arduino-cli",
     *  "VersionString": "x.y.z",
     *  "Commit": "commit-hash",
     *  "Status": "version-status",
     *  "Date": "release-date",
     * }
     * @updatedAt 17/07/2025
     */
    const stdoutAsJsonObject = JSON.parse(stdout) as Record<string, string>

    const { VersionString } = stdoutAsJsonObject

    return { success: true, data: VersionString }
  }

  checkStrucppAvailability(): MethodsResult<string> {
    try {
      const { getVersion } = loadStrucpp()
      return { success: true, data: getVersion() }
    } catch {
      throw new Error('STruC++ not available. Run "npm run setup:binaries" to install it.')
    }
  }

  async getArduinoInstalledCores() {
    const coreControlFilePath = join(electronApp.getPath('userData'), 'User', 'Runtime', 'arduino-core-control.json')
    const coreControlFileContent = await CompilerModule.readJSONFile<ArduinoCoreControl>(coreControlFilePath)
    return coreControlFileContent
  }

  async getArduinoInstalledLibraries() {
    const libraryControlFilePath = join(
      electronApp.getPath('userData'),
      'User',
      'Runtime',
      'arduino-library-control.json',
    )
    const libraryControlFileContent =
      await CompilerModule.readJSONFile<Array<Record<string, string>>>(libraryControlFilePath)

    const installedLibraries = libraryControlFileContent.map((lib) => Object.keys(lib)[0])

    return installedLibraries
  }

  /**
   * Ask arduino-cli to resolve every recipe property for a given FQBN and
   * return it as a typed struct. Backbone of the pre-compile pipeline:
   * because `recipe.cpp.o.pattern` / `recipe.c.o.pattern` / `recipe.ar.pattern`
   * arrive fully expanded (every {build.*} / {compiler.*} / {runtime.*}
   * already substituted), the editor can drive the toolchain directly with
   * only the per-TU placeholders (`{source_file}`, `{object_file}`,
   * `{includes}`, `{archive_file_path}`) left to fill in.
   *
   * Results are memoised in-process per FQBN — show-properties takes ~300 ms
   * on a warm arduino-cli and the same FQBN is queried multiple times within
   * a single compile session.
   */
  async extractToolchainProperties(fqbn: string): Promise<ToolchainProperties> {
    const cached = this.#toolchainPropsCache.get(fqbn)
    if (cached) return cached

    let binaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') binaryPath += '.exe'

    const dummySketchPath = this.#constructShowPropertiesDummyPath()
    const baseArgs = this.arduinoCliBaseParameters.map((p) => `"${p}"`).join(' ')
    const execAsync = promisify(exec)

    // `--show-properties=expanded` tells arduino-cli to evaluate every
    // `{var}` interpolation in `platform.txt` / `boards.txt` before printing
    // — without `=expanded`, recipes come back with raw `{compiler.path}`
    // placeholders that would be useless for direct toolchain invocation.
    const cmd = `"${binaryPath}" compile --fqbn "${fqbn}" --show-properties=expanded "${dummySketchPath}" ${baseArgs}`

    const { stdout } = await execAsync(cmd, { maxBuffer: 8 * 1024 * 1024 })

    const properties = CompilerModule.parseShowPropertiesOutput(stdout)
    const recipeCpp = properties['recipe.cpp.o.pattern']
    const recipeC = properties['recipe.c.o.pattern']
    const recipeAr = properties['recipe.ar.pattern']
    if (!recipeCpp || !recipeC || !recipeAr) {
      throw new Error(
        `arduino-cli --show-properties for "${fqbn}" returned an incomplete recipe set ` +
          `(cpp=${Boolean(recipeCpp)}, c=${Boolean(recipeC)}, ar=${Boolean(recipeAr)}). ` +
          `This usually means the core for this board is not installed.`,
      )
    }

    const props: ToolchainProperties = { fqbn, properties, recipeCpp, recipeC, recipeAr }
    this.#toolchainPropsCache.set(fqbn, props)
    return props
  }

  // ++ =========================== Defines.h methods ==========================++
  async createMD5Hash(content: string): Promise<string> {
    const crypto = await import('node:crypto')
    return crypto.createHash('md5').update(content).digest('hex')
  }
  // ++ ========================= Build Steps ================================= ++

  // +++++++++++++++++++++++++ Initialization Methods ++++++++++++++++++++++++++++
  async createBasicDirectories(
    projectFolderPath: string,
    boardTarget: string,
  ): Promise<MethodsResult<string | string[]>> {
    let result: MethodsResult<string | string[]> = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')

    // Clean the board directory to remove stale files from previous builds
    await fs.rm(boardDirectory, { recursive: true, force: true })

    // Recreate the directories
    const results = await Promise.all([
      mkdir(boardDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
    ])
    if (results[0] || results[1]) {
      result = { success: true, data: [boardDirectory, sourceDirectory] }
    } else {
      result = { success: true }
    }

    return result
  }

  // INFO: This method is a placeholder for copying static files.
  // `boardRuntime` is the runtime identifier from hals.json
  // (`arduino-cli` or `openplc-compiler`).  `isRuntimeV4` further
  // distinguishes v4 from v3 within the openplc-compiler family —
  // v4's c_blocks.h + strucpp_runtime headers come from
  // `composeRuntimeV4Bundle` in the v4 block, so the static pre-write
  // here would be a redundant scatter producer and is skipped.  v3
  // still needs the static c_blocks.h template + strucpp_runtime copy.
  async copyStaticFiles(
    compilationPath: string,
    boardRuntime: string,
    isRuntimeV4 = false,
  ): Promise<MethodsResult<string>> {
    const sourceTargetFolderPath = join(compilationPath, 'src')

    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'Baremetal')

    const filesToCopy: Promise<void>[] = []

    if (boardRuntime !== 'openplc-compiler') {
      // Arduino targets: headers go flat next to the sketch (Baremetal.ino
      // includes "iec_var.hpp" etc. directly).
      //
      // resources/sources/arduino/ also ships arduino_runtime_glue.{cpp,h}.
      // The glue owns g_config and every helper that touches strucpp types,
      // isolating them in a library translation unit that arduino-cli
      // compiles WITHOUT the <Arduino.h> prelude. The .ino sketch therefore
      // never has Arduino.h's macros (DEFAULT/HIGH/LOW/PI/B0..B7/…) and
      // strucpp library struct member names in the same TU — eliminating
      // the collisions that previously broke any project including OSCAT
      // blocks.
      filesToCopy.push(
        cp(staticArduinoFilesPath, sourceTargetFolderPath, { recursive: true }),
        this.copyStrucppRuntimeHeaders(sourceTargetFolderPath),
        cp(staticBaremetalFilesPath, join(compilationPath, 'examples', 'Baremetal'), { recursive: true }),
      )
    } else if (!isRuntimeV4) {
      // OpenPLC Runtime v3: legacy boardTarget that still consumes
      // c_blocks.h via `embedCBlocksInProgramSt`.  Keep the template
      // copy + strucpp_runtime headers under the same layout v4 had
      // historically — v3 doesn't go through the composer.
      const cBlocksHeaderPath = join(this.sourceDirectoryPath, 'arduino', 'c_blocks.h')
      filesToCopy.push(
        this.copyStrucppRuntimeHeaders(join(sourceTargetFolderPath, 'strucpp_runtime', 'include')),
        cp(cBlocksHeaderPath, join(sourceTargetFolderPath, 'c_blocks.h')),
      )
    }
    // Runtime v4 (openplc-compiler + !v3): no static copy here.  The
    // v4 block in `compileProgram` runs `composeRuntimeV4Bundle`
    // which produces c_blocks.h + strucpp_runtime/include/* as part
    // of the canonical upload-bundle file map.

    try {
      await Promise.all(filesToCopy)
      return { success: true, data: 'Static build files available' }
    } catch (error) {
      throw new Error(`Error copying static files: ${error as string}`)
    }
  }

  /**
   * Copy STruC++ C++ runtime headers to the target directory.
   * These headers are downloaded by scripts/download-binaries.ts from the STruC++ release.
   * Single recursive copy so any future subdirectory under
   * resources/strucpp/runtime/include/ propagates without code change.
   */
  private async copyStrucppRuntimeHeaders(targetDir: string): Promise<void> {
    const runtimeDir = this.strucppRuntimeDir
    try {
      await fs.access(runtimeDir)
    } catch {
      throw new Error(
        `STruC++ runtime headers not found at ${runtimeDir}. Run "npm run setup:binaries" to download them.`,
      )
    }
    // Ensure the target directory exists. v4 passes a nested path
    // (strucpp_runtime/include) that may not exist yet.
    await fs.mkdir(targetDir, { recursive: true })
    await cp(runtimeDir, targetDir, { recursive: true })
  }

  /**
   * Read STruC++ runtime headers off disk into the in-memory file map
   * `composeRuntimeV4Bundle` expects (keys `strucpp_runtime/include/<filename>`,
   * values = file content).  Mirror of openplc-web's `getStrucppRuntimeIncludeFiles()`
   * — the composer is platform-agnostic and takes the headers as a Record
   * so both repos can call it the same way.
   *
   * Flat directory (no subfolders) per the strucpp release layout —
   * `readdir(runtimeDir)` is enough; no recursive walk.
   */
  private async loadStrucppRuntimeHeaders(): Promise<Record<string, string>> {
    const runtimeDir = this.strucppRuntimeDir
    try {
      await fs.access(runtimeDir)
    } catch {
      throw new Error(
        `STruC++ runtime headers not found at ${runtimeDir}. Run "npm run setup:binaries" to download them.`,
      )
    }
    const entries = await readdir(runtimeDir, { withFileTypes: true })
    const files: Record<string, string> = {}
    await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const content = await readFile(join(runtimeDir, e.name), 'utf-8')
          files[`strucpp_runtime/include/${e.name}`] = content
        }),
    )
    return files
  }


  /**
   * Mirror the bundled avr-libstdcpp headers into a stable no-space
   * cache path so arduino-cli's compiler.cpp.extra_flags substitution
   * doesn't trip on a path containing spaces (common on macOS Electron
   * userData paths).
   *
   * The cache key includes the editor version, so an upgrade that
   * ships new headers self-invalidates. A presence check on a sentinel
   * file (cstdint, which has shipped since the avr-libstdcpp v1) keeps
   * the steady-state cost to a single existsSync per compile.
   */
  private async ensureAvrLibStdCppCache(): Promise<string> {
    const sourceDir = join(this.sourceDirectoryPath, 'avr-libstdcpp', 'include')
    const cacheDir = join(os.tmpdir(), `openplc-avr-libstdcpp-${electronApp.getVersion()}`, 'include')

    const sentinel = join(cacheDir, 'cstdint')
    if (existsSync(sentinel)) {
      return cacheDir
    }

    await fs.mkdir(cacheDir, { recursive: true })
    await cp(sourceDir, cacheDir, { recursive: true })
    return cacheDir
  }

  // +++++++++++++++++++++++++++ Compilation Methods +++++++++++++++++++++++++++++

  async handleGenerateXMLfromJSON(sourceTargetFolderPath: string, jsonData: PLCProjectData) {
    return new Promise<MethodsResult<{ xmlPath: string; xmlContent: string }>>((resolve, reject) => {
      const { data: xmlData } = XmlGenerator(jsonData as Parameters<typeof XmlGenerator>[0], 'old-editor')
      if (typeof xmlData !== 'string') {
        reject(new Error('XML data is not a string'))
        return
      }

      const xmlCreationResult = CreateXMLFile(sourceTargetFolderPath, xmlData, 'plc')

      if (xmlCreationResult.success) {
        resolve({ success: true, data: { xmlPath: sourceTargetFolderPath, xmlContent: xmlData } })
      } else {
        reject(new Error('Failed to create XML file'))
      }
    })
  }

  async handleTranspileXMLtoST(
    generatedXMLFilePath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      // `--keep-structs` tells xml2st to emit user-defined STRUCT data
      // types as native `TYPE name : STRUCT … END_STRUCT;` declarations
      // instead of rewriting them as FUNCTION_BLOCKs (matiec's legacy
      // workaround).  Strucpp parses STRUCT natively and rejects the FB
      // rewrite as a type-vs-instance mismatch — every program build in
      // the editor targets strucpp now, so we always set the flag.
      const executeCommand = this.#executeXml2st(['--generate-st', generatedXMLFilePath, '--keep-structs'])

      let stderrData = ''

      // INFO: We use the xml2st command to transpile the XML file to ST.
      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`ST file generated at: ${generatedXMLFilePath.replace('plc.xml', 'program.st')}`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`xml2st process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleCompileSTtoCpp(
    sourceTargetFolderPath: string,
    handleOutputData: (
      chunk: Buffer | string,
      logLevel?: 'info' | 'error',
      compileError?: StrucppCompileError,
    ) => void,
    options: {
      hasCBlocks?: boolean
      pous?: KnownPou[]
      /**
       * Pre-loaded `.stlib` archives — bundled libs plus the
       * project-enabled subset.  Resolved by the caller through
       * `mainProcessBridge.loadEnabledArchives(enabledNames)` so the
       * archive loading happens once and stays in the bridge layer
       * where the library manager lives; the compiler is purely
       * about feeding strucpp.  Empty array = no libraries (not even
       * bundled), which is intentional: the caller decides what's
       * available.
       */
      libraries: unknown[]
      /**
       * Names of libraries the project enables but the system pool
       * doesn't currently have on disk.  Surfaced as a pre-compile
       * error so the user gets a clear "open the Library Manager"
       * message instead of strucpp's per-symbol cascade.
       */
      missingLibraries?: string[]
    },
  ): Promise<{ md5Hash: string; strucppFiles: Record<string, string> }> {
    const stFilePath = join(sourceTargetFolderPath, 'program.st')
    const stSource = await readFile(stFilePath, { encoding: 'utf8' })

    handleOutputData('Compiling Structured Text to C++ with STruC++...', 'info')

    // Strucpp embeds the MD5 into the debug map so the editor can
    // detect stale layouts without re-reading program.st.  Computed
    // here because `node:crypto` is Electron-only — the web wrapper
    // computes the same hash via a portable implementation.
    const md5 = crypto.createHash('md5').update(stSource).digest('hex')

    // Strucpp invocation + per-POU split + error formatting lives in
    // `backend/shared/library/program-build-pipeline.ts` so the web
    // edition's compile adapter can call the same logic.  This
    // wrapper is only responsible for the Electron-side bits: load
    // the ST file off disk, pump pipeline output through the
    // editor's IPC log channel, write each returned artefact to the
    // project's build directory.
    const result = runProgramBuildPipeline({
      source: stSource,
      md5,
      pous: options.pous ?? [],
      libraries: options.libraries,
      missingLibraries: options.missingLibraries ?? [],
      hasCBlocks: options.hasCBlocks ?? false,
    })

    if (result.splitterFallbackMessage) {
      handleOutputData(result.splitterFallbackMessage, 'info')
    }

    if (!result.success) {
      // Emit one structured log entry per error so the renderer's
      // console can attach a click-to-open handler to each one.  The
      // formatted text is what the user sees; the third argument
      // carries the raw `CompileError` (pouName / section / bodyLine
      // / variableName / …) for navigation.  We then throw a short
      // marker so the outer catch posts only the high-level
      // "STruC++ compilation failed" line — without re-dumping every
      // error blob a second time through the catch's plain-message
      // path.
      handleOutputData('STruC++ compilation failed:', 'error')
      for (const err of result.errors) {
        handleOutputData(err.formatted, 'error', err.raw)
      }
      throw new Error('STruC++ compilation failed')
    }

    for (const warn of result.warnings) {
      handleOutputData(warn.formatted, 'info', warn.raw)
    }

    await Promise.all(
      result.files.map((f) =>
        writeFile(join(sourceTargetFolderPath, f.name), f.content, { encoding: 'utf8' }),
      ),
    )

    if (result.debugMapSummary) handleOutputData(result.debugMapSummary, 'info')
    handleOutputData(`C++ files generated at: ${sourceTargetFolderPath}`, 'info')
    handleOutputData(`Program MD5: ${result.md5Hash}`, 'info')

    // Strucpp pipeline output also returned as an in-memory file map
    // so callers building the runtime v4 upload bundle can feed
    // `composeRuntimeV4Bundle` without re-reading every artefact off
    // disk.  Disk writes stay for the Arduino path that consumes them
    // through arduino-cli.
    const strucppFiles: Record<string, string> = {}
    for (const f of result.files) strucppFiles[f.name] = f.content

    return { md5Hash: result.md5Hash, strucppFiles }
  }

  // Debug file generation and glue variable generation are no longer needed.
  // STruC++ generates located variable descriptors (locatedVars[]) in the C++ output,
  // and the Arduino sketch walks them dynamically for I/O binding.
  // The debugger will be redesigned in Phase 4.

  // TODO: This method is used to update the index of the Arduino core.
  // We should validate if this is necessary and if it works correctly.
  async handleCoreUpdateIndex(handleOutputData: HandleOutputDataCallback) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      let binaryPath = this.arduinoCliBinaryPath
      const [flag, configFilePath] = this.arduinoCliBaseParameters

      if (CompilerModule.HOST_PLATFORM === 'win32') {
        // INFO: On Windows, we need to add the .exe extension to the binary path.
        binaryPath += '.exe'
      }
      const executeCommand = spawn(binaryPath, ['core', 'update-index', flag, configFilePath])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleCoreInstallation(
    boardCore: string | null,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error') => void,
  ) {
    if (boardCore === null) return

    const isCoreInstalled = Object.keys(await this.getArduinoInstalledCores()).some((core) => core === boardCore)
    if (isCoreInstalled) {
      handleOutputData(`Core ${boardCore} is already installed.`, 'info')
      return
    }

    let binaryPath = this.arduinoCliBinaryPath

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, ['core', 'install', boardCore, ...this.arduinoCliBaseParameters])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  // Handle library installation
  // In the future, this method will be responsible for installing any missing libraries.
  // This should receive a list of libraries to install.
  async handleLibraryInstallation(handleOutputData: HandleOutputDataCallback) {
    // 1. Check what are the required libraries for the project - This will be the global libraries and the extra libraries that comes from the hals.json file.
    // This will be filled later, for now is just a placeholder.
    const extraLibraries: string[] = ['P1AM'] // We provide this value just for testing purposes.
    const requiredLibraries = Array.from(new Set([...CompilerModule.GLOBAL_LIBRARIES, ...extraLibraries]))

    // 2. Check if all required libraries are already installed
    const installedLibraries = await this.getArduinoInstalledLibraries()
    const missingLibraries = requiredLibraries.filter((lib) => !installedLibraries.includes(lib))

    if (missingLibraries.length === 0) {
      handleOutputData(`All required libraries are already installed.`, 'info')
      return
    }

    let binaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }

    // 3. If not installed, run the installation command
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, [
        'lib',
        'install',
        ...missingLibraries,
        ...this.arduinoCliBaseParameters,
      ])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          handleOutputData(`All libraries installed!`, 'info')
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
    // 4. Update the library index
  }

  // TODO: This method is used to update the index of the Arduino libraries.
  // We should validate if this is necessary and if it works correctly.
  async handleLibraryUpdateIndex(handleOutputData: HandleOutputDataCallback) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      let binaryPath = this.arduinoCliBinaryPath
      const [flag, configFilePath] = this.arduinoCliBaseParameters

      if (CompilerModule.HOST_PLATFORM === 'win32') {
        // INFO: On Windows, we need to add the .exe extension to the binary path.
        binaryPath += '.exe'
      }
      const executeCommand = spawn(binaryPath, ['lib', 'update-index', flag, configFilePath])

      let stderrData = ''

      executeCommand.stdout?.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      executeCommand.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      executeCommand.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Arduino CLI process exited with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleGenerateDefinitionsFile({
    projectPath,
    buildMD5Hash,
    boardTarget,
    boardRuntime,
    _handleOutputData,
  }: {
    projectPath: string
    boardTarget: string
    buildMD5Hash: string
    boardRuntime: string
    _handleOutputData: HandleOutputDataCallback
  }) {
    let DEFINES_CONTENT: string = ''

    // === Directories and files paths ===
    const devicesDirectoryPath = join(projectPath, 'devices')
    const devicesPinMappingFilePath = join(devicesDirectoryPath, 'pin-mapping.json')

    const buildTargetDirectoryPath = join(projectPath, 'build', boardTarget)

    const stProgramFilePath = join(buildTargetDirectoryPath, 'src', 'program.st')

    // defines.h lives alongside arduino.cpp in src/. The HAL templates
    // include it as plain "defines.h" so the file is found whether
    // arduino-cli compiles the source in place or moves it into its
    // sketch sandbox first. Avoids the directory-relative include
    // that broke on paths with spaces and on VM shared-folder mounts.
    const definitionsFilePath = join(buildTargetDirectoryPath, 'src', 'defines.h')

    // === Files contents that we need ===
    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    const devicePinMapping = await CompilerModule.readJSONFile<DevicePin[]>(devicesPinMappingFilePath)
    const stProgramFileContent = await readFile(stProgramFilePath, 'utf-8')

    // We extract the board entry from the hals file content to validate if it has the define property.
    const boardEntry = halsFileContent[boardTarget]

    // ===== Defines.h content generation =====

    // 1. We need to verify if the board entry in the hals.json file has the define property.
    if (boardEntry && boardEntry.define) {
      // 1.2. If it has the defines property, we will write a header and iterate over the defines to create the content for the defines.h file.
      DEFINES_CONTENT = '// Board defines\n'
      if (Array.isArray(boardEntry.define)) {
        // 1.3. If the defines property is an array, we will iterate over it and add each define to the content.
        boardEntry.define.forEach((define) => {
          DEFINES_CONTENT += `#define ${define}\n`
        })
      } else if (typeof boardEntry.define === 'string') {
        // 1.4. If the defines property is a string, we will add it directly to the content.
        DEFINES_CONTENT += `#define ${boardEntry.define}\n`
      }
    }

    // 2. If the board entry does not have the define property, we will just write a double line break to the file.
    DEFINES_CONTENT += '\n\n'

    // 3. Now we write the information for the defines.h file based on the device configuration and other preferences.

    /**
     * TODOS
     * 3. In the device configuration we need to verify why the values that should be null are being set to empty strings.
     * 4. We need to ensure that the pins are correctly sorted according to their address.
     */

    // 3.1. Program MD5
    DEFINES_CONTENT += '//Program MD5\n'
    DEFINES_CONTENT += `#define PROGRAM_MD5 "${buildMD5Hash}"`
    DEFINES_CONTENT += `\n\n`

    // 3.2. Simulator communication defines
    //
    // Baremetal/Arduino-family targets used to emit a full //Comms
    // Configuration block here, read from deviceConfigurationSchema's
    // communicationConfiguration field. That schema is gone — Arduino
    // targets will return as VPP packages and each package owns its
    // own defines emission. The only target still emitting communication
    // defines from the core compiler is the built-in simulator.
    if (boardRuntime === 'simulator') {
      // Simulator forces fixed Modbus RTU settings over emulated USART0.
      // On ATmega2560, Serial = USART0. avr8js bridges usart0.
      DEFINES_CONTENT += '//Comms Configuration\n'
      DEFINES_CONTENT += '#define SIMULATOR_MODE\n'
      DEFINES_CONTENT += '#define MBSERIAL_IFACE Serial\n'
      DEFINES_CONTENT += '#define MBSERIAL_BAUD 115200\n'
      DEFINES_CONTENT += '#define MBSERIAL_SLAVE 1\n'
      DEFINES_CONTENT += '#define MBSERIAL\n'
      DEFINES_CONTENT += '#define MODBUS_ENABLED\n'
      DEFINES_CONTENT += `\n\n`
    }

    // INFO: If null, only the define value
    // 3.3. IO Config defines
    DEFINES_CONTENT += '//IO Config\n'
    // INFO: This approach assumes that the pins are sorted.
    const digitalInputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalInput')
    const analogInputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogInput')
    const digitalOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'digitalOutput')
    const analogOutputPins = devicePinMapping.filter((pin) => pin.pinType === 'analogOutput')

    DEFINES_CONTENT += `#define PINMASK_DIN ${digitalInputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_AIN ${analogInputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_DOUT ${digitalOutputPins.map(({ pin }) => pin).join(', ')}\n`
    DEFINES_CONTENT += `#define PINMASK_AOUT ${analogOutputPins.map(({ pin }) => pin).join(', ')}\n`

    DEFINES_CONTENT += `#define NUM_DISCRETE_INPUT ${digitalInputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_ANALOG_INPUT ${analogInputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_DISCRETE_OUTPUT ${digitalOutputPins.length}\n`
    DEFINES_CONTENT += `#define NUM_ANALOG_OUTPUT ${analogOutputPins.length}\n`
    DEFINES_CONTENT += `\n\n`

    // 3.4. Arduino libraries defines
    DEFINES_CONTENT += '//Arduino libraries\n'
    if (
      stProgramFileContent.includes('DS18B20;') ||
      stProgramFileContent.includes('DS18B20_2_OUT;') ||
      stProgramFileContent.includes('DS18B20_3_OUT;') ||
      stProgramFileContent.includes('DS18B20_4_OUT;') ||
      stProgramFileContent.includes('DS18B20_5_OUT;')
    ) {
      DEFINES_CONTENT += '#define USE_DS18B20_BLOCK\n'
    }

    if (stProgramFileContent.includes('P1AM_INIT;')) DEFINES_CONTENT += '#define USE_P1AM_BLOCKS\n'

    if (stProgramFileContent.includes('CLOUD_BEGIN;')) DEFINES_CONTENT += '#define USE_CLOUD_BLOCKS\n'

    if (stProgramFileContent.includes('MQTT_CONNECT;') || stProgramFileContent.includes('MQTT_CONNECT_AUTH;'))
      DEFINES_CONTENT += '#define USE_MQTT_BLOCKS\n'

    if (
      stProgramFileContent.includes('ARDUINOCAN_CONF;') ||
      stProgramFileContent.includes('ARDUINOCAN_WRITE;') ||
      stProgramFileContent.includes('ARDUINOCAN_WRITE_WORD;') ||
      stProgramFileContent.includes('ARDUINOCAN_READ;')
    ) {
      DEFINES_CONTENT += '#define USE_ARDUINOCAN_BLOCK\n'
    }

    if (
      stProgramFileContent.includes('STM32CAN_CONF;') ||
      stProgramFileContent.includes('STM32CAN_WRITE;') ||
      stProgramFileContent.includes('STM32CAN_READ;')
    ) {
      DEFINES_CONTENT += '#define USE_STM32CAN_BLOCK\n'
    }

    if (
      stProgramFileContent.includes('SM_8RELAY;') ||
      stProgramFileContent.includes('SM_16RELAY;') ||
      stProgramFileContent.includes('SM_8DIN;') ||
      stProgramFileContent.includes('SM_16DIN;') ||
      stProgramFileContent.includes('SM_4REL4IN;') ||
      stProgramFileContent.includes('SM_INDUSTRIAL;') ||
      stProgramFileContent.includes('SM_RTD;') ||
      stProgramFileContent.includes('SM_BAS;') ||
      stProgramFileContent.includes('SM_HOME;') ||
      stProgramFileContent.includes('SM_8MOSFET;')
    ) {
      DEFINES_CONTENT += '#define USE_SM_BLOCKS\n'
    }

    // 4. Finally, we attempt to write the content to the defines.h file.
    try {
      await writeFile(definitionsFilePath, DEFINES_CONTENT, { encoding: 'utf8' })
      _handleOutputData(`Defines file created at: ${definitionsFilePath}`, 'info')
    } catch (_error) {
      _handleOutputData('Error writing defines.h file', 'error')
    }
  }

  // handlePatchGeneratedFiles is no longer needed.
  // STruC++ generates clean C++ files (generated.cpp + generated.hpp) that don't require
  // patching or unity build renaming.

  async handleGenerateArduinoCppFile(projectPath: string, boardTarget: string) {
    let result: MethodsResult<string> = { success: false }

    // Source the HAL .cpp from BoardInfoResolver so the same code path works
    // for legacy hals.json entries and installed VPP packages (where only
    // Simulator / Runtime v3 / Runtime v4 remain in hals.json; every Arduino
    // board lives in a VPP).
    const resolver = new BoardInfoResolver(this.halsFilePath, this.sourceDirectoryPath, new PackageManagerModule())
    const info = await resolver.resolve(boardTarget)
    if (!info.halSourceFile) {
      throw new Error(`Board "${boardTarget}" does not declare a HAL source file`)
    }

    const arduinoCppFilePath = join(projectPath, 'build', boardTarget, 'src', 'arduino.cpp')

    try {
      await cp(info.halSourceFile, arduinoCppFilePath, { recursive: true })
      result = { success: true, data: arduinoCppFilePath }
    } catch (error) {
      throw new Error(`Error copying Arduino source file: ${(error as Error).message}`)
    }
    return result
  }

  async handleGenerateCBlocksHeader(
    projectData: ProjectDataWithCppPous,
    sourceTargetFolderPath: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks.h generation', 'info')
      return
    }

    const cppPous = originalCppPous.map((pou) => ({
      name: pou.name,
      variables: pou.variables,
    })) as CppPouDataHeader[]

    const headerContent: string = generateCBlocksHeader(cppPous)
    const headerFilePath = join(sourceTargetFolderPath, 'c_blocks.h')

    try {
      await writeFile(headerFilePath, headerContent, { encoding: 'utf8' })
      handleOutputData(`C blocks header file populated at: ${headerFilePath}`, 'info')
    } catch (error) {
      throw new Error(`Error writing c_blocks.h file: ${(error as Error).message}`)
    }
  }

  async handleGenerateCBlocksCode(
    projectData: ProjectDataWithCppPous,
    compilationPath: string,
    // Reserved on the signature so caller orchestrators (Arduino vs Runtime
    // v4) keep a stable API surface; both runtimes share <build>/src/ today
    // because both need gnu++17 for the strucpp IECVar<T> wrappers, but a
    // future runtime might branch off this discriminator again.
    _boardRuntime: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks_code.cpp generation', 'info')
      return
    }

    const cppPous = originalCppPous
    // Written into <build>/src/ so the pre-compile loop picks it up with
    // -std=gnu++17. The static Baremetal/c_blocks_code.cpp baseline stays
    // strucpp-free and is compiled by arduino-cli in the core's native
    // standard.
    const codeContent = generateCBlocksCode(cppPous)
    const codeFilePath = join(compilationPath, 'src', 'c_blocks_code.cpp')

    try {
      await writeFile(codeFilePath, codeContent, { encoding: 'utf8' })
      handleOutputData(`C blocks code file populated at: ${codeFilePath}`, 'info')
    } catch (error) {
      throw new Error(`Error writing c_blocks_code.cpp file: ${(error as Error).message}`)
    }
  }

  /**
   * Probes the runtime at `<ip>:8443/api/version` (unauthenticated)
   * to discover what version it speaks.  Used by the upload path to
   * gate strucpp builds against older MatIEC runtimes.
   *
   * Returns `{ version: null }` on any failure (404, network error,
   * timeout, malformed body) — the caller treats that as
   * "incompatible" so an unreachable / pre-version-endpoint runtime
   * gets the same friendly upgrade message as an explicitly old one.
   */
  private async fetchRuntimeVersion(runtimeIpAddress: string): Promise<{ version: string | null }> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          hostname: runtimeIpAddress,
          port: 8443,
          path: '/api/version',
          method: 'GET',
          timeout: 5000,
          ...getRuntimeHttpsOptions(),
        } as https.RequestOptions,
        (res: IncomingMessage) => {
          if (res.statusCode !== 200) {
            resolve({ version: null })
            res.resume()
            return
          }
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString()
          })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as { version?: unknown }
              resolve({ version: typeof parsed.version === 'string' ? parsed.version : null })
            } catch {
              resolve({ version: null })
            }
          })
        },
      )
      req.on('error', () => resolve({ version: null }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ version: null })
      })
      req.end()
    })
  }

  // Stub empty files for `@response_file` paths a recipe references but
  // that arduino-cli would only generate during a real compile (ESP32 +
  // STM32duino). GCC treats missing `@file` as a literal positional
  // argument → "cannot specify '-o' with '-c' ... with multiple files".
  // Empty is the canonical default arduino-cli itself writes when no
  // per-project build_opt customization exists.
  private static async ensureResponseFileStubs(
    cmd: string,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    // Match `@<absolute-path>` (POSIX `/...` or Windows `C:\...` / `C:/...`),
    // with optional surrounding quote from the recipe substitution.
    const responseFileRe = /["']?@([A-Za-z]:[\\/][^"'\s]+|\/[^"'\s]+)/g
    const paths = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = responseFileRe.exec(cmd)) !== null) {
      paths.add(match[1])
    }
    for (const responsePath of paths) {
      if (existsSync(responsePath)) continue
      await mkdir(path.dirname(responsePath), { recursive: true })
      try {
        await writeFile(responsePath, '', { flag: 'wx' })
        handleOutputData(`[precompile] Stubbed empty response file: ${responsePath}`, 'info')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
  }

  // Pre-compile every .cpp under `<compilationPath>/src/` (excluding the
  // board HAL `arduino.cpp`) with the board's toolchain at -std=gnu++17 and
  // archive into `libOpenPLCUserLib.a`. Keeps the gnu++17 + exceptions
  // surface contained — arduino-cli compiles the core and sketch in
  // whatever standard the core ships with.
  async handlePrecompileUserLib({
    compilationPath,
    fqbn,
    extraCxxFlags = [],
    handleOutputData,
  }: {
    compilationPath: string
    fqbn: string
    extraCxxFlags?: string[]
    handleOutputData: HandleOutputDataCallback
  }): Promise<{ archivePath: string; archCandidates: string[]; objectFiles: string[] }> {
    const tcProps = await this.extractToolchainProperties(fqbn)

    const srcDir = join(compilationPath, 'src')
    const baremetalDir = join(compilationPath, 'examples', 'Baremetal')

    // arduino.cpp is the board HAL; arduino-cli must compile it so it sees
    // the core's external libraries (Ethernet, SPI, ...) it discovers via
    // sketch-tree includes.
    const allEntries = await readdir(srcDir)
    const sources = allEntries
      .filter((name) => name.endsWith('.cpp') && name !== 'arduino.cpp')
      .map((name) => join(srcDir, name))

    if (sources.length === 0) {
      throw new Error(`handlePrecompileUserLib: no .cpp sources found under ${srcDir}`)
    }

    const objDir = join(compilationPath, 'precompile', 'obj')
    await mkdir(objDir, { recursive: true })

    const includes = [`"-I${srcDir}"`, `"-I${baremetalDir}"`].join(' ')

    // Appended after the recipe so the last `-std=` wins over the core's
    // implicit gnu++14. extraCxxFlags carries VPP per-board cxx_flags.
    const trailingFlags = ['-std=gnu++17', '-fno-rtti', ...extraCxxFlags].join(' ')

    const execAsync = promisify(exec)
    const execMaxBuffer = 16 * 1024 * 1024

    handleOutputData(
      `[precompile] Compiling ${sources.length} TU(s) with toolchain for ${fqbn}...`,
      'info',
    )

    // Build the .o path list synchronously up-front so the archive members
    // land in source-file order regardless of the concurrent compile result.
    const objectFiles = sources.map((sourcePath) =>
      join(objDir, path.basename(sourcePath).replace(/\.cpp$/, '.o')),
    )

    const compilePromises = sources.map(async (sourcePath, idx) => {
      const objectPath = objectFiles[idx]

      const cmd =
        tcProps.recipeCpp
          .replaceAll('{source_file}', sourcePath)
          .replaceAll('{object_file}', objectPath)
          .replaceAll('{includes}', includes) +
        ' ' +
        trailingFlags

      await CompilerModule.ensureResponseFileStubs(cmd, handleOutputData)

      try {
        const { stdout, stderr } = await execAsync(cmd, { maxBuffer: execMaxBuffer })
        // gcc emits warnings on stderr even on success — both streams logged as info.
        if (stdout) handleOutputData(stdout, 'info')
        if (stderr) handleOutputData(stderr, 'info')
        handleOutputData(`[precompile]   ✓ ${path.basename(sourcePath)}`, 'info')
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        handleOutputData(`[precompile]   ✗ ${path.basename(sourcePath)}: ${reason}`, 'error')
        throw new Error(`Pre-compile failed for ${path.basename(sourcePath)}: ${reason}`)
      }
    })

    await Promise.all(compilePromises)

    // Build the ar command manually instead of using recipe.ar.pattern —
    // cores disagree on placeholder semantics: mbed uses `{archive_file_path}`
    // (full path, usable) while AVR uses `{archive_file}` (bare filename with
    // build cache dir baked into the recipe, which would write to the wrong place).
    const archivePath = join(compilationPath, 'precompile', 'libOpenPLCUserLib.a')
    const quotedObjects = objectFiles.map((p) => `"${p}"`).join(' ')
    const compilerPath = tcProps.properties['compiler.path']
    const arName = tcProps.properties['compiler.ar.cmd']
    if (!compilerPath || !arName) {
      throw new Error(
        `Toolchain archive invocation requires compiler.path + compiler.ar.cmd ` +
          `from arduino-cli --show-properties for "${fqbn}" ` +
          `(got compiler.path="${compilerPath ?? ''}", compiler.ar.cmd="${arName ?? ''}"). ` +
          `The board's core is likely not installed.`,
      )
    }
    const arFlags = tcProps.properties['compiler.ar.flags'] ?? 'rcs'
    const arExtraFlags = tcProps.properties['compiler.ar.extra_flags'] ?? ''
    const archiverBin = `"${compilerPath}${arName}"`
    const archiveCmd = `${archiverBin} ${arFlags} ${arExtraFlags} "${archivePath}" ${quotedObjects}`

    handleOutputData(
      `[precompile] Archiving ${objectFiles.length} object(s) into libOpenPLCUserLib.a...`,
      'info',
    )
    await execAsync(archiveCmd, { maxBuffer: execMaxBuffer })

    // Move pre-compiled sources out of src/ so arduino-cli library discovery
    // doesn't recompile them; preserved under precompile/sources/ for debug.
    const sourcesStash = join(compilationPath, 'precompile', 'sources')
    await mkdir(sourcesStash, { recursive: true })
    for (const sourcePath of sources) {
      const stashedPath = join(sourcesStash, path.basename(sourcePath))
      await fs.rename(sourcePath, stashedPath)
    }
    handleOutputData(
      `[precompile] Moved ${sources.length} compiled source(s) to precompile/sources/ (won't be recompiled by arduino-cli)`,
      'info',
    )

    // arduino-cli's precompiled-lib resolution picks ONE subdir per core,
    // and the convention varies: AVR uses build.mcu ("atmega2560"), mbed
    // uses build.architecture ("cortex-m7"), others fall back to build.arch.
    // We collect every candidate so installAsArduinoLibrary can lay the
    // archive under all of them — duplicating a few-hundred-KB file in the
    // /tmp staging is cheaper than maintaining a per-core mapping. The
    // first entry doubles as the canonical `archDir` used for -L injection.
    const archCandidates = Array.from(
      new Set(
        [
          tcProps.properties['build.mcu'],
          tcProps.properties['build.architecture'],
          tcProps.properties['build.arch'],
        ]
          .filter((s): s is string => Boolean(s))
          .map((s) => s.toLowerCase()),
      ),
    )
    if (archCandidates.length === 0) archCandidates.push('unknown')

    handleOutputData(
      `[precompile] Pre-compile complete (${objectFiles.length} TUs → libOpenPLCUserLib.a, archs=${archCandidates.join(',')})`,
      'info',
    )

    return { archivePath, archCandidates, objectFiles }
  }

  // Wrap the precompiled archive as an Arduino library so arduino-cli's
  // library discovery picks it up via `#include <OpenPLCUserLib.h>` and
  // links the archive without recompiling anything inside. Staged under
  // os.tmpdir() because arduino-cli's --build-property tokenises on
  // whitespace and ignores quotes, so a build path with spaces (e.g.
  // "Arduino Mega") would break the -L flag and link input list.
  async installAsArduinoLibrary({
    compilationPath,
    archivePath,
    archCandidates,
  }: {
    compilationPath: string
    archivePath: string
    archCandidates: string[]
  }): Promise<{ libraryDir: string; archDir: string }> {
    if (archCandidates.length === 0) {
      throw new Error('installAsArduinoLibrary: archCandidates must contain at least one entry')
    }

    // Hash isolates concurrent compiles of different boards; pid suffix
    // isolates concurrent compiles of the SAME board across processes so
    // the rm-then-mkdir reset below never deletes another process's stage.
    const buildHash = createHash('md5').update(compilationPath).digest('hex').slice(0, 12)
    const stagingRoot = join(os.tmpdir(), `openplc-precompile-${buildHash}-${process.pid}`)
    const libraryDir = join(stagingRoot, 'OpenPLCUserLib')
    const srcDir = join(libraryDir, 'src')

    // Wipe leftover from a previous compile so a stale .a doesn't shadow a
    // fresh one (e.g. when the board switches between toolchains).
    await fs.rm(stagingRoot, { recursive: true, force: true })

    // Lay the archive under every candidate subdir — arduino-cli's
    // precompiled-lib resolver picks ONE based on a per-core convention
    // (build.mcu for AVR, build.architecture for mbed, etc.). The first
    // candidate is treated as canonical for the returned archDir, which is
    // what -L points to via compiler.libraries.ldflags.
    const archDir = join(srcDir, archCandidates[0])
    for (const arch of archCandidates) {
      const candidateDir = join(srcDir, arch)
      await mkdir(candidateDir, { recursive: true })
      await cp(archivePath, join(candidateDir, 'libOpenPLCUserLib.a'))
    }

    const propsContent = [
      'name=OpenPLCUserLib',
      'version=1.0.0',
      'author=OpenPLC Editor',
      'maintainer=OpenPLC Editor <noreply@autonomylogic.com>',
      'sentence=Pre-compiled OpenPLC user code archive',
      'paragraph=Pre-compiled gnu++17 archive of generated PLC code, isolated from arduino-cli core compilation.',
      'category=Other',
      'architectures=*',
      'precompiled=full',
      '',
    ].join('\n')
    await writeFile(join(libraryDir, 'library.properties'), propsContent, 'utf-8')

    const headerContent = [
      '// Auto-generated stub for OpenPLCUserLib.',
      '// Real declarations come via arduino_runtime_glue.h in <sketch>/src/.',
      '// This file exists solely to trigger arduino-cli library discovery for the',
      '// precompiled archive in this directory.',
      '#pragma once',
      '',
    ].join('\n')
    await writeFile(join(srcDir, 'OpenPLCUserLib.h'), headerContent, 'utf-8')

    return { libraryDir, archDir }
  }

  async handleCompileArduinoProgram({
    boardTarget,
    boardHalsContent,
    compilationPath,
    handleOutputData,
    cleanBuild,
  }: CompileArduinoProgramArgs) {
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    if (cleanBuild) {
      handleOutputData('Clean build requested — arduino-cli cache will be invalidated.', 'info')
    }

    // Resolve unified board info (VPP-aware, falls back to hals.json) so the
    // pre-compile + arduino-cli paths see the same compilerFlags/platformOptions.
    const resolver = new BoardInfoResolver(this.halsFilePath, this.sourceDirectoryPath, new PackageManagerModule())
    const info = await resolver.resolve(boardTarget)
    if (!info.platform) {
      throw new Error(`Board "${boardTarget}" does not declare a platform (FQBN)`)
    }

    // Compose effective FQBN by appending platformOptions selected by the user
    // (or each option's manifest default). projectPath is derived from
    // compilationPath (always `<projectPath>/build/<boardTarget>`).
    const projectPath = path.dirname(path.dirname(compilationPath))
    const selectedPlatformOptions = await this.#readSelectedPlatformOptions(projectPath)
    const effectiveFqbn = CompilerModule.applyPlatformOptions(
      info.platform,
      info.platformOptions,
      selectedPlatformOptions,
    )

    // The AVR/megaavr toolchain ships <stdint.h> but no C++ wrappers; we
    // bundle a freestanding port at resources/sources/avr-libstdcpp/.
    // Electron's user-data dir on macOS has spaces, which break arduino-cli's
    // compiler.cpp.extra_flags substitution — mirror to a no-space cache.
    const avrLibStdCppInclude =
      info.core?.startsWith('arduino:avr') || info.core?.startsWith('arduino:megaavr')
        ? await this.ensureAvrLibStdCppCache()
        : undefined

    // Pre-compile strucpp-touching TUs at -std=gnu++17 into libOpenPLCUserLib.a.
    // Flag policy: VPP cxx_flags + AVR libstdcpp -I flow into BOTH the pre-compile
    // and the arduino-cli pass (ModbusSlave still rides arduino-cli); internal
    // -std=gnu++17/-fno-rtti stays pre-compile-only.
    const cxxFlags: string[] = info.compilerFlags?.cxx_flags ? [...info.compilerFlags.cxx_flags] : []
    if (avrLibStdCppInclude) cxxFlags.push(`-I${avrLibStdCppInclude}`)

    const { archivePath, archCandidates } = await this.handlePrecompileUserLib({
      compilationPath,
      fqbn: effectiveFqbn,
      extraCxxFlags: cxxFlags,
      handleOutputData,
    })
    const { libraryDir: precompiledLibDir, archDir: precompiledArchDir } = await this.installAsArduinoLibrary({
      compilationPath,
      archivePath,
      archCandidates,
    })

    // Shared with openplc-web's compiler-adapter — single source of truth for
    // arduino-cli compile argv composition. The compile entry is synthesised
    // from BoardInfoResolver's BoardBuildInfo (covers legacy hals.json AND
    // VPP boards uniformly); the boardHalsContent argument stays on the
    // signature for backward compat but is no longer the data source — for
    // VPP-installed boards it would be undefined.
    //
    // After the shared helper composes its baseline args we append:
    //   --fqbn (effective with platformOptions applied),
    //   compiler.cpp.extra_flags (VPP cxx_flags),
    //   --library <precompiledLibDir> (so arduino-cli's discovery finds the
    //     header via Baremetal.ino's #include <OpenPLCUserLib.h>),
    //   compiler.libraries.ldflags=-L<archDir> -lOpenPLCUserLib (arduino-cli
    //     doesn't auto-emit -L/-l for libraries marked precompiled=full).
    const compileEntry = {
      platform: info.platform,
      core: info.core,
      c_flags: info.compilerFlags?.c_flags,
      cxx_flags: info.compilerFlags?.cxx_flags,
      ld_flags: info.compilerFlags?.ld_flags,
      max_data_size: info.maxDataSize,
    }
    void boardHalsContent // accepted for signature compat; data comes from `info`
    const cxxFlagsArg = cxxFlags.length > 0 ? ['--build-property', `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`] : []
    const buildProjectFlags = [
      ...buildArduinoCliCompileArgs(compileEntry, {
        sketchPath: join(baremetalPath, 'Baremetal.ino'),
        libraryPath: join(compilationPath, 'src'),
        avrLibStdCppInclude,
        cleanBuild,
      }),
      '--fqbn',
      effectiveFqbn,
      ...cxxFlagsArg,
      '--library',
      precompiledLibDir,
      '--build-property',
      `compiler.libraries.ldflags=-L${precompiledArchDir} -lOpenPLCUserLib`,
      ...this.arduinoCliBaseParameters,
    ]

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const child = this.#executeArduinoCliCommand(buildProjectFlags)
      let stderrData = ''
      child.stdout.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      child.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true })
        } else {
          reject(new Error(`Compilation failed with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  async handleUploadProgram({
    projectPath,
    arduinoPlatform,
    compilationPath,
    handleOutputData,
  }: {
    projectPath: string
    arduinoPlatform: string
    compilationPath: string
    handleOutputData: HandleOutputDataCallback
  }) {
    const devicesDirectoryPath = join(projectPath, 'devices')
    const devicesConfigurationFilePath = join(devicesDirectoryPath, 'configuration.json')
    const { communicationPort: port } =
      await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    if (!port) {
      handleOutputData('No communication port specified', 'error')
      return
    }

    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const child = this.#executeArduinoCliCommand([
        'upload',
        '--port',
        port,
        '--fqbn',
        arduinoPlatform,
        baremetalPath,
        ...this.arduinoCliBaseParameters,
      ])

      let stderrData = ''

      child.stdout.on('data', (data: Buffer) => {
        handleOutputData(data)
      })
      child.stderr.on('data', (data: Buffer) => {
        stderrData += data.toString()
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
          })
        } else {
          reject(new Error(`Upload failed with code ${code}\n${stderrData}`))
        }
      })
    })
  }

  /**
   * Send a compiled program file to the runtime's `/api/upload-file`
   * over HTTPS via a multipart/form-data POST.  Pure transport — no
   * polling, no PLC start, no UI logging.  Used as the `uploadProgram`
   * callback fed to the shared `deployRuntimeProgram` orchestrator.
   *
   * v3 callers pass `program.st` + `text/plain`; v4 callers pass the
   * compiled zip + `application/zip`.  `cleanBuild` toggles the
   * `?clean=1` flag the runtime honours by wiping `build/` and ccache
   * before compiling.
   */
  private async sendRuntimeUpload(opts: {
    hostname: string
    jwtToken: string
    filename: string
    contentType: string
    fileBuffer: Buffer
    cleanBuild: boolean
    onUploadAccepted?: (responseBody: string) => void
  }): Promise<{ success: boolean; error?: string }> {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${opts.filename}"\r\n` +
        `Content-Type: ${opts.contentType}\r\n\r\n`,
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([header, opts.fileBuffer, footer] as unknown as ReadonlyArray<Uint8Array>)

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const req = https.request(
        {
          hostname: opts.hostname,
          port: 8443,
          path: opts.cleanBuild ? '/api/upload-file?clean=1' : '/api/upload-file',
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            Authorization: `Bearer ${opts.jwtToken}`,
          },
          ...getRuntimeHttpsOptions(),
        } as https.RequestOptions,
        (res: IncomingMessage) => {
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString()
          })
          res.on('end', () => {
            if (res.statusCode === 200) {
              opts.onUploadAccepted?.(data)
              resolve({ success: true })
            } else {
              resolve({ success: false, error: data || `HTTP ${res.statusCode}` })
            }
          })
        },
      )
      req.setTimeout(300_000, () => {
        req.destroy()
        resolve({ success: false, error: 'Upload request timed out after 5 minutes' })
      })
      req.on('error', (err: Error) => resolve({ success: false, error: err.message }))
      req.write(body)
      req.end()
    })
  }

  // !! Deprecated: This method is a outdated implementation and should be removed.
  async createXmlFile(
    pathToUserProject: string,
    dataToCreateXml: PLCProjectData,
    parseTo: 'old-editor' | 'codesys',
  ): Promise<{ success: boolean; message: string }> {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: join(pathToUserProject, 'plc.xml'),
      buttonLabel: 'Save',
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    })

    if (!filePath) {
      return { success: false, message: 'User canceled the save dialog' }
    }

    const { data: projectDataAsString, message } = XmlGenerator(
      dataToCreateXml as Parameters<typeof XmlGenerator>[0],
      parseTo,
    ) as {
      data: string | undefined
      message: string
    }
    if (!projectDataAsString) {
      return { success: false, message: message }
    }

    const result = CreateXMLFile(filePath, projectDataAsString, 'plc')
    try {
      await writeFile(filePath, projectDataAsString)
      console.log('File written to:', filePath)
    } catch (err) {
      console.error('Error writing file:', err)
    }

    return {
      success: result.success,
      message: result.success ? ` XML file created at ${filePath}` : 'Failed to create XML file',
    }
  }

  // ++ ========================= Compiler builder ============================ ++

  async compressSourceFolder(sourceFolderPath: string): Promise<Buffer> {
    const zip = new JSZip()

    async function addFilesToZip(currentPath: string, zipFolder: JSZip, relativePath: string = ''): Promise<void> {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        const zipPath = relativePath ? path.join(relativePath, entry.name) : entry.name

        if (entry.isDirectory()) {
          await addFilesToZip(fullPath, zipFolder, zipPath)
        } else {
          const fileContent = await fs.readFile(fullPath)
          zipFolder.file(zipPath, fileContent)
        }
      }
    }

    await addFilesToZip(sourceFolderPath, zip)

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    return zipBuffer
  }

  async cleanConfFolder(sourceTargetFolderPath: string, handleOutputData: HandleOutputDataCallback): Promise<void> {
    const confFolderPath = join(sourceTargetFolderPath, 'conf')

    try {
      await fs.access(confFolderPath)
      await fs.rm(confFolderPath, { recursive: true })
      handleOutputData('Cleaned conf folder from previous compilation', 'info')
    } catch {
      handleOutputData('No conf folder to clean', 'info')
    }
  }

  async handleGenerateModbusSlaveConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const modbusSlaveConfig: string | null = generateModbusSlaveConfig(
      projectData.servers as Parameters<typeof generateModbusSlaveConfig>[0],
    )

    if (modbusSlaveConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'modbus_slave.json')
      await writeFile(configFilePath, modbusSlaveConfig, 'utf-8')
      handleOutputData('Generated conf/modbus_slave.json', 'info')
    } else {
      handleOutputData('No Modbus TCP server configured, skipping modbus_slave.json generation', 'info')
    }
  }

  async handleGenerateModbusMasterConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const modbusMasterConfig: string | null = generateModbusMasterConfig(
      projectData.remoteDevices as Parameters<typeof generateModbusMasterConfig>[0],
    )

    if (modbusMasterConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'modbus_master.json')
      await writeFile(configFilePath, modbusMasterConfig, 'utf-8')
      handleOutputData('Generated conf/modbus_master.json', 'info')
    } else {
      handleOutputData('No Modbus TCP remote devices configured, skipping modbus_master.json generation', 'info')
    }
  }

  async handleGenerateS7CommConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    try {
      const s7commConfig: string | null = generateS7CommConfig(projectData.servers)

      if (s7commConfig) {
        const confFolderPath = join(sourceTargetFolderPath, 'conf')
        await mkdir(confFolderPath, { recursive: true })
        const configFilePath = join(confFolderPath, 's7comm.json')
        await writeFile(configFilePath, s7commConfig, 'utf-8')
        handleOutputData('Generated conf/s7comm.json', 'info')
      } else {
        handleOutputData('No S7Comm server configured, skipping s7comm.json generation', 'info')
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      handleOutputData(`Failed to generate S7Comm config: ${errorMessage}`, 'error')
      throw error
    }
  }

  /**
   * Generate OPC-UA server configuration for Runtime v4.
   * Reads debug.c to resolve variable indices and generates opcua.json.
   */
  async handleGenerateOpcUaConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    try {
      // Check if there's an enabled OPC-UA server
      const opcuaServer = projectData.servers?.find(
        (s) => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled,
      )

      if (!opcuaServer || !opcuaServer.opcuaServerConfig) {
        handleOutputData('No OPC-UA server configured, skipping opcua.json generation', 'info')
        return
      }

      // Read STruC++'s debug-map.json (replaces MatIEC's debug.c).
      // Generated by the codegen pipeline at compile time alongside
      // generated.cpp / generated.hpp.
      const debugMapPath = join(sourceTargetFolderPath, 'debug-map.json')
      let debugMapContent: string

      try {
        debugMapContent = await readFile(debugMapPath, 'utf-8')
      } catch {
        handleOutputData(
          'Warning: Could not read debug-map.json. OPC-UA variable addresses may not be resolved.',
          'error',
        )
        debugMapContent = ''
      }

      // Get instances from Resources configuration for address resolution
      const instances = projectData.configuration.resource.instances.map((inst) => ({
        name: inst.name,
        task: inst.task,
        program: inst.program,
      }))

      // Generate the OPC-UA configuration. Field-level resolution
      // failures (stale library-FB internals, renamed/deleted vars)
      // surface as build warnings instead of aborting; the generator
      // drops them and we forward each to the compile log.
      const opcuaJson: string | null = generateOpcUaConfig(
        projectData.servers,
        debugMapContent,
        instances,
        (msg) => handleOutputData(msg, 'info'),
      )

      if (opcuaJson) {
        // Ensure conf directory exists
        const confFolderPath = join(sourceTargetFolderPath, 'conf')
        await mkdir(confFolderPath, { recursive: true })

        // Write the configuration file
        const configFilePath = join(confFolderPath, 'opcua.json')
        await writeFile(configFilePath, opcuaJson, 'utf-8')
        handleOutputData('Generated conf/opcua.json', 'info')

        // Log the number of configured nodes
        const nodeCount = opcuaServer.opcuaServerConfig.addressSpace.nodes.length
        handleOutputData(`OPC-UA Address Space: ${nodeCount} node(s) configured`, 'info')
      } else {
        handleOutputData('OPC-UA server enabled but no configuration generated', 'info')
      }
    } catch (error) {
      if (error instanceof OpcUaConfigError) {
        handleOutputData(`OPC-UA Configuration Error:\n${error.message}`, 'error')
      } else {
        const errorMessage = getErrorMessage(error)
        handleOutputData(`Failed to generate OPC-UA config: ${errorMessage}`, 'error')
      }
      throw error
    }
  }

  async handleGenerateEthercatConfig(
    sourceTargetFolderPath: string,
    projectData: PLCProjectData,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const ethercatConfig = generateEthercatConfig(projectData.remoteDevices)

    const ethercatErrors = validateEthercatConfig(ethercatConfig)
    if (ethercatErrors.length > 0) {
      throw new Error(`EtherCAT configuration is invalid: ${ethercatErrors.join('; ')}`)
    }

    if (ethercatConfig) {
      const confFolderPath = join(sourceTargetFolderPath, 'conf')
      await mkdir(confFolderPath, { recursive: true })
      const configFilePath = join(confFolderPath, 'ethercat.json')
      await writeFile(configFilePath, ethercatConfig, 'utf-8')
      handleOutputData('Generated conf/ethercat.json', 'info')
    } else {
      handleOutputData('No EtherCAT devices configured, skipping ethercat.json generation', 'info')
    }
  }

  async embedCBlocksInProgramSt(
    sourceTargetFolderPath: string,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const programStPath = join(sourceTargetFolderPath, 'program.st')
    const cBlocksHeaderPath = join(sourceTargetFolderPath, 'c_blocks.h')
    const cBlocksCodePath = join(sourceTargetFolderPath, 'c_blocks_code.cpp')

    try {
      let programStContent = await readFile(programStPath, 'utf8')

      try {
        await fs.access(cBlocksHeaderPath)
        const headerContent = await readFile(cBlocksHeaderPath, 'utf8')
        const headerLines = headerContent.split('\n')
        const embeddedHeader = headerLines.map((line) => `(*FILE:c_blocks.h ${line} *)`).join('\n')
        programStContent += '\n' + embeddedHeader

        handleOutputData('Embedded c_blocks.h into program.st for Runtime v3', 'info')
      } catch {
        handleOutputData('c_blocks.h not found, skipping embedding', 'info')
      }

      try {
        await fs.access(cBlocksCodePath)
        const codeContent = await readFile(cBlocksCodePath, 'utf8')
        const codeLines = codeContent.split('\n')
        const embeddedCode = codeLines.map((line) => `(*FILE:c_blocks_code.cpp ${line} *)`).join('\n')
        programStContent += '\n' + embeddedCode

        handleOutputData('Embedded c_blocks_code.cpp into program.st for Runtime v3', 'info')
      } catch {
        handleOutputData('c_blocks_code.cpp not found, skipping embedding', 'info')
      }

      await writeFile(programStPath, programStContent, 'utf8')
    } catch (error) {
      throw new Error(`Error embedding C blocks in program.st: ${(error as Error).message}`)
    }
  }

  /**
   * Handle VPP runtime-v4 package integration for the uploaded program.
   *
   * When the selected board is from an installed VPP package, this handler:
   *   1. Generates conf/<plugin_name>.json from the package's config_template.json
   *      merged with vendor screen data (hal-config, module-configuration, io-mapping)
   *   2. Copies the plugin source directory (containing the Makefile and .c/.h files)
   *      into the source folder under vpp_plugin/
   *   3. Computes a SHA-256 checksum over all plugin source files and writes it to
   *      vpp_plugin/checksum.sha256 so the runtime's compile.sh can skip
   *      recompilation when the source hasn't changed.
   *
   * For non-VPP boards or VPP boards without the necessary HAL metadata, the
   * relevant sub-steps are skipped. A header log is always emitted so the
   * user can see whether VPP handling kicked in at all.
   */
  async handleVendorPluginPackaging(
    boardTarget: string,
    normalizedProjectPath: string,
    sourceTargetFolderPath: string,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    try {
      const packageManager = new PackageManagerModule()
      const installed = packageManager.listInstalled()

      let matchingPackagePath: string | null = null
      let matchingDevice: PackageManifest['devices'][number] | null = null

      for (const pkg of installed) {
        const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
        if (!manifest) continue
        const device = manifest.devices.find((d) => d.name === boardTarget)
        if (device) {
          matchingPackagePath = pkg.path
          matchingDevice = device
          break
        }
      }

      if (!matchingDevice || !matchingPackagePath) {
        handleOutputData(`Board "${boardTarget}" is not from a VPP package, skipping VPP packaging`, 'info')
        return
      }

      if (matchingDevice.target.type !== 'runtime-v4') {
        handleOutputData(
          `VPP board "${boardTarget}" is not runtime-v4 (target=${matchingDevice.target.type}), skipping VPP packaging`,
          'info',
        )
        return
      }

      handleOutputData(`Detected VPP runtime-v4 board: ${boardTarget}`, 'info')

      // --- Step 1: Generate plugin config file ---
      const configTemplateRelPath = matchingDevice.hal?.configTemplate
      let pluginName = 'vendor_plugin'

      if (configTemplateRelPath) {
        const configTemplatePath = join(matchingPackagePath, configTemplateRelPath)
        let configTemplate: Record<string, unknown> | null = null
        try {
          const templateRaw = await readFile(configTemplatePath, 'utf-8')
          configTemplate = JSON.parse(templateRaw) as Record<string, unknown>
        } catch (err) {
          handleOutputData(
            `Failed to read VPP config template at ${configTemplateRelPath}: ${getErrorMessage(err)}`,
            'error',
          )
        }

        if (configTemplate) {
          // Read vendor screen data from the project's device configuration
          const deviceConfigPath = join(normalizedProjectPath, 'devices', 'configuration.json')
          let vendorScreenData: Record<string, unknown> = {}
          try {
            const deviceConfigRaw = await readFile(deviceConfigPath, 'utf-8')
            const deviceConfig = JSON.parse(deviceConfigRaw) as { vendorScreenData?: Record<string, unknown> }
            vendorScreenData = deviceConfig.vendorScreenData ?? {}
          } catch {
            // Device configuration may not exist yet — use empty vendor data
          }

          // Pre-load each module's configScreen JSON so the (pure)
          // generator can encode per-slot configuration bytes without
          // touching the filesystem.
          const rawModules = matchingDevice.moduleSystem?.modules ?? []
          const modules = await Promise.all(
            rawModules.map(async (m) => {
              let configScreenDefinition: unknown
              const rel = (m as { configScreen?: string }).configScreen
              if (rel) {
                try {
                  const screenPath = join(matchingPackagePath, rel)
                  const raw = await readFile(screenPath, 'utf-8')
                  configScreenDefinition = JSON.parse(raw)
                } catch (err) {
                  handleOutputData(
                    `Failed to load configScreen ${rel} for module ${m.id}: ${getErrorMessage(err)}`,
                    'error',
                  )
                }
              }
              return { ...m, configScreenDefinition }
            }),
          )
          const finalConfig = generateVendorPluginConfig(configTemplate, vendorScreenData, modules)

          // configTemplate is supplied by the package author through
          // their .vpp manifest. Without validation, plugin_name like
          // "../../../etc/cron.d/runme" would be join-ed into a path
          // outside confFolderPath and the editor would write user-
          // controlled JSON to an arbitrary location.
          const rawPluginName = (configTemplate.plugin_name as string | undefined) ?? 'vendor_plugin'
          validatePathId(rawPluginName, 'configTemplate.plugin_name')
          pluginName = rawPluginName
          const confFolderPath = join(sourceTargetFolderPath, 'conf')
          await mkdir(confFolderPath, { recursive: true })
          const configFilePath = join(confFolderPath, `${pluginName}.json`)
          assertPathContained(confFolderPath, configFilePath, 'plugin config path')
          await writeFile(configFilePath, JSON.stringify(finalConfig, null, 2), 'utf-8')
          handleOutputData(`Generated conf/${pluginName}.json for VPP plugin`, 'info')

          // Generate vpp_plugins.conf so the runtime knows exactly which
          // VPP plugin to load and where its compiled .so and config live.
          // Format matches plugins.conf: name,path,enabled,type,config_path,venv_path
          // The paths are the deterministic locations that compile.sh and the
          // runtime's apply_vpp_plugin_conf() agree on.
          const vppPluginsConfContent =
            `${pluginName},./build/vpp/lib${pluginName}_plugin.so,1,1,./build/vpp/${pluginName}.json,\n`
          const vppPluginsConfPath = join(sourceTargetFolderPath, 'vpp_plugins.conf')
          await writeFile(vppPluginsConfPath, vppPluginsConfContent, 'utf-8')
          handleOutputData('Generated vpp_plugins.conf', 'info')
        }
      } else {
        handleOutputData('VPP board has no HAL configTemplate, skipping plugin config generation', 'info')
      }

      // --- Step 2: Copy plugin source + generate checksum ---
      const pluginEntryRelPath = matchingDevice.hal?.pluginEntry
      if (!pluginEntryRelPath) {
        handleOutputData('VPP board has no HAL pluginEntry, skipping plugin source upload', 'info')
        return
      }

      // The plugin source directory is the parent directory of pluginEntry.
      // pluginEntryRelPath is supplied by the package manifest; without
      // containment, an entry like `../../../etc` would resolve outside
      // matchingPackagePath and the recursive-copy below would slurp
      // arbitrary host files into the build's vpp_plugin directory.
      const pluginSourceDir = join(matchingPackagePath, path.dirname(pluginEntryRelPath))
      try {
        assertPathContained(matchingPackagePath, pluginSourceDir, 'matchingDevice.hal.pluginEntry')
      } catch (err) {
        handleOutputData(`Invalid VPP pluginEntry: ${getErrorMessage(err)}`, 'error')
        return
      }
      let pluginSourceStat
      try {
        pluginSourceStat = await stat(pluginSourceDir)
      } catch (err) {
        handleOutputData(
          `VPP plugin source directory not found at ${pluginEntryRelPath}: ${getErrorMessage(err)}`,
          'error',
        )
        return
      }

      if (!pluginSourceStat.isDirectory()) {
        handleOutputData(`VPP plugin source path is not a directory: ${pluginEntryRelPath}`, 'error')
        return
      }

      const destPluginDir = join(sourceTargetFolderPath, 'vpp_plugin')
      // Clean up any previous vpp_plugin directory from a prior build
      try {
        await fs.rm(destPluginDir, { recursive: true, force: true })
      } catch {
        // Ignore — may not exist yet
      }

      // Copy the plugin source, excluding files that are only useful in the editor
      // (config_template.json is already turned into conf/<plugin>.json, and
      // requirements.txt is for Python-style plugins that don't apply here).
      // Symlinks are rejected unconditionally:
      //   - they aren't useful inside a .vpp (the format ships a flat tree),
      //   - a self-referential or parent-pointing symlink would make this
      //     recursion unbounded, hanging the build,
      //   - and a symlink to outside matchingPackagePath would let a
      //     malicious package exfiltrate host files into the upload.
      const EXCLUDE_FILES = new Set(['config_template.json', 'requirements.txt'])
      const copiedFiles: string[] = []
      const collectAndCopy = async (sourceDir: string, destDir: string, relPath: string = ''): Promise<void> => {
        const entries = await readdir(sourceDir, { withFileTypes: true })
        for (const entry of entries) {
          if (EXCLUDE_FILES.has(entry.name)) continue
          if (entry.isSymbolicLink()) {
            handleOutputData(
              `Skipping symlink in VPP plugin source: ${relPath ? `${relPath}/` : ''}${entry.name}`,
              'info',
            )
            continue
          }
          const sourcePath = join(sourceDir, entry.name)
          const destPath = join(destDir, entry.name)
          const relFilePath = relPath ? `${relPath}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            await mkdir(destPath, { recursive: true })
            await collectAndCopy(sourcePath, destPath, relFilePath)
          } else if (entry.isFile()) {
            await mkdir(destDir, { recursive: true })
            const content = await readFile(sourcePath)
            await writeFile(destPath, content as unknown as Uint8Array)
            copiedFiles.push(relFilePath)
          }
        }
      }

      await mkdir(destPluginDir, { recursive: true })
      await collectAndCopy(pluginSourceDir, destPluginDir)

      if (copiedFiles.length === 0) {
        handleOutputData('VPP plugin source directory contained no files to copy', 'info')
        return
      }

      // Compute SHA-256 over all copied files (sorted for determinism)
      // Format: "<sha256> <relative-path>\n" per file, then a final SHA-256 of that list
      copiedFiles.sort()
      const hash = createHash('sha256')
      for (const relFile of copiedFiles) {
        const fileContent = await readFile(join(destPluginDir, relFile))
        const fileHash = createHash('sha256').update(fileContent as unknown as Uint8Array).digest('hex')
        hash.update(`${fileHash}  ${relFile}\n`)
      }
      const combinedHash = hash.digest('hex')
      await writeFile(join(destPluginDir, 'checksum.sha256'), combinedHash + '\n', 'utf-8')

      handleOutputData(
        `Copied ${copiedFiles.length} VPP plugin source file(s) to vpp_plugin/ (checksum: ${combinedHash.slice(0, 12)}...)`,
        'info',
      )
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      handleOutputData(`Failed VPP plugin packaging: ${errorMessage}`, 'error')
    }
  }

  /**
   * This will be the main entry point for the compiler module.
   * It will handle all the compilation process, will orchestrate the various steps involved in compiling a program.
   */
  // Work in progress - we should specify the arguments and the return type correctly.
  async compileProgram(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: MessagePortMain,
    mainProcessBridge: {
      makeRuntimeApiRequest: <T = void>(
        ipAddress: string,
        jwtToken: string,
        endpoint: string,
        responseParser?: (data: string) => T,
      ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
      /**
       * Resolve a list of project-enabled library names to parsed
       * `.stlib` archives.  Bundled libraries are always-on and
       * always included; each enabled user library is filtered in by
       * name.  Missing names (enabled but not installed) come back so
       * the caller can abort with a clear error before strucpp runs.
       */
      loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
    },
  ): Promise<void> {
    // Start the main process port to communicate with the renderer process.
    // INFO: This is necessary to send messages back to the renderer process.
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting compilation process...' })
    // INFO: We assume the first argument is the project path,
    // INFO: the second argument is the board target, and the third argument is the project data.
    const [
      projectPath,
      boardTarget,
      boardCore,
      compileOnly,
      projectData,
      runtimeIpAddress,
      runtimeJwtToken,
      cleanBuild,
    ] = args as [
      string,
      string,
      string | null,
      boolean,
      PLCProjectData,
      string | null,
      string | null,
      boolean | undefined,
    ]

    const boardRuntime = await this.#getBoardRuntime(boardTarget) // Get the board runtime from the hals.json file

    const halsContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)
    // Resolve unified board info upfront so upload-step lookups work for VPP
    // boards too (hals.json only contains Simulator / Runtime v3 / Runtime v4
    // after the VPP migration; every Arduino board lives in a VPP manifest).
    // Done lazily — only computed when boardTarget is known to be an
    // arduino-cli target downstream; runtime-v4 / simulator paths don't need it.
    let resolvedBoardInfo: BoardBuildInfo | null = null
    const getResolvedBoardInfo = async (): Promise<BoardBuildInfo> => {
      if (resolvedBoardInfo) return resolvedBoardInfo
      const resolver = new BoardInfoResolver(this.halsFilePath, this.sourceDirectoryPath, new PackageManagerModule())
      resolvedBoardInfo = await resolver.resolve(boardTarget)
      return resolvedBoardInfo
    }

    const normalizedProjectPath = projectPath.replace('project.json', '')

    const compilationPath = join(normalizedProjectPath, 'build', boardTarget) // Assuming the build folder is named 'build'

    const sourceTargetFolderPath = join(compilationPath, 'src') // Assuming the source folder is named 'src'

    let buildMD5Hash: string | null = null
    // Strucpp emit's in-memory file map.  Populated by `handleCompileSTtoCpp`
    // and threaded into the runtime v4 block so we can compose the upload
    // bundle without re-reading every artefact off disk.  Stays empty for
    // any compile path that doesn't reach the strucpp step.
    let strucppEmittedFiles: Record<string, string> = {}

    // --- Print basic information ---
    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling program for project: ${projectPath} and board target: ${boardTarget}`,
    })
    _mainProcessPort.postMessage({
      logLevel: 'warning',
      message: 'Host Hardware Info:',
    })
    _mainProcessPort.postMessage({
      message: this.getHostHardwareInfo(),
    })

    // --- Check for unsupported features on non-v4 targets ---
    // VPP boards with runtime-v4 target type use openplc-compiler and are also v4-capable
    const isRuntimeV3 = boardTarget === 'OpenPLC Runtime v3'
    const isRuntimeV4 = boardRuntime === 'openplc-compiler' && !isRuntimeV3

    const hasServers = projectData.servers && projectData.servers.length > 0
    const hasRemoteDevices = projectData.remoteDevices && projectData.remoteDevices.length > 0

    if (!isRuntimeV4 && hasServers) {
      _mainProcessPort.postMessage({
        logLevel: 'warning',
        message: `Warning: Your project contains Modbus Server configurations, but the selected target (${boardTarget}) does not support this feature. Modbus Server is only supported on OpenPLC Runtime v4. The server configurations will be ignored during compilation.`,
      })
    }

    if (!isRuntimeV4 && hasRemoteDevices) {
      _mainProcessPort.postMessage({
        logLevel: 'warning',
        message: `Warning: Your project contains Remote IO configurations, but the selected target (${boardTarget}) does not support this feature. Remote IO is only supported on OpenPLC Runtime v4. The remote device configurations will be ignored during compilation.`,
      })
    }

    // --- Check tools availability ---
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Checking tools availability...' })

    try {
      const [arduinoCliCheckResult, strucppCheckResult] = await Promise.all([
        this.checkArduinoCliAvailability(),
        Promise.resolve(this.checkStrucppAvailability()),
      ])
      _mainProcessPort.postMessage({
        message: `Arduino CLI available at version ${arduinoCliCheckResult.data}\nSTruC++ available at version ${strucppCheckResult.data}`,
      })
    } catch (_error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message: `${_error}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 1: Create basic directories
    try {
      await this.createBasicDirectories(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Directories for compilation source files created.',
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message: `${error}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 2: Generate XML from JSON
    let generateXMLResult: MethodsResult<{ xmlPath: string; xmlContent: string }> = { success: false }
    try {
      generateXMLResult = await this.handleGenerateXMLfromJSON(sourceTargetFolderPath, projectData)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: `Generated XML from JSON at: ${generateXMLResult.data?.xmlPath as string}`,
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error generating XML from JSON: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 3: Transpile XML to ST
    const generatedXMLFilePath = join(sourceTargetFolderPath, 'plc.xml') // Assuming the XML file is named 'plc.xml'
    try {
      await this.handleTranspileXMLtoST(generatedXMLFilePath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error transpiling XML to ST: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // -- Copy static files --
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Copying static files...' })
    try {
      await this.copyStaticFiles(compilationPath, boardRuntime, isRuntimeV4)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Static files copied successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error copying static files: ${error as string}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Step 4: Compile ST to C++ with STruC++ (replaces iec2c + debug + glue generation)
    try {
      const hasCBlocks = ((projectData as ProjectDataWithCppPous).originalCppPous?.length ?? 0) > 0
      // Hand the POU list to handleCompileSTtoCpp so the splitter can
      // segment program.st into per-POU files and surface errors with
      // POU-relative location data.
      const knownPous = buildKnownPous(projectData.pous)
      // Resolve project-enabled libraries to parsed `.stlib` archives.
      // Bundled libs are always-on; missing names (enabled but not
      // installed) abort the compile early in handleCompileSTtoCpp
      // with a clear "open the Library Manager" message.
      const enabledLibraryNames = (projectData.libraries ?? []).map((ref) => ref.name)
      const { archives: libraries, missing: missingLibraries } =
        mainProcessBridge.loadEnabledArchives(enabledLibraryNames)
      const { md5Hash, strucppFiles } = await this.handleCompileSTtoCpp(
        sourceTargetFolderPath,
        (data, logLevel, compileError) => {
          _mainProcessPort.postMessage({
            logLevel,
            message: data,
            ...(compileError ? { compileError } : {}),
          })
        },
        { hasCBlocks, pous: knownPous, libraries, missingLibraries },
      )
      buildMD5Hash = md5Hash
      strucppEmittedFiles = strucppFiles
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 7 / 8: Generate C/C++ blocks header + code.  Skipped for
    // runtime v4 — the runtime v4 block below routes c_blocks.h /
    // c_blocks_code.cpp through `composeRuntimeV4Bundle` so the upload
    // bundle has a single canonical producer.  Arduino and v3 still
    // need the disk writes here (Arduino: arduino-cli consumes them;
    // v3: `embedCBlocksInProgramSt` reads c_blocks.h off disk).
    if (!isRuntimeV4) {
      try {
        await this.handleGenerateCBlocksHeader(projectData, sourceTargetFolderPath, (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Stopping compilation process.',
        })
        _mainProcessPort.close()
        return
      }

      try {
        await this.handleGenerateCBlocksCode(projectData, compilationPath, boardRuntime, (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Stopping compilation process.',
        })
        _mainProcessPort.close()
        return
      }
    }

    // Step 9: Embed C/C++ blocks in program.st for Runtime v3
    if (boardRuntime === 'openplc-compiler' && boardTarget === 'OpenPLC Runtime v3') {
      try {
        await this.embedCBlocksInProgramSt(sourceTargetFolderPath, (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Stopping compilation process.',
        })
        _mainProcessPort.close()
        return
      }
    }

    // -- Verify if the runtime target is Arduino or OpenPLC --
    // INFO: If the runtime target is Arduino, we will continue the compilation process.
    // INFO: If the runtime target is OpenPLC we will finish the process here.
    if (boardRuntime === 'openplc-compiler') {
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'OpenPLC runtime detected.',
      })
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Source files generated successfully at: ' + sourceTargetFolderPath,
      })

      // Build the runtime v4 upload bundle through the shared composer
      // (`composeRuntimeV4Bundle`).  Web routes through the same code
      // path — single source of truth for the upload zip contract.  All
      // pre-v4 scatter writes (c_blocks.h, c_blocks_code.cpp,
      // strucpp_runtime/include/*, defines.h, conf/*) are skipped for v4
      // boards above and emitted here in one go so the file list is
      // structurally identical to web's.
      //
      // Idempotent for compile-only: the composer's output is written
      // to disk under `sourceTargetFolderPath`, exactly where the
      // pre-refactor scatter writes used to land — diffing build/<target>/src
      // pre- vs post-refactor should produce no changes for any test
      // project.
      if (isRuntimeV4) {
        try {
          await this.cleanConfFolder(sourceTargetFolderPath, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })

          // Two POU shapes: the header generator wants
          // `{ name, variables }`, the code generator needs the full
          // `{ name, code, variables }`.  Build both views once so
          // the composer inputs read cleanly.
          const originalCppPous = (projectData as ProjectDataWithCppPous).originalCppPous ?? []
          const hasCppCode = originalCppPous.length > 0
          const cppPousHeader = originalCppPous.map((pou) => ({
            name: pou.name,
            variables: pou.variables,
          })) as CppPouDataHeader[]

          // Modbus slave / master / S7Comm: pure helpers, no I/O —
          // call them directly here and hand the strings to the
          // composer.  `null` from any of them means the project has
          // no config of that type, which the composer skips.
          const modbusSlaveJson = generateModbusSlaveConfig(
            projectData.servers as Parameters<typeof generateModbusSlaveConfig>[0],
          )
          const modbusMasterJson = generateModbusMasterConfig(
            projectData.remoteDevices as Parameters<typeof generateModbusMasterConfig>[0],
          )
          const s7CommJson = generateS7CommConfig(projectData.servers)

          // OPC-UA needs strucpp's `debug-map.json` (NOT
          // `generated_debug.cpp`) to resolve `%I/%Q/%M` addresses —
          // `parseDebugMap` in `frontend/utils/opcua/` expects the
          // JSON shape strucpp emits at that filename.  Pull it from
          // the in-memory strucpp file map so the composer doesn't
          // have to re-read every artefact off disk.
          const debugMapContent = strucppEmittedFiles['debug-map.json'] ?? ''
          const instances = projectData.configuration.resource.instances.map((inst) => ({
            name: inst.name,
            task: inst.task,
            program: inst.program,
          }))
          let opcUaJson: string | null = null
          try {
            opcUaJson = generateOpcUaConfig(projectData.servers, debugMapContent, instances, (msg) =>
              _mainProcessPort.postMessage({ logLevel: 'info', message: msg }),
            )
          } catch (error) {
            if (error instanceof OpcUaConfigError) {
              _mainProcessPort.postMessage({
                logLevel: 'error',
                message: `OPC-UA Configuration Error:\n${error.message}`,
              })
            } else {
              _mainProcessPort.postMessage({
                logLevel: 'error',
                message: `Failed to generate OPC-UA config: ${getErrorMessage(error)}`,
              })
            }
            throw error
          }

          // EtherCAT: validate up-front so a bad config aborts the
          // compile before the composer runs — same gate web has.
          const ethercatJson = generateEthercatConfig(projectData.remoteDevices)
          const ethercatErrors = validateEthercatConfig(ethercatJson)
          if (ethercatErrors.length > 0) {
            throw new Error(`EtherCAT configuration is invalid: ${ethercatErrors.join('; ')}`)
          }

          // ST source — read from disk since handleGenerateXMLfromJSON
          // + xml2st wrote it earlier in the pipeline.
          const programStContent = await readFile(join(sourceTargetFolderPath, 'program.st'), 'utf-8')

          const bundleFiles = composeRuntimeV4Bundle({
            programSt: programStContent,
            md5: buildMD5Hash ?? '',
            strucppFiles: strucppEmittedFiles,
            cBlocks: {
              header: hasCppCode ? generateCBlocksHeader(cppPousHeader) : '// Empty file\n',
              code: hasCppCode ? generateCBlocksCode(originalCppPous) : null,
            },
            strucppRuntimeHeaders: await this.loadStrucppRuntimeHeaders(),
            confs: {
              modbusSlave: modbusSlaveJson,
              modbusMaster: modbusMasterJson,
              s7Comm: s7CommJson,
              opcUa: opcUaJson,
              // `validateEthercatConfig` above guarantees a non-null
              // payload by here; coerce for the composer's required
              // `string` shape.
              ethercat: ethercatJson ?? '',
            },
          })

          // Write each composer-emitted file to disk under
          // `sourceTargetFolderPath`.  Nested paths (e.g.
          // `strucpp_runtime/include/iec_std_lib.hpp`,
          // `conf/modbus_slave.json`) need their parent directories
          // created first — mkdir recursive is idempotent.
          await Promise.all(
            Object.entries(bundleFiles).map(async ([relativePath, content]) => {
              const absolutePath = join(sourceTargetFolderPath, relativePath)
              await mkdir(path.dirname(absolutePath), { recursive: true })
              await writeFile(absolutePath, content, { encoding: 'utf8' })
            }),
          )
          _mainProcessPort.postMessage({
            logLevel: 'info',
            message: `Runtime v4 bundle composed: ${Object.keys(bundleFiles).length} files written under ${sourceTargetFolderPath}`,
          })

          // VPP plugin config + source copy for boards whose target is runtime-v4.
          // Runs after the composer so VPP-provided files land on top of
          // the composer's writes (today no overlap; if VPP ever ships a
          // file the composer also emits, ordering preserves VPP).
          await this.handleVendorPluginPackaging(
            boardTarget,
            normalizedProjectPath,
            sourceTargetFolderPath,
            (data, logLevel) => {
              _mainProcessPort.postMessage({ logLevel, message: data })
            },
          )
        } catch (error) {
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: `Error generating Runtime v4 configs: ${error instanceof Error ? error.message : String(error)}`,
          })
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: 'Stopping compilation process.',
          })
          _mainProcessPort.close()
          return
        }
      }

      if (compileOnly) {
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'Compile only mode - skipping upload to runtime.',
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
        return
      }

      if (!runtimeIpAddress || !runtimeJwtToken) {
        _mainProcessPort.postMessage({
          logLevel: 'warning',
          message: 'Runtime not configured or not logged in. Skipping upload to runtime.',
        })
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'To upload the program, configure the runtime IP address and login in the device configuration.',
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
        return
      }

      // Runtime v4 ships the STruC++ pipeline starting at v4.1.0;
      // 4.0.x runtimes still speak the MatIEC wire format and can't
      // load the strucpp artefacts we'd upload here.  Probe
      // /api/version (unauthenticated) before sending the zip so the
      // user gets a clear "upgrade your runtime" message instead of
      // a cryptic 500 on the device side.
      //
      // Runtime v3 is on a separate upload path (raw program.st), so
      // the gate is v4-only.
      if (!isRuntimeV3) {
        const versionResult = await this.fetchRuntimeVersion(runtimeIpAddress)
        if (!isStrucppCompatibleRuntime(versionResult.version)) {
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: describeIncompatibleRuntime(versionResult.version),
          })
          _mainProcessPort.postMessage({
            message:
              '-------------------------------------------------------------------------------------------------------------\n',
          })
          _mainProcessPort.close()
          return
        }
      }

      try {
        let fileBuffer: Buffer
        let filename: string
        let contentType: string

        if (isRuntimeV3) {
          _mainProcessPort.postMessage({
            logLevel: 'info',
            message: 'Preparing program.st file for OpenPLC Runtime v3...',
          })
          const programStPath = join(sourceTargetFolderPath, 'program.st')

          try {
            await fs.access(programStPath)
          } catch {
            throw new Error(`Required file not found: ${programStPath}. Cannot upload to OpenPLC Runtime v3.`)
          }

          fileBuffer = await fs.readFile(programStPath)
          filename = 'program.st'
          contentType = 'text/plain'
        } else {
          // Runtime v4 conf/* files were already generated above, before the
          // compile-only early return, so compile-only flows also get them.
          _mainProcessPort.postMessage({
            logLevel: 'info',
            message: 'Compressing source files for OpenPLC Runtime v4...',
          })
          fileBuffer = await this.compressSourceFolder(sourceTargetFolderPath)
          filename = 'program.zip'
          contentType = 'application/zip'
        }

        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: `Uploading program to runtime at ${runtimeIpAddress}...`,
        })

        // The full deploy sequence (upload → poll runtime build →
        // start PLC with BUSY retry) lives in the shared
        // `deployRuntimeProgram` so openplc-web's `compileProgram`
        // can drive the exact same flow.  Only the three
        // round-trips are platform-specific — the orchestration,
        // log fan-out, deadlines, and retry policy are not.
        const deployOutcome = await deployRuntimeProgram({
          uploadProgram: () =>
            this.sendRuntimeUpload({
              hostname: runtimeIpAddress,
              jwtToken: runtimeJwtToken,
              filename,
              contentType,
              fileBuffer,
              cleanBuild: cleanBuild ?? false,
              onUploadAccepted: (responseBody) => {
                // Runtime returns the initial `CompilationStatus`
                // field in the upload response (typically
                // "COMPILING").  Surface it so the user sees the
                // build kick off before the poller's first tick.
                try {
                  const response = JSON.parse(responseBody) as { CompilationStatus?: string }
                  _mainProcessPort.postMessage({
                    logLevel: 'info',
                    message: `Runtime compilation started: ${response.CompilationStatus || 'COMPILING'}`,
                  })
                } catch {
                  _mainProcessPort.postMessage({
                    logLevel: 'warning',
                    message: 'Could not parse runtime response',
                  })
                }
              },
            }),
          fetchCompilationStatus: async () => {
            try {
              const result = await mainProcessBridge.makeRuntimeApiRequest<{
                status: string
                logs: string[]
                exit_code: number | null
              }>(runtimeIpAddress, runtimeJwtToken, '/api/compilation-status', (data: string) => {
                return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
              })
              if (!result.success) return { success: false, error: result.error }
              return { success: true, data: result.data! }
            } catch (pollError) {
              return {
                success: false,
                error: pollError instanceof Error ? pollError.message : String(pollError),
              }
            }
          },
          fetchStartResponse: async () => {
            const result = await mainProcessBridge.makeRuntimeApiRequest<string>(
              runtimeIpAddress,
              runtimeJwtToken,
              '/api/start-plc',
              (data: string) => {
                const parsed = JSON.parse(data) as { status?: string }
                return (parsed.status ?? '').trim()
              },
            )
            if (!result.success) return { success: false, error: result.error }
            return { success: true, status: result.data ?? '' }
          },
          onLog: (level, message) => {
            _mainProcessPort.postMessage({ logLevel: level, message })
          },
          pollTimeoutMs: CompilerModule.COMPILATION_STATUS_TIMEOUT_MS,
          pollIntervalMs: CompilerModule.COMPILATION_STATUS_POLL_INTERVAL_MS,
          startTimeoutMs: POST_BUILD_START_TIMEOUT_MS,
          startIntervalMs: POST_BUILD_START_POLL_INTERVAL_MS,
        })

        // Editor-only follow-up: fetch the current PLC status and
        // forward it through the IPC channel so the UI can update
        // its run/stop indicator.  Best-effort — silently skipped
        // when the deploy succeeded but the device drops the
        // status request, or when the deploy itself fell short of
        // STARTED.
        if (deployOutcome === 'STARTED' && runtimeIpAddress && runtimeJwtToken) {
          try {
            const statusResult = await mainProcessBridge.makeRuntimeApiRequest<string>(
              runtimeIpAddress,
              runtimeJwtToken,
              '/api/status',
              (data: string) => {
                const response = JSON.parse(data) as { status: string }
                return response.status
              },
            )
            if (statusResult.success && statusResult.data) {
              const status = parsePlcStatus(statusResult.data)
              if (status) {
                _mainProcessPort.postMessage({ plcStatus: status })
              }
            }
          } catch (_statusError) {
            // Best-effort — silently ignore.
          }
        }

        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
        return
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `Failed to upload to runtime: ${getErrorMessage(error)}`,
        })
        _mainProcessPort.postMessage({
          message:
            '-------------------------------------------------------------------------------------------------------------\n',
        })
        _mainProcessPort.close()
      }
      return
    }

    // Step 5: Handle core installation
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Handling core installation...' })
    try {
      await this.handleCoreInstallation(boardCore, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }
    // Step 9: Handle library installation
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Handling library installation...' })
    try {
      await this.handleLibraryInstallation((data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Step 10: Handle defines.h file generation
    try {
      if (buildMD5Hash === null) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: 'Build MD5 hash is null, cannot generate defines.h file.',
        })
        _mainProcessPort.close()
        return
      }
      await this.handleGenerateDefinitionsFile({
        projectPath: normalizedProjectPath,
        boardTarget,
        buildMD5Hash,
        boardRuntime,
        _handleOutputData: (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        },
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
    }

    // Step 11: Generate Arduino CPP file
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Generating Arduino CPP file...' })
    try {
      await this.handleGenerateArduinoCppFile(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Arduino CPP file generated successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.close()
      return
    }

    // Step 12: Compile Arduino Program
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Compiling Arduino program...' })
    try {
      await this.handleCompileArduinoProgram({
        boardTarget,
        boardHalsContent: halsContent[boardTarget],
        compilationPath,
        cleanBuild: cleanBuild ?? false,
        handleOutputData: (data, logLevel) => {
          _mainProcessPort.postMessage({ logLevel, message: data })
        },
      })
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Arduino program compiled successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.close()
      return
    }

    // Step 13: Upload program to board or load into simulator
    if (boardRuntime === 'simulator') {
      // `compileOnly: true` callers (the library-project verification
      // step today; a future "Build only" on simulator) want to
      // confirm the compile succeeded without any side effect on the
      // simulator process.  Emitting the firmware path makes the
      // renderer load the .hex into the running simulator; emitting
      // "Loading firmware into simulator..." advertises an action
      // that isn't happening.  Skip both for compile-only callers.
      if (compileOnly) {
        _mainProcessPort.postMessage({ logLevel: 'info', message: 'Compilation successful.' })
        _mainProcessPort.postMessage({ closePort: true })
        _mainProcessPort.close()
        return
      }
      // For simulator targets, send the HEX firmware path back to the renderer.
      // Derive the build sub-directory from the resolved platform FQBN (e.g.
      // "arduino:avr:mega" → "arduino.avr.mega"). The resolver covers both
      // legacy hals.json entries and VPP boards.
      const simulatorInfo = await getResolvedBoardInfo()
      if (!simulatorInfo.platform) {
        throw new Error(`Board "${boardTarget}" does not declare a platform (FQBN)`)
      }
      const fqbnSubDir = simulatorInfo.platform.replaceAll(':', '.')
      const hexPath = join(compilationPath, 'examples', 'Baremetal', 'build', fqbnSubDir, 'Baremetal.ino.hex')
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Compilation successful. Loading firmware into simulator...',
      })
      _mainProcessPort.postMessage({
        simulatorFirmwarePath: hexPath,
        closePort: true,
      })
      _mainProcessPort.close()
      return
    }

    if (!compileOnly) {
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Uploading program to board...' })
      try {
        const uploadInfo = await getResolvedBoardInfo()
        if (!uploadInfo.platform) {
          throw new Error(`Board "${boardTarget}" does not declare a platform (FQBN)`)
        }
        await this.handleUploadProgram({
          projectPath: normalizedProjectPath,
          arduinoPlatform: uploadInfo.platform,
          compilationPath,
          handleOutputData: (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          },
        })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
        })
        _mainProcessPort.close()
        return
      }
    }

    // -- Final message --
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })

    // INFO: This step is under development.
    setTimeout(() => {
      _mainProcessPort.close()
    }, 25)
  }

  async compileForDebugger(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: MessagePortMain,
    mainProcessBridge: {
      loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
    },
  ): Promise<void> {
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting debug compilation process...' })

    const [projectPath, boardTarget, projectData] = args as [string, string, PLCProjectData]

    const boardRuntime = await this.#getBoardRuntime(boardTarget)
    const normalizedProjectPath = projectPath.replace('project.json', '')
    const compilationPath = join(normalizedProjectPath, 'build', boardTarget)
    const sourceTargetFolderPath = join(compilationPath, 'src')

    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling for debugger - project: ${projectPath}, board: ${boardTarget}`,
    })

    try {
      const strucppCheckResult = this.checkStrucppAvailability()
      _mainProcessPort.postMessage({
        message: `STruC++ available at version ${strucppCheckResult.data}`,
      })
    } catch (_error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${String(_error)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      await this.createBasicDirectories(normalizedProjectPath, boardTarget)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: 'Directories for compilation source files created.',
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${getErrorMessage(error)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      const generateXMLResult = await this.handleGenerateXMLfromJSON(sourceTargetFolderPath, projectData)
      _mainProcessPort.postMessage({
        logLevel: 'info',
        message: `Generated XML from JSON at: ${generateXMLResult.data?.xmlPath as string}`,
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error generating XML from JSON: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    const generatedXMLFilePath = join(sourceTargetFolderPath, 'plc.xml')
    try {
      await this.handleTranspileXMLtoST(generatedXMLFilePath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error transpiling XML to ST: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    try {
      await this.copyStaticFiles(compilationPath, boardRuntime)
      _mainProcessPort.postMessage({ logLevel: 'info', message: 'Static files copied successfully.' })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error copying static files: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // Compile ST to C++ with STruC++ (replaces iec2c + debug + glue generation)
    try {
      const hasCBlocks = ((projectData as ProjectDataWithCppPous).originalCppPous?.length ?? 0) > 0
      const knownPous = buildKnownPous(projectData.pous)
      const enabledLibraryNames = (projectData.libraries ?? []).map((ref) => ref.name)
      const { archives: libraries, missing: missingLibraries } =
        mainProcessBridge.loadEnabledArchives(enabledLibraryNames)
      await this.handleCompileSTtoCpp(
        sourceTargetFolderPath,
        (data, logLevel, compileError) => {
          _mainProcessPort.postMessage({
            logLevel,
            message: data,
            ...(compileError ? { compileError } : {}),
          })
        },
        { hasCBlocks, pous: knownPous, libraries, missingLibraries },
      )
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Generate C/C++ blocks header file
    try {
      await this.handleGenerateCBlocksHeader(projectData, sourceTargetFolderPath, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    // Generate C/C++ blocks code file
    try {
      await this.handleGenerateCBlocksCode(projectData, compilationPath, boardRuntime, (data, logLevel) => {
        _mainProcessPort.postMessage({ logLevel, message: data })
      })
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: typeof error === 'string' ? error : error instanceof Error ? error.message : JSON.stringify(error),
      })
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: 'Stopping debug compilation process.',
      })
      _mainProcessPort.close()
      return
    }

    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: 'Debug compilation completed successfully.',
    })
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })
    setTimeout(() => {
      _mainProcessPort.close()
    }, 25)
  }

  /**
   * Build a `.stlib` archive from a Library Project on disk.
   *
   * The orchestration intentionally mirrors `compileProgram`'s
   * stream-back pattern: status / error messages travel over the
   * MessagePort, and a final `libraryBuildResult` field on the
   * close-port message carries the structured outcome the adapter
   * surfaces to the renderer.
   *
   * Flow:
   *   1. Read `<projectPath>/library.json` from disk (the manifest
   *      tab's surgical save has already written the live buffer
   *      ahead of this call — Phase 5).
   *   2. `prepareXmlForLibraryBuild` validates the manifest and
   *      emits the XML xml2st consumes.  Manifest errors fail fast
   *      here without spawning xml2st.
   *   3. Persist plc.xml under `<projectPath>/build/library/src/`
   *      and run the existing `handleTranspileXMLtoST` helper so
   *      this path shares the xml2st spawn / error-handling code
   *      the program build already uses.
   *   4. Read xml2st's program.st back and hand it +
   *      knownPous + manifest to `libraryBuildFromTranspiledSt`,
   *      which drops the synthetic stub and calls strucpp's
   *      `compileStlib`.
   *   5. Write the archive (same `JSON.stringify(archive, null, 2)`
   *      shape `library-manager-module` persists user-installed
   *      archives with) to `<projectPath>/build/<name>.stlib`.
   *   6. (Phase 8) Run an end-to-end avr-gcc verification compile
   *      against the OpenPLC Simulator target, gated by an MD5
   *      cache keyed off the produced program.st.  Verification
   *      failures surface as warnings on `result.verification`,
   *      never as build errors — a legitimate user target may have
   *      more memory than the AVR simulator.  `cleanBuild` skips
   *      the cache and forces a re-verification.
   */
  async compileLibrary(
    args: Array<string | PLCProjectData | boolean>,
    _mainProcessPort: MessagePortMain,
    mainProcessBridge: LibraryCompileBridge,
  ): Promise<void> {
    _mainProcessPort.start()

    const post = (message: string, logLevel: 'info' | 'warning' | 'error' = 'info') =>
      _mainProcessPort.postMessage({ logLevel, message })

    // Sends the structured result and closes the port.  No
    // `closePort: true` flag is needed on the payload: the
    // renderer-side bridge already synthesises one callback for the
    // MessagePort `'close'` event the `setTimeout` triggers, and
    // posting an explicit flag in the same message just made the
    // adapter fire its closePort branch twice (once via onmessage,
    // once via the close listener).  Keep the 25 ms delay so the
    // result payload is delivered before the port closes.
    const finish = (result: CompileLibraryResult) => {
      _mainProcessPort.postMessage({ libraryBuildResult: result })
      setTimeout(() => _mainProcessPort.close(), 25)
    }

    // Single-shot error path used by every "fail-fast" stage below.
    // Every stage that aborts the build with one error message posts
    // it to the console then forwards the same string as `error` on
    // the structured result; this helper collapses both calls so the
    // 8 fail-fast sites read as one line each.  Extra fields (e.g.
    // `libraryName` once the manifest is known) can be threaded via
    // the second arg.
    const bail = (msg: string, extra: Partial<CompileLibraryResult> = {}) => {
      post(msg, 'error')
      finish({ success: false, error: msg, ...extra })
    }

    // The renderer adapter sends two preprocessed datasets:
    //   - `projectData` (formerly the only one) is preprocessed with
    //     `isSimulator: false` — Python POUs carry the full
    //     Python-as-ST conversion, C++ POUs carry the ST stub +
    //     `originalCppPous` sidecar.  Used for the library build
    //     itself (Stages 1–6).
    //   - `verifyProjectData` is preprocessed with `isSimulator:
    //     true` — Python POUs are no-op stubs the AVR simulator
    //     can compile cleanly; C++ POUs are unchanged.  Used as
    //     input to `composeVerificationProject` so the verify
    //     compile (Stage 3) doesn't try to link Python loader
    //     externs the simulator runtime doesn't ship.
    //
    // Both datasets share the same source POU list, just with
    // different Python treatment.  C++ POUs and ST/IL/data-types
    // are identical between them.
    const [projectPath, projectData, verifyProjectData, cleanBuild = false] = args as [
      string,
      PLCProjectData,
      PLCProjectData,
      boolean | undefined,
    ]
    const normalizedProjectPath = projectPath.replace('project.json', '')

    post('Starting library build...')

    // Stage 0: read manifest from disk.
    const manifestPath = join(normalizedProjectPath, 'library.json')
    let manifestJson: string
    try {
      manifestJson = await readFile(manifestPath, { encoding: 'utf8' })
    } catch (error) {
      bail(`Could not read library.json: ${getErrorMessage(error)}`)
      return
    }

    // Stage 1: manifest validation + XML generation.
    const project: PLCProject = {
      meta: { name: '', type: 'plc-library' as const },
      data: projectData as unknown as PLCProjectData,
    }
    const stage1 = prepareXmlForLibraryBuild(project, manifestJson)
    if ('error' in stage1) {
      bail(stage1.error)
      return
    }
    const { xml, knownPous, manifest } = stage1
    post(`Manifest OK — building "${manifest.name}" v${manifest.version}.`)

    // Persist plc.xml in an isolated `library` build sub-directory so
    // it doesn't collide with the program-build artefacts when both
    // modes coexist on the same project tree.
    const libraryBuildDir = join(normalizedProjectPath, 'build', 'library')
    const libraryBuildSrcDir = join(libraryBuildDir, 'src')
    try {
      await fs.rm(libraryBuildDir, { recursive: true, force: true })
      await mkdir(libraryBuildSrcDir, { recursive: true })
    } catch (error) {
      bail(`Could not prepare build directory: ${getErrorMessage(error)}`)
      return
    }

    const xmlPath = join(libraryBuildSrcDir, 'plc.xml')
    try {
      await writeFile(xmlPath, xml, 'utf-8')
    } catch (error) {
      bail(`Could not write plc.xml: ${getErrorMessage(error)}`)
      return
    }

    // Stage 2: xml2st spawn (shared with the program-build path).
    try {
      await this.handleTranspileXMLtoST(xmlPath, (data, logLevel) => {
        // xml2st's stdout doubles as progress + error stream; surface
        // it verbatim so the user sees the same diagnostics the
        // program-build path produces.
        const message = typeof data === 'string' ? data : data.toString()
        post(message, logLevel ?? 'info')
      })
    } catch (error) {
      bail(`xml2st failed: ${getErrorMessage(error)}`)
      return
    }

    // Stage 3: read program.st + run library compile.
    const programStPath = join(libraryBuildSrcDir, 'program.st')
    let programSt: string
    try {
      programSt = await readFile(programStPath, { encoding: 'utf8' })
    } catch (error) {
      bail(`Could not read program.st from xml2st output: ${getErrorMessage(error)}`)
      return
    }

    // Resolve project-enabled libraries up front — these archives feed
    // both verification (so the simulator compile sees the same symbols
    // a real user would) and `compileStlib` below.  Missing names fail
    // the build with the same "open the Library Manager" message
    // `compileProgram` uses, before either heavy step runs.
    const enabledLibraryRefs = (projectData.libraries ?? []).map((ref) => ({
      name: ref.name,
      version: ref.version,
    }))
    const { archives: depArchives, missing: missingDeps } = mainProcessBridge.loadEnabledArchives(
      enabledLibraryRefs.map((r) => r.name),
    )
    if (missingDeps.length > 0) {
      bail(
        `Library build aborted: enabled libraries are not installed (${missingDeps.join(', ')}). ` +
          `Open the Library Manager to install or remove them.`,
        { libraryName: manifest.name },
      )
      return
    }

    // Stage 3: end-to-end C++ verification against the OpenPLC
    // Simulator target — same strucpp → arduino-cli → bundled avr-gcc
    // pipeline the program build uses, so the editor never depends on
    // a host compiler.  Runs BEFORE the `.stlib` write so the artefact
    // generation is unconditionally the last step: whatever the
    // verification outcome, the user always sees a fresh `.stlib` on
    // disk when "Library built successfully" lands.
    //
    // Verification is advisory: a failure surfaces as a warning, not
    // a build error.  A legitimate user target may have more memory
    // than the AVR simulator, and the tight AVR memory budget the
    // simulator imposes is exactly the constraint many real
    // industrial targets don't share.
    //
    // The MD5 cache short-circuits the slow compile when the
    // already-verified program.st hasn't changed.  `cleanBuild`
    // skips the cache and forces a re-verification.
    const programStMd5 = crypto.createHash('md5').update(programSt).digest('hex')
    // Keep the cache OUTSIDE `libraryBuildDir` — that directory is
    // wiped at the start of every build (line ~3119 above), so a
    // cache file living inside it would never survive between
    // runs.  Sitting one level up in `build/` keeps it adjacent to
    // the build outputs without being clobbered.
    const verifyCachePath = join(normalizedProjectPath, 'build', '.verify-cache-library.json')
    let cachedVerification: CompileLibraryResult['verification']
    if (!cleanBuild) {
      try {
        const raw = await readFile(verifyCachePath, { encoding: 'utf8' })
        const parsed = JSON.parse(raw) as { md5?: string; success?: boolean; message?: string }
        if (parsed && parsed.md5 === programStMd5 && typeof parsed.success === 'boolean') {
          cachedVerification = { success: parsed.success, message: parsed.message }
        }
      } catch {
        // Missing or malformed cache — fall through to fresh
        // verification.  Never fail the build over the cache.
      }
    }

    let verification: CompileLibraryResult['verification']
    if (cachedVerification) {
      verification = cachedVerification
      post(
        `Skipping verification (cached: ${cachedVerification.success ? 'pass' : 'fail'}). ` +
          'Use "Clean build" to force re-verification.',
      )
    } else {
      // Feed `composeVerificationProject` the verify-preprocessed
      // dataset (Python POUs as no-op stubs) — the AVR simulator's
      // compile path can't link the Python loader externs the
      // full Python-as-ST shape produces.  The build dataset
      // (Python as full ST) is intentionally NOT used here.
      const verifyProject = composeVerificationProject({
        meta: { name: manifest.name, type: 'plc-library' },
        data: verifyProjectData as unknown as PLCProjectData,
      })
      post('Verifying with OpenPLC Simulator (avr-gcc)...')
      try {
        // Stream the inner pipeline's output through the renderer
        // port with a `[verify]` prefix so the user sees the same
        // strucpp + arduino-cli progress they'd see on a normal
        // simulator build.  Critical for two reasons:
        //   - avr-gcc compile can take 10+ seconds on a library
        //     with a lot of C++; a silent console looks frozen.
        //   - When verification fails, the user needs the actual
        //     compile diagnostic, not just the summary line.
        // The success line at the bottom of compileLibrary still
        // comes after this stream — `.stlib` generation is the
        // last step regardless of verification outcome.
        verification = await this.runVerificationCompile(
          normalizedProjectPath,
          verifyProject.data,
          mainProcessBridge,
          (message, logLevel) =>
            // Demote inner errors to warnings on the way out.
            // The library's own `.stlib` will still be produced,
            // so an `[verify]` line being level=error in the
            // console would falsely suggest the build failed.
            _mainProcessPort.postMessage({
              logLevel: logLevel === 'error' ? 'warning' : (logLevel ?? 'info'),
              message: `[verify] ${message}`,
            }),
        )
        try {
          await writeFile(
            verifyCachePath,
            JSON.stringify({ md5: programStMd5, ...verification }, null, 2),
            'utf-8',
          )
        } catch (cacheErr) {
          post(`Could not write verification cache: ${getErrorMessage(cacheErr)}`, 'warning')
        }
      } catch (err) {
        verification = { success: false, message: getErrorMessage(err) }
      }
      if (verification.success) {
        post('Verification passed.')
      } else {
        post(
          `Verification reported issues (warning only — .stlib will still be generated): ${verification.message ?? 'see log'}`,
          'warning',
        )
      }
    }

    // Stage 4: gather per-symbol documentation from the editor view
    // so `decorateArchive` can stamp it onto the manifest entries.
    // POUs contribute their "Description" field; data types
    // contribute their own optional `documentation` field.
    const pouDocs: Record<string, string> = {}
    for (const pou of projectData.pous) {
      if (pou.data.documentation && pou.data.documentation.length > 0) {
        pouDocs[pou.data.name] = pou.data.documentation
      }
    }
    for (const dt of projectData.dataTypes ?? []) {
      const doc = (dt as { documentation?: string }).documentation
      if (typeof doc === 'string' && doc.length > 0) {
        pouDocs[(dt as { name: string }).name] = doc
      }
    }

    // Stage 5: strucpp `compileStlib` — splits program.st per-POU,
    // drops the synthetic main, builds the archive.  Hard failures
    // here (xml2st-malformed output, strucpp internal errors) stop
    // the build because we have no archive to ship.  These are NOT
    // advisory like verification — strucpp owns the artefact format.
    // Pull the C/C++ FBs out of the preprocessed data — they live
    // on `originalCppPous` (placed there by `preprocessPous`'s C++
    // branch).  These ride through the archive verbatim; strucpp
    // never sees them.  The consumer-side compile reads them back
    // and routes them through the existing user-C++-block path
    // with a `<library_name>__<block_name>` rename for collision
    // avoidance.
    const cppBlocks = (
      (projectData as { originalCppPous?: Array<{ name: string; code: string; variables: unknown[] }> })
        .originalCppPous ?? []
    ).map((b) => ({
      name: b.name,
      code: b.code,
      variables: b.variables,
    }))

    const stage2 = libraryBuildFromTranspiledSt(programSt, knownPous, manifest, {
      pouDocs,
      dependencyArchives: depArchives,
      dependencyRefs: enabledLibraryRefs,
      cppBlocks,
    })
    if (!stage2.success) {
      for (const err of stage2.errors) {
        const where = err.file ? `[${err.file}${err.line ? `:${err.line}` : ''}] ` : ''
        post(`${where}${err.message}`, 'error')
      }
      finish({
        success: false,
        error: stage2.errors[0]?.message ?? 'Library compilation failed.',
        libraryName: manifest.name,
      })
      return
    }

    // Stage 6 (final): serialise the archive to disk.  Same JSON
    // shape `library-manager-module` persists user-installed archives
    // with, so a future "build then install" round-trip uses the
    // identical on-disk format.  This is unconditionally the last
    // step so the user's "Library built successfully" line refers
    // to a fresh artefact, never a stale one.
    const stlibPath = join(normalizedProjectPath, 'build', `${manifest.name}.stlib`)
    try {
      await mkdir(join(normalizedProjectPath, 'build'), { recursive: true })
      await writeFile(stlibPath, JSON.stringify(stage2.archive, null, 2) + '\n', 'utf-8')
    } catch (error) {
      bail(`Could not write ${manifest.name}.stlib: ${getErrorMessage(error)}`)
      return
    }

    post(`Library built successfully: ${stlibPath}`)
    finish({ success: true, stlibPath, libraryName: manifest.name, verification })
  }

  /**
   * Run an end-to-end verification compile of a synthetic Library
   * Project against the OpenPLC Simulator target.  Reuses the full
   * `compileProgram` pipeline (strucpp → arduino-cli → bundled
   * avr-gcc) by feeding it a private `MessageChannelMain` — verifies
   * the same way the program build does, against the same binaries,
   * with zero code duplication.
   *
   * `forwardLog` is the caller's drain for the inner pipeline's
   * message stream.  Streaming the strucpp / arduino-cli output is
   * the difference between "blank console for 30 seconds while
   * arduino-cli compiles" and "user sees progress" — and crucially
   * the difference between "the .stlib generated but verification
   * failed silently" and "the user knows which C++ line tripped
   * avr-gcc".  We do keep the first error message internally so the
   * summary line at the end of the build is succinct, but every log
   * line still flows through.
   *
   * Resolves with `{success, message?}` either when the inner
   * pipeline posts `closePort: true` (happy path) or when its port
   * closes without one (the many error paths in `compileProgram`).
   * Never throws — matches the caller's "verification is advisory"
   * contract.
   */
  private async runVerificationCompile(
    projectPath: string,
    verifyData: PLCProjectData,
    bridge: LibraryVerificationBridge,
    forwardLog: (message: string, logLevel?: 'info' | 'warning' | 'error') => void,
  ): Promise<{ success: boolean; message?: string }> {
    // Look up the simulator board's core ID from `hals.json` —
    // single source of truth shared with the renderer-side
    // `boardInfo.core` lookup.  Falls back to a sensible default
    // only if hals.json has been mangled; the resulting compile
    // would fail at `core install` and surface as a verification
    // warning, which is the documented advisory behaviour.
    const SIMULATOR_BOARD = 'OpenPLC Simulator'
    const boardCore = (await this.#getBoardCore(SIMULATOR_BOARD)) ?? 'arduino:avr'

    return new Promise((resolve) => {
      const channel = new MessageChannelMain()
      let firstError: string | null = null
      let settled = false

      const settle = (result: { success: boolean; message?: string }) => {
        if (settled) return
        settled = true
        try {
          channel.port1.close()
        } catch {
          // Already closed — fine.
        }
        resolve(result)
      }

      channel.port1.on('message', (event) => {
        const data = event.data as {
          message?: unknown
          logLevel?: 'info' | 'warning' | 'error'
          closePort?: boolean
        }
        if (data.message !== undefined) {
          // `decodePortMessage` returns readable text from the
          // `Uint8Array` Node `Buffer` payloads survive structured
          // clone as.  Without it, `.toString()` on a Uint8Array
          // would render comma-separated byte numbers in the
          // console.
          const text = decodePortMessage(data.message)
          // Forward every line — the caller decides how to render
          // them (PLC-build path would prepend `[verify]`).  Even
          // info-level messages matter here: avr-gcc compile can
          // take 10+ seconds on a large library and the user needs
          // to see progress.
          forwardLog(text, data.logLevel)
          // Keep only the FIRST error string for the summary.  Once
          // arduino-cli or strucpp errors, the cascade usually
          // continues with knock-on failures; the first one names
          // the underlying cause.
          if (data.logLevel === 'error' && firstError === null) {
            firstError = text
          }
        }
        if (data.closePort) {
          settle(firstError ? { success: false, message: firstError } : { success: true })
        }
      })
      // `compileProgram` posts intermediate `closePort: true` messages
      // on its happy path but jumps straight to `port.close()` on its
      // many error paths, without an explicit close message.  Listen
      // for the port's 'close' event so an inner-pipeline error can't
      // leave the outer library build hanging on an unresolved promise
      // — same convention the renderer-side adapter uses.
      channel.port1.on('close', () => {
        settle(firstError ? { success: false, message: firstError } : { success: true })
      })
      channel.port1.start()

      // The boolean slots (compileOnly / cleanBuild) are runtime
      // values the inner `compileProgram` re-casts off `args as [...]`,
      // so the outer cast is needed to silence the strict arg type
      // (which only admits `string | null | PLCProjectData`).
      const compileArgs = [
        projectPath,
        SIMULATOR_BOARD,
        boardCore,
        true,
        verifyData,
        null,
        null,
        true,
      ] as unknown as Array<string | null | PLCProjectData>
      void this.compileProgram(compileArgs, channel.port2, bridge).catch((err) =>
        settle({ success: false, message: getErrorMessage(err) }),
      )
    })
  }
}
export { CompilerModule }
