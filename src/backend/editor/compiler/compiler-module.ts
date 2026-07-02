import { spawn } from 'node:child_process'
import crypto, { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { join, resolve as pathResolve, sep as pathSep } from 'node:path'

import type { VppModbusScreenState } from '@root/backend/shared/compile/steps/modbus-defines'
import { resolveBoardSelection } from '@root/backend/shared/compile/steps/resolve-board-selection'

import { execRecipeArgv, substitutePlaceholders, tokenizeRecipe } from './recipe-exec'
import { runWithConcurrencyLimit } from './run-with-concurrency'

// strucpp is loaded lazily because it uses ESM features (import.meta) that are
// incompatible with Jest's CJS transform — see `backend/shared/library/strucpp-runtime`.
// Only the `CompileError` type leaks into this module's surface (via the
// `handleOutputData` callback) — every other strucpp interaction goes through
// the shared `runProgramBuildPipeline`.
type StrucppCompileError = import('strucpp').CompileError

import { buildArduinoCliCompileArgs } from '@root/backend/shared/firmware/build-arduino-cli-args'
import { runLibraryBuildPipeline } from '@root/backend/shared/library/library-build-orchestrator'
import { buildKnownPous, emitCompileErrorEvents } from '@root/backend/shared/library/program-build-helpers'
import { runProgramBuildPipeline } from '@root/backend/shared/library/program-build-pipeline'
import { loadStrucpp } from '@root/backend/shared/library/strucpp-runtime'
import {
  fromSchemaShape,
  type SchemaProjectData,
  transpileToSt as runJsonTranspiler,
} from '@root/backend/shared/transpilers/st-transpiler'
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
    endpoint: string,
    responseParser?: (data: string) => T,
  ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
  // Required to satisfy compileProgram's bridge contract; never invoked on the
  // library path (it compiles with runtimeIpAddress=null, so no upload runs).
  makeRuntimeApiUpload: (opts: {
    ipAddress: string
    fileBuffer: Buffer
    filename: string
    contentType: string
    cleanBuild: boolean
    onUploadAccepted?: (responseBody: string) => void
  }) => Promise<{ success: true; data: string } | { success: false; error: string }>
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
import { isNewTranspilerEnabled } from '@root/backend/editor/utils/transpiler-mode'
import { runCompilePipeline } from '@root/backend/shared/compile/pipeline'
import { mergeStrucppRuntimeIntoSkeleton } from '@root/backend/shared/compile/steps/merge-strucpp-runtime-into-skeleton'
import { readHalsFile } from '@root/backend/shared/firmware/hals-loader'
import type { DeviceConfiguration, DevicePin } from '@root/backend/shared/types/PLC/devices'
import type { PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import {
  type CppPouData as CppPouDataCode,
  generateCBlocksCode,
} from '@root/backend/shared/utils/cpp/generateCBlocksCode'
import {
  type CppPouData as CppPouDataHeader,
  generateCBlocksHeader,
} from '@root/backend/shared/utils/cpp/generateCBlocksHeader'
import { validatePathId } from '@root/backend/shared/utils/path-safety'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import {
  buildModuleConfigEntries,
  generateVendorPluginConfig,
} from '@root/backend/shared/utils/vpp/generate-vendor-plugin-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { app as electronApp, dialog, MessageChannelMain } from 'electron'
import type { MessagePortMain } from 'electron/main'
import JSZip from 'jszip'

import type { PlatformOption } from '../../../middleware/shared/ports/types'
import { BoardInfoResolver } from '../../shared/hardware/board-info-resolver'
import type { PackageManifest } from '../package-manager'
import { PackageManagerModule } from '../package-manager'
import { CreateXMLFile } from '../utils'
import { createDesktopLibraryBuildPort } from './desktop-library-build-port'
import { createEditorCompilerPlatformPort } from './editor-compiler-platform-port'
import type { ArduinoCoreControl, HalsFile, ToolchainProperties } from './types'

interface MethodsResult<T> {
  success: boolean
  data?: T
}
type HandleOutputDataCallback = (chunk: Buffer | string, logLevel?: 'info' | 'warning' | 'error') => void

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

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.xml2stBinaryPath = this.#constructXml2stBinaryPath()

    this.strucppRuntimeDir = this.#constructStrucppRuntimeDir()
  }

  /**
   * Build a `BoardInfoResolver` wired with the editor's filesystem-
   * backed adapters.  Hals.json content is read off the bundled
   * `src/backend/shared/firmware/hals.json` (the shared catalogue
   * editor and web both consume), so this method is `async` — the
   * resolver itself is synchronous.
   *
   * Web's matching adapter (when VPP-on-web lands) builds a resolver
   * with the same `BoardInfoResolverConfig` interface but
   * browser-friendly path strings + a real (or no-op) package
   * manager; the shared `BoardInfoResolver` is byte-identical
   * between repos.
   */
  async #createBoardInfoResolver(): Promise<BoardInfoResolver> {
    const halsContent = await readHalsFile<HalsFile>()
    return new BoardInfoResolver({
      halsContent,
      packageManager: new PackageManagerModule(),
      resolveHalSourcePath: (rel) => join(this.sourceDirectoryPath, 'hal', rel),
      resolvePackageRelativePath: (pkgPath, relPath) => {
        const root = pathResolve(pkgPath)
        const candidate = pathResolve(root, relPath)
        if (candidate !== root && !candidate.startsWith(root + pathSep)) {
          throw new Error(`Path "${relPath}" escapes package directory ${pkgPath}`)
        }
        return candidate
      },
    })
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
   * Single source of truth: reads from the shared
   * `backend/shared/firmware/hals.json` bundle, the same file the
   * renderer's `bridge.getAvailableBoards()` exposes via
   * `boardInfo.core`.
   * Used internally by the library-project verification path so a
   * future hals.json edit (rename, new board, version bump)
   * propagates to verification automatically — without any code
   * change here.
   */
  async #getBoardCore(board: string): Promise<string | null> {
    const halsFileContent = await readHalsFile<HalsFile>()
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

  #executeArduinoCliCommand(args: string[]) {
    let arduinoCliBinaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      arduinoCliBinaryPath += '.exe'
    }
    return spawn(arduinoCliBinaryPath, args)
  }

  #executeXml2st(args: string[]) {
    let xml2stBinaryPath = this.xml2stBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      xml2stBinaryPath += '.exe'
    }
    return spawn(xml2stBinaryPath, args)
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

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    // INFO: We use the version command to check if the arduino-cli is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await execRecipeArgv([binaryPath, 'version', flag, configFilePath, '--json'])
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

    // `--show-properties=expanded` tells arduino-cli to evaluate every
    // `{var}` interpolation in `platform.txt` / `boards.txt` before printing
    // — without `=expanded`, recipes come back with raw `{compiler.path}`
    // placeholders that would be useless for direct toolchain invocation.
    //
    // Spawned via execFile (no shell) so paths containing spaces or shell
    // metacharacters (`Program Files (x86)`, `Arduino IDE` etc.) reach
    // arduino-cli intact on every host. Going through cmd.exe on Windows
    // would corrupt the argv exactly the way the recipe-driven compile
    // path used to break for the Leonardo USB descriptors.
    const argv = [
      binaryPath,
      'compile',
      '--fqbn',
      fqbn,
      '--show-properties=expanded',
      dummySketchPath,
      ...this.arduinoCliBaseParameters,
    ]

    const { stdout } = await execRecipeArgv(argv, { maxBuffer: 8 * 1024 * 1024 })

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
  /**
   * Load the firmware skeleton files (`resources/sources/arduino/*`
   * + `resources/sources/Baremetal/**`) into an in-memory file map
   * keyed by the canonical project-root-relative paths the shared
   * `composeFirmwareBundle` expects.
   *
   * Editor's existing `copyStaticFiles` materialises these to disk
   * between pipeline steps; the shared pipeline routes them through
   * `composeFirmwareBundle` as a `Record<string, string>` instead so
   * the same composition logic works on web (where there's no
   * filesystem).  This helper bridges the gap: it walks the on-disk
   * skeleton once and returns it in the canonical shape.
   *
   * Path mapping (matches `copyStaticFiles`'s on-disk layout):
   *   - `resources/sources/arduino/<file>` → `src/<file>`
   *   - `resources/sources/Baremetal/<file>` → `examples/Baremetal/<file>`
   *   - `resources/sources/Baremetal/modules/<file>` → `examples/Baremetal/modules/<file>`
   *
   * Strucpp runtime headers (`src/<filename>.hpp`) come from
   * `loadStrucppRuntimeHeaders` separately — they have a different
   * source path (`node_modules/strucpp/...`) and the shared
   * `composeRuntimeV4Bundle` puts them under
   * `strucpp_runtime/include/<filename>` instead of `src/`.  Callers
   * pick the right one for their target.
   *
   * `boardRuntime === 'openplc-compiler'` (runtime v4) returns an
   * empty map — the v4 bundle is composed by `composeRuntimeV4Bundle`
   * which sources strucpp runtime headers from
   * `loadStrucppRuntimeHeaders` directly, no Arduino skeleton
   * needed.
   */
  async loadFirmwareSkeletonInMemory(boardRuntime: string): Promise<Record<string, string>> {
    if (boardRuntime === 'openplc-compiler') {
      return {}
    }
    const arduinoDir = join(this.sourceDirectoryPath, 'arduino')
    const baremetalDir = join(this.sourceDirectoryPath, 'Baremetal')
    const files: Record<string, string> = {}

    // arduino/* → src/*
    try {
      const arduinoEntries = await readdir(arduinoDir, { withFileTypes: true })
      await Promise.all(
        arduinoEntries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const content = await readFile(join(arduinoDir, e.name), 'utf-8')
            files[`src/${e.name}`] = content
          }),
      )
    } catch {
      // arduino/ may be absent in odd setups — leave the skeleton
      // empty so the pipeline / composer surfaces a clear error
      // downstream instead of crashing here.
    }

    // Baremetal/* → examples/Baremetal/* (plus modules subdir).
    try {
      const baremetalEntries = await readdir(baremetalDir, { withFileTypes: true })
      await Promise.all(
        baremetalEntries.map(async (e) => {
          if (e.isFile()) {
            const content = await readFile(join(baremetalDir, e.name), 'utf-8')
            files[`examples/Baremetal/${e.name}`] = content
          } else if (e.isDirectory() && e.name === 'modules') {
            const moduleEntries = await readdir(join(baremetalDir, 'modules'), { withFileTypes: true })
            await Promise.all(
              moduleEntries
                .filter((m) => m.isFile())
                .map(async (m) => {
                  const content = await readFile(join(baremetalDir, 'modules', m.name), 'utf-8')
                  files[`examples/Baremetal/modules/${m.name}`] = content
                }),
            )
          }
        }),
      )
    } catch {
      // Same defensive posture as the arduino/ block above.
    }

    return files
  }

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
    extraXml2stArgs: readonly string[],
  ) {
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      // `extraXml2stArgs` comes from the shared pipeline's
      // `TranspileXmlToStArgs.xml2stArgs` — the single source of truth
      // for xml2st flag semantics across editor and web.  Editor passes
      // them through verbatim (trusted local binary); web's adapter
      // filters against its known-args allowlist before sending to the
      // compile-service.  Strucpp targets currently pass
      // `['--keep-structs']` (native STRUCT declarations vs matiec's
      // legacy struct→FB rewrite); future flags appear here as the
      // pipeline opts into them.
      const executeCommand = this.#executeXml2st(['--generate-st', generatedXMLFilePath, ...extraXml2stArgs])

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
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error', compileError?: StrucppCompileError) => void,
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
      // Hand the structured diagnostics to the shared
      // `emitCompileErrorEvents` helper so the editor and the web
      // build emit the exact same per-error log shape — the
      // bracketed `[POU / body line N]` first line that the
      // renderer's `useNavigateToCompileError` hook uses as a click
      // target.  `handleOutputData` already has the right signature
      // (`message, level, compileError?`) — no adapter needed.
      // Throw afterwards so the outer catch posts only the
      // high-level marker line without re-dumping every error blob.
      emitCompileErrorEvents(result.errors, handleOutputData)
      throw new Error('STruC++ compilation failed')
    }

    for (const warn of result.warnings) {
      handleOutputData(warn.formatted, 'info', warn.raw)
    }

    await Promise.all(
      result.files.map((f) => writeFile(join(sourceTargetFolderPath, f.name), f.content, { encoding: 'utf8' })),
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
    coreVersion?: string,
  ) {
    if (boardCore === null) return

    const isCoreInstalled = Object.keys(await this.getArduinoInstalledCores()).some((core) => core === boardCore)
    // Without a pinned version, any installed version is fine — skip the install.
    // With a pinned version (prebuilt arduino libraries are ABI-locked to it),
    // always run `core install <id>@<version>`: arduino-cli installs exactly that
    // version and fails if it does not exist, pinning the core to the version
    // the precompiled library was built against.
    if (!coreVersion && isCoreInstalled) {
      handleOutputData(`Core ${boardCore} is already installed.`, 'info')
      return
    }

    const coreRef = coreVersion ? `${boardCore}@${coreVersion}` : boardCore
    if (coreVersion) {
      handleOutputData(`Installing pinned core ${coreRef} (required by a prebuilt library)...`, 'info')
    }

    let binaryPath = this.arduinoCliBinaryPath

    if (CompilerModule.HOST_PLATFORM === 'win32') {
      // INFO: On Windows, we need to add the .exe extension to the binary path.
      binaryPath += '.exe'
    }
    return new Promise<MethodsResult<string | Buffer>>((resolve, reject) => {
      const executeCommand = spawn(binaryPath, ['core', 'install', coreRef, ...this.arduinoCliBaseParameters])

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

  /**
   * Install every arduino-cli library the selected board needs.
   *
   * Inputs are layered:
   *   - `GLOBAL_LIBRARIES`     — always-on libs that pre-date the
   *                              per-board contract (DallasTemperature,
   *                              OneWire, etc.).  Will shrink over time
   *                              as boards take ownership of their own
   *                              dependencies via `extra_libraries`.
   *   - `extraLibraries`       — per-board libs forwarded from the
   *                              `BoardBuildInfo.extraArduinoLibraries`
   *                              field.  Sourced from `hals.json`
   *                              `extra_libraries` (static boards) or
   *                              the VPP manifest's `hal.extraArduinoLibraries`
   *                              (installed VPP boards).  Keeps board-
   *                              specific deps (Arduino_Opta_Blueprint
   *                              for the Opta, P1AM for the P1AM board)
   *                              out of every user's install footprint.
   *
   * Failure contract: this method does NOT throw on a non-zero
   * `arduino-cli lib install` exit.  Install is opportunistic — the
   * library the user needs may already be available from another
   * source the editor doesn't manage (system-wide install, user
   * sketchbook, custom library path).  We log a warning that names
   * the libs we couldn't install + arduino-cli's stderr, then
   * resolve cleanly so the build continues.  The downstream
   * `arduino-cli compile` step is the source of truth: if a required
   * library is genuinely unresolvable, compile fails with a precise
   * "header not found" error pointing at the file that needed it.
   */
  async handleLibraryInstallation(extraLibraries: string[], handleOutputData: HandleOutputDataCallback) {
    const requiredLibraries = Array.from(new Set([...CompilerModule.GLOBAL_LIBRARIES, ...extraLibraries]))

    if (extraLibraries.length > 0) {
      handleOutputData(`Per-board libraries: ${extraLibraries.join(', ')}`, 'info')
    }

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

    handleOutputData(`Installing missing libraries: ${missingLibraries.join(', ')}`, 'info')

    // The promise never rejects — install failures are caught inside
    // the close handler and converted to warnings, so `reject` is
    // intentionally unused (underscore-prefixed to satisfy the
    // unused-vars rule).
    return new Promise<MethodsResult<string | Buffer>>((resolve, _reject) => {
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
          resolve({ success: true })
        } else {
          // Soft failure — log a warning with the libs we couldn't
          // install and arduino-cli's stderr, then resolve cleanly.
          // The build continues; if the missing library is actually
          // required, the arduino-cli compile step will fail with a
          // precise header-not-found error.  If the library is
          // already available from a non-managed source (sketchbook,
          // system install) the compile succeeds and the warning is
          // benign.
          const trimmedStderr = stderrData.trim()
          handleOutputData(
            `Warning: arduino-cli lib install exited with code ${code} for: ${missingLibraries.join(', ')}. ` +
              `Continuing build — these libraries may already be available from another source.` +
              (trimmedStderr ? `\n${trimmedStderr}` : ''),
            'warning',
          )
          resolve({ success: true })
        }
      })
    })
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

  // handlePatchGeneratedFiles is no longer needed.
  // STruC++ generates clean C++ files (generated.cpp + generated.hpp) that don't require
  // patching or unity build renaming.

  async handleGenerateArduinoCppFile(projectPath: string, boardTarget: string) {
    let result: MethodsResult<string> = { success: false }

    // Source the HAL .cpp from BoardInfoResolver so the same code path works
    // for legacy hals.json entries and installed VPP packages (where only
    // Simulator / Runtime v3 / Runtime v4 remain in hals.json; every Arduino
    // board lives in a VPP).
    const resolver = await this.#createBoardInfoResolver()
    const info = resolver.resolve(boardTarget)
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

  // Extract every absolute `@<path>` response-file reference from a
  // tokenized recipe (post-`tokenizeRecipe`). Only POSIX `/...` and
  // Windows `C:\...`/`C:/...` qualify — relative `@-` tokens are
  // workspace-local files the editor must not touch. Pure function so
  // the regex can be unit-tested without filesystem side effects.
  static extractResponseFilesFromArgv(argv: ReadonlyArray<string>): string[] {
    const responseFileRe = /^@([A-Za-z]:[\\/].+|\/.+)$/
    const seen = new Set<string>()
    for (const token of argv) {
      const match = responseFileRe.exec(token)
      if (match) seen.add(match[1])
    }
    return Array.from(seen)
  }

  // Stub empty files for `@response_file` paths a recipe references but
  // that arduino-cli would only generate during a real compile (ESP32 +
  // STM32duino). GCC treats missing `@file` as a literal positional
  // argument → "cannot specify '-o' with '-c' ... with multiple files".
  // Empty is the canonical default arduino-cli itself writes when no
  // per-project build_opt customization exists.
  //
  // Takes the already-tokenized argv (post-`tokenizeRecipe`) so the
  // surrounding-quote concern from the legacy regex form goes away —
  // quotes are stripped by tokenization and the response-file token
  // arrives as `@<absolute-path>` cleanly.
  private static async ensureResponseFileStubs(
    argv: ReadonlyArray<string>,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    for (const responsePath of CompilerModule.extractResponseFilesFromArgv(argv)) {
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
    const sourcesStash = join(compilationPath, 'precompile', 'sources')
    const objDir = join(compilationPath, 'precompile', 'obj')

    // Stash strucpp-emitted .cpp out of src/ BEFORE compile, then read the
    // stash to discover the TU set. Two reasons:
    //
    //   1. arduino-cli's library discovery walks the sketch tree and will
    //      recompile any .cpp it finds under src/ with the core's default
    //      C++ standard. Moving the strucpp TUs out before arduino-cli runs
    //      keeps the gnu++17 archive's symbols as the only definition.
    //
    //   2. Recovery from a partial previous run becomes trivial. If a prior
    //      invocation crashed between compile and archive, the .cpp files
    //      are already in the stash — a retry stashes the (now empty) src/,
    //      reads the stash, and re-runs the whole pipeline from there. No
    //      half-stashed split-brain state.
    //
    // arduino.cpp (the board HAL) is excluded — arduino-cli must compile
    // that one alongside the sketch so it picks up the core's external
    // libraries (Ethernet, SPI, …) discovered via sketch-tree includes.
    await mkdir(sourcesStash, { recursive: true })
    await mkdir(objDir, { recursive: true })

    const srcEntries = await readdir(srcDir)
    for (const name of srcEntries) {
      if (!name.endsWith('.cpp') || name === 'arduino.cpp') continue
      // rename overwrites the stash entry if a previous run left a stale
      // copy — the src/ version is the latest strucpp output and wins.
      await fs.rename(join(srcDir, name), join(sourcesStash, name))
    }

    // Discover the TU set from the stash so newly-moved files AND any
    // leftovers from a previous failed run get picked up uniformly.
    // Sorted for deterministic archive-member ordering downstream.
    const stashEntries = (await readdir(sourcesStash)).filter((name) => name.endsWith('.cpp')).sort()
    const sources = stashEntries.map((name) => join(sourcesStash, name))

    if (sources.length === 0) {
      throw new Error(`handlePrecompileUserLib: no .cpp sources found under ${srcDir} or ${sourcesStash}`)
    }

    // -I arguments are passed as bare argv entries (no extra quoting) —
    // execFile delivers them literally to the toolchain on every host.
    //
    // arduino-cli normally injects `-I{build.core.path}` and
    // `-I{build.variant.path}` into the `{includes}` substitution at
    // compile time — those are where `Arduino.h` and `pins_arduino.h`
    // live. The platform.txt recipe expands `-I{build.core.path}/tinyusb`
    // etc. literally, but the *base* core path comes from `{includes}`.
    // Renesas's recipe in particular leaves the base out, so a TU like
    // `c_blocks_code.cpp` that does `#include <Arduino.h>` fails the
    // precompile with "Arduino.h: No such file or directory". Mirroring
    // arduino-cli's injection here keeps every TU finding the core/
    // variant headers regardless of how the core author chose to wire
    // its recipe template.
    const corePath = tcProps.properties['build.core.path']
    const variantPath = tcProps.properties['build.variant.path']
    if (!corePath) {
      throw new Error(
        `Toolchain pre-compile requires build.core.path from arduino-cli --show-properties for "${fqbn}". ` +
          `The board's core is likely not installed.`,
      )
    }
    // `-I` flags from `extraCxxFlags` (canonically: `-I<avr-libstdcpp>`
    // and any VPP-package -I directives) must be ordered BEFORE the
    // core/variant `-I`s — mirroring arduino-cli's recipe, which
    // interpolates `{compiler.cpp.extra_flags}` ahead of `{includes}`.
    //
    // Why this is load-bearing: modm-io/avr-libstdcpp's `<new>` declares
    // `operator new` / `operator new[]` with `__externally_visible__`
    // (strong linkage), whereas Arduino's `cores/arduino/new` declares
    // the same operators with `[[gnu::weak]]`. Whichever header the
    // preprocessor finds first determines the linkage of `_Znaj` /
    // `_Znwj` references emitted from `new T[]` / `new T` in this TU.
    // Weak undefined references DO NOT pull the matching definition
    // from `core.a/new.cpp.o` during link (ld only scans archives for
    // strong refs), so the call site resolves to address 0 (the AVR
    // reset vector) — manifesting as an infinite reset loop the
    // moment any precompiled TU executes a `new` expression.
    //
    // Non-include flags (`-std=`, `-fno-rtti`, anything else from VPP
    // `cxx_flags`) stay trailing so the last `-std=` wins over the
    // core's implicit gnu++11.
    const extraIncludeFlags = extraCxxFlags.filter((flag) => flag.startsWith('-I'))
    const extraNonIncludeFlags = extraCxxFlags.filter((flag) => !flag.startsWith('-I'))
    const includeArgs = [
      ...extraIncludeFlags,
      `-I${corePath}`,
      ...(variantPath ? [`-I${variantPath}`] : []),
      `-I${srcDir}`,
      `-I${baremetalDir}`,
    ]
    const trailingFlags = ['-std=gnu++17', '-fno-rtti', ...extraNonIncludeFlags]

    const execMaxBuffer = 16 * 1024 * 1024

    // Tokenize the raw recipe once — placeholders stay intact and are
    // substituted per-TU below. Going through tokenizeRecipe up-front
    // means POSIX-quoted segments like `'-DUSB_PRODUCT="Arduino Leonardo"'`
    // collapse to a single argv entry with the literal `"…"` preserved,
    // regardless of host shell.
    const recipeTokens = tokenizeRecipe(tcProps.recipeCpp)

    handleOutputData(`[precompile] Compiling ${sources.length} TU(s) with toolchain for ${fqbn}...`, 'info')

    // Build the .o path list synchronously up-front so the archive members
    // land in source-file order regardless of the concurrent compile result.
    const objectFiles = sources.map((sourcePath) => join(objDir, path.basename(sourcePath).replace(/\.cpp$/, '.o')))

    // Cap concurrent toolchain spawns at the host's logical core count.
    // An unbounded `sources.map(async …)` was dispatching one g++ per TU
    // simultaneously — on Windows each one drags a cmd.exe shim along
    // and a 30-TU project would launch 30 parallel processes regardless
    // of how many cores the host actually has. `os.cpus().length` is the
    // standard ceiling; the floor of 1 inside `runWithConcurrencyLimit`
    // covers environments where `os.cpus()` reports zero.
    const compileConcurrency = os.cpus().length

    await runWithConcurrencyLimit(sources, compileConcurrency, async (sourcePath, idx) => {
      const objectPath = objectFiles[idx]

      const argv = [
        ...substitutePlaceholders(recipeTokens, {
          '{source_file}': sourcePath,
          '{object_file}': objectPath,
          '{includes}': includeArgs,
        }),
        ...trailingFlags,
      ]

      await CompilerModule.ensureResponseFileStubs(argv, handleOutputData)

      try {
        const { stdout, stderr } = await execRecipeArgv(argv, { maxBuffer: execMaxBuffer })
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

    // Build the ar command manually instead of using recipe.ar.pattern —
    // cores disagree on placeholder semantics: mbed uses `{archive_file_path}`
    // (full path, usable) while AVR uses `{archive_file}` (bare filename with
    // build cache dir baked into the recipe, which would write to the wrong place).
    const archivePath = join(compilationPath, 'precompile', 'libOpenPLCUserLib.a')
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
    const arFlags = (tcProps.properties['compiler.ar.flags'] ?? 'rcs').split(/\s+/).filter(Boolean)
    const arExtraFlags = (tcProps.properties['compiler.ar.extra_flags'] ?? '').split(/\s+/).filter(Boolean)
    // ar argv: <bin> <flags> <extra_flags> <archive> <objects…>. All paths
    // land as plain argv entries so spaces, parentheses, or other shell
    // metacharacters in the build path can't break the invocation.
    const archiveArgv = [`${compilerPath}${arName}`, ...arFlags, ...arExtraFlags, archivePath, ...objectFiles]

    handleOutputData(`[precompile] Archiving ${objectFiles.length} object(s) into libOpenPLCUserLib.a...`, 'info')
    await execRecipeArgv(archiveArgv, { maxBuffer: execMaxBuffer })

    // Sources were stashed before compile (see `await fs.rename` block at
    // the top of this method) so arduino-cli's library discovery doesn't
    // see them in src/ at all. No post-archive move step needed.

    // arduino-cli's precompiled-lib resolution picks ONE subdir per core,
    // and the convention varies: AVR uses build.mcu ("atmega2560"), mbed
    // uses build.architecture ("cortex-m7"), others fall back to build.arch.
    // We collect every candidate so installAsArduinoLibrary can lay the
    // archive under all of them — duplicating a few-hundred-KB file in the
    // /tmp staging is cheaper than maintaining a per-core mapping. The
    // first entry doubles as the canonical `archDir` used for -L injection.
    //
    // Hard-fail when none of the three properties is present. The legacy
    // fallback to a literal "unknown" subdir put the archive somewhere
    // arduino-cli's resolver would never look, producing an opaque
    // undefined-symbols link error far downstream from the real cause.
    // A loud error here names the FQBN and the missing properties so the
    // user has the exact info to file an issue against the editor or the
    // core's platform.txt.
    const archCandidates = Array.from(
      new Set(
        [tcProps.properties['build.mcu'], tcProps.properties['build.architecture'], tcProps.properties['build.arch']]
          .filter((s): s is string => Boolean(s))
          .map((s) => s.toLowerCase()),
      ),
    )
    if (archCandidates.length === 0) {
      throw new Error(
        `Toolchain arch subdir resolution failed for "${fqbn}": arduino-cli ` +
          `--show-properties=expanded did not expose any of ` +
          `build.mcu, build.architecture, or build.arch. Without one of ` +
          `these, arduino-cli's precompiled-library resolver cannot locate ` +
          `libOpenPLCUserLib.a and the link step would fail with an opaque ` +
          `undefined-symbols error. Please file an issue including the FQBN ` +
          `and the core's platform.txt so this can be mapped.`,
      )
    }

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
    const resolver = await this.#createBoardInfoResolver()
    const info = resolver.resolve(boardTarget)
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
    const cxxFlagsArg =
      cxxFlags.length > 0 ? ['--build-property', `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`] : []
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
      // Prebuilt arduino-hal (mixed): the vendor's precompiled library. The
      // open hal.source layer (renamed to arduino.cpp, compiled here alongside
      // the sketch — NOT in the precompile pass) does `#include "p1am_vendor.h"`,
      // so arduino-cli needs the lib's src/ on the include path. Passing it as a
      // 2nd --library both resolves the boundary header and auto-links the
      // src/<build.mcu>/lib*.a archive (the lib ships precompiled=full).
      ...(info.precompiledLibraryDir ? ['--library', info.precompiledLibraryDir] : []),
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
    communicationPort,
    handleOutputData,
  }: {
    projectPath: string
    arduinoPlatform: string
    compilationPath: string
    /**
     * Serial port arduino-cli should target with `--port`.  Preferred
     * over the disk-persisted value when both are present — captures
     * the picker's current selection even when the user hasn't saved
     * the project yet.  When omitted, the handler falls back to the
     * legacy disk read so older invocation paths still work.
     */
    communicationPort?: string
    handleOutputData: HandleOutputDataCallback
  }) {
    let port = communicationPort
    if (!port) {
      const devicesDirectoryPath = join(projectPath, 'devices')
      const devicesConfigurationFilePath = join(devicesDirectoryPath, 'configuration.json')
      try {
        const { communicationPort: persistedPort } =
          await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
        port = persistedPort
      } catch {
        // No devices/configuration.json yet — drop into the
        // "no port specified" branch below for a clear user message.
      }
    }
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

  // Runtime upload moved to MainProcessBridge.makeRuntimeApiUpload so it shares
  // the single token authority (transparent refresh + retry on an expired JWT).

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
        // ZIP entry names must use forward slashes (the ZIP spec separator).
        // path.join would emit backslashes on Windows, which a POSIX runtime
        // then treats as literal filename characters rather than directory
        // separators — breaking extraction of every nested file.
        const zipPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

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

          // Read the GPIO pin-mapping for pin-based boards (capabilities.
          // pinMapping). The generator turns these into the plugin config's
          // pins[] array. Module-based boards have no pins, so this stays
          // empty and no pins[] key is emitted.
          //
          // Like the main compile path above, this file has two on-disk
          // shapes (per `pinMappingFileSchema`): per-board dict
          // `{ [boardName]: DevicePin[] }` for post-refactor projects,
          // and the legacy flat `DevicePin[]` for older saves. Handle
          // both — pre-refactor we only handled the array branch, which
          // meant new projects fed the VPP packager no pins at all.
          let devicePins: DevicePin[] = []
          try {
            const pinMappingPath = join(normalizedProjectPath, 'devices', 'pin-mapping.json')
            const pinMappingRaw = await readFile(pinMappingPath, 'utf-8')
            const parsedPins: unknown = JSON.parse(pinMappingRaw)
            if (Array.isArray(parsedPins)) {
              devicePins = parsedPins as DevicePin[]
            } else if (parsedPins && typeof parsedPins === 'object') {
              const dict = parsedPins as Record<string, DevicePin[]>
              devicePins = dict[boardTarget] ?? []
            }
          } catch {
            // No pin-mapping file — leave empty.
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
          const finalConfig = generateVendorPluginConfig(configTemplate, vendorScreenData, modules, devicePins)

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
          const vppPluginsConfContent = `${pluginName},./build/vpp/lib${pluginName}_plugin.so,1,1,./build/vpp/${pluginName}.json,\n`
          const vppPluginsConfPath = join(sourceTargetFolderPath, 'vpp_plugins.conf')
          await writeFile(vppPluginsConfPath, vppPluginsConfContent, 'utf-8')
          handleOutputData('Generated vpp_plugins.conf', 'info')
        }
      } else {
        handleOutputData('VPP board has no HAL configTemplate, skipping plugin config generation', 'info')
      }

      // --- Step 2: Copy plugin payload + generate checksum ---
      const pluginEntryRelPath = matchingDevice.hal?.pluginEntry
      if (!pluginEntryRelPath) {
        handleOutputData('VPP board has no HAL pluginEntry, skipping plugin source upload', 'info')
        return
      }

      // Resolve the plugin directory. In "source" mode (default) pluginEntry is
      // the entry source file, so the dir is its parent. In "prebuilt" mode
      // (provisioning === 'prebuilt') pluginEntry is the directory itself,
      // holding the precompiled .o objects plus the link-only Makefile.
      // pluginEntryRelPath is supplied by the package manifest; without
      // containment, an entry like `../../../etc` would resolve outside
      // matchingPackagePath and the recursive-copy below would slurp
      // arbitrary host files into the build's vpp_plugin directory.
      const isPrebuilt = matchingDevice.hal?.provisioning === 'prebuilt'
      const pluginDirRelPath = isPrebuilt ? pluginEntryRelPath : path.dirname(pluginEntryRelPath)
      const pluginSourceDir = join(matchingPackagePath, pluginDirRelPath)
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
        const fileHash = createHash('sha256')
          .update(fileContent as unknown as Uint8Array)
          .digest('hex')
        hash.update(`${fileHash}  ${relFile}\n`)
      }
      const combinedHash = hash.digest('hex')
      await writeFile(join(destPluginDir, 'checksum.sha256'), combinedHash + '\n', 'utf-8')

      handleOutputData(
        `Copied ${copiedFiles.length} VPP plugin ${isPrebuilt ? 'prebuilt' : 'source'} file(s) to vpp_plugin/ (checksum: ${combinedHash.slice(0, 12)}...)`,
        'info',
      )
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      handleOutputData(`Failed VPP plugin packaging: ${errorMessage}`, 'error')
    }
  }

  /**
   * Compute per-slot module-configuration bytes for an Arduino VPP
   * target with a modular backplane.
   *
   * Microcontroller boards have no runtime JSON, so per-module config
   * (analog ranges, thermocouple types, ...) must be baked into the
   * firmware. This resolves the installed VPP device for `boardTarget`,
   * loads each module's configScreen, and encodes the same bytes the
   * runtime-v4 plugin path would — keyed by 1-based slot. The caller
   * injects them into `vendorScreenData` under a synthetic
   * `module-config` key so the `vpp_config.h` generator emits
   * `VPP_MODULE_CONFIG_ENTRIES_*` macros for the HAL.
   *
   * Returns [] for non-modular / non-VPP boards. Never throws.
   */
  async buildVppArduinoModuleConfig(
    boardTarget: string,
    vendorScreenData: Record<string, unknown>,
  ): Promise<Array<{ slot: number; bytes: number[] }>> {
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

      const rawModules = matchingDevice?.moduleSystem?.modules
      if (!matchingDevice || !matchingPackagePath || !rawModules || rawModules.length === 0) return []

      const pkgPath = matchingPackagePath
      const modules = await Promise.all(
        rawModules.map(async (m) => {
          let configScreenDefinition: unknown
          const rel = (m as { configScreen?: string }).configScreen
          if (rel) {
            try {
              const raw = await readFile(join(pkgPath, rel), 'utf-8')
              configScreenDefinition = JSON.parse(raw)
            } catch {
              // Missing/invalid configScreen — module contributes no bytes.
            }
          }
          return { ...m, configScreenDefinition }
        }),
      )

      return buildModuleConfigEntries(
        vendorScreenData as Parameters<typeof buildModuleConfigEntries>[0],
        modules as Parameters<typeof buildModuleConfigEntries>[1],
      )
    } catch {
      return []
    }
  }

  /**
   * Main compile entry point.  Drives the full Step 0-13 flow
   * through the shared `runCompilePipeline` orchestrator
   * (`backend/shared/compile/pipeline.ts`); platform-specific bits
   * (xml2st spawn, arduino-cli spawn, runtime upload) are abstracted
   * behind `EditorCompilerPlatformPort`.  Single source of truth
   * for compile behaviour shared with openplc-web.
   */
  async compileProgram(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: MessagePortMain,
    mainProcessBridge: {
      makeRuntimeApiRequest: <T = void>(
        ipAddress: string,
        endpoint: string,
        responseParser?: (data: string) => T,
      ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
      makeRuntimeApiUpload: (opts: {
        ipAddress: string
        fileBuffer: Buffer
        filename: string
        contentType: string
        cleanBuild: boolean
        onUploadAccepted?: (responseBody: string) => void
      }) => Promise<{ success: true; data: string } | { success: false; error: string }>
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
    _mainProcessPort.start()
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting compilation process...' })

    const [
      projectPath,
      boardTarget,
      boardCore,
      compileOnly,
      projectData,
      runtimeIpAddress,
      runtimeJwtToken,
      cleanBuild,
      communicationPort,
      vendorScreenData,
    ] = args as [
      string,
      string,
      string | null,
      boolean,
      PLCProjectData,
      string | null,
      string | null,
      boolean | undefined,
      string | null | undefined,
      Record<string, unknown> | undefined,
    ]

    // Resolve board info uniformly across hals.json + installed VPP
    // packages via the shared `resolveBoardSelection` helper — the
    // same code path runs on web (no VPP packages installed → falls
    // through to hals-only).  `halsContent` is still read separately
    // because `boardHalsContent` below needs the raw entry slice.
    const halsContent = await readHalsFile<HalsFile>()
    const resolver = await this.#createBoardInfoResolver()
    const selection = resolveBoardSelection(resolver, boardTarget)
    if (!selection.ok) {
      _mainProcessPort.postMessage({ logLevel: 'error', message: selection.error })
      _mainProcessPort.postMessage({ logLevel: 'error', message: 'Stopping compilation process.' })
      _mainProcessPort.close()
      return
    }
    const { boardEntry, boardRuntime, isSimulator, isRuntimeV3, isRuntimeV4 } = selection

    const normalizedProjectPath = projectPath.replace('project.json', '')
    const compilationPath = join(normalizedProjectPath, 'build', boardTarget)
    const sourceTargetFolderPath = join(compilationPath, 'src')

    // --- Editor-specific preamble: project header, host info, VPP warnings, tool check ---
    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling program for project: ${projectPath} and board target: ${boardTarget}`,
    })
    _mainProcessPort.postMessage({ logLevel: 'warning', message: 'Host Hardware Info:' })
    _mainProcessPort.postMessage({ message: this.getHostHardwareInfo() })

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

    // Create the build/<target>/{src,examples/Baremetal,...} directory tree
    // up front so the platform port methods that write to disk (transpile,
    // compile) have somewhere to land.
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

    // --- Resolve pipeline inputs ---
    let firmwareSkeleton: Record<string, string>
    let strucppRuntimeHeaders: Record<string, string>
    let devicePinMapping: DevicePin[]
    let libraryArchives: unknown[]
    let missingLibraries: string[]
    let avrLibStdCppInclude = ''
    try {
      firmwareSkeleton = await this.loadFirmwareSkeletonInMemory(boardRuntime)
      // Strucpp runtime headers (`debug_dispatch.hpp`,
      // `iec_std_lib.hpp`, etc.) live in two different layouts on
      // disk depending on the target.  For runtime v4 they go under
      // `strucpp_runtime/include/<filename>` (the canonical key
      // `composeRuntimeV4Bundle` expects); for Arduino / simulator
      // builds they go flat at `src/<filename>` next to the
      // strucpp-generated artefacts — matching what editor's old
      // `copyStrucppRuntimeHeaders(sourceTargetFolderPath)` did.
      // For Arduino targets we merge them into the firmware skeleton
      // so arduino-cli's `--library src` pass resolves
      // `#include "debug_dispatch.hpp"` from `ModbusSlave.cpp`.
      strucppRuntimeHeaders = isRuntimeV4 ? await this.loadStrucppRuntimeHeaders() : {}
      if (!isRuntimeV4) {
        const v4Layout = await this.loadStrucppRuntimeHeaders()
        // Board-specific HAL adapter — defines `hardwareInit`,
        // `updateInputBuffers`, `updateOutputBuffers` that the
        // strucpp-generated `Baremetal.ino` + `arduino_runtime_glue.cpp`
        // call into.  `boardInfo.halSourceFile` is an absolute path
        // resolved by `BoardInfoResolver` — works for both legacy
        // hals.json entries (HAL lives under `resources/sources/hal/`)
        // and VPP-installed boards (HAL lives inside the package
        // directory).  Read it here so the shared merge step drops
        // it into the firmware skeleton at the canonical path;
        // without it, the link fails with `undefined reference to
        // hardwareInit` etc.
        // `resolveBoardSelection` above already validated the lookup;
        // this `resolve` call is therefore guaranteed not to throw.
        // Calling it again (rather than threading `halSourceFile`
        // through the selection result) keeps the shared selection
        // type laser-focused on what the pipeline branches on.
        const boardInfo = resolver.resolve(boardTarget)
        let boardHalContent: string | undefined
        if (boardInfo.halSourceFile) {
          try {
            boardHalContent = await readFile(boardInfo.halSourceFile, 'utf-8')
          } catch (halErr) {
            _mainProcessPort.postMessage({
              logLevel: 'warning',
              message: `Could not read board HAL file at ${boardInfo.halSourceFile}: ${getErrorMessage(halErr)}`,
            })
          }
        }
        // Re-key strucpp runtime headers from
        // `strucpp_runtime/include/X` into `src/X` so arduino-cli's
        // `--library src` pass finds them; also drop the board HAL
        // (if loaded) at `src/arduino.cpp`.  Both repos call the
        // same shared helper so a future header-set tweak lands on
        // both platforms in lockstep.
        firmwareSkeleton = mergeStrucppRuntimeIntoSkeleton({
          firmwareSkeleton,
          strucppRuntimeHeaders: v4Layout,
          boardHalContent,
        })
      }
      try {
        // `devices/pin-mapping.json` ships in one of two shapes (the
        // `pinMappingFileSchema` union):
        //   - **Per-board dict** `{ [boardName]: DevicePin[] }` — what
        //     the editor writes after the per-target scoping refactor.
        //     The pipeline only consumes the active target's pins, so
        //     we index in by `boardTarget`.
        //   - **Legacy flat array** `DevicePin[]` — what older projects
        //     have on disk. Their pin set is whatever target they were
        //     last saved against, so we pass it through verbatim.
        //
        // Passing the raw dict to `generateDefinesContent` is the bug
        // that just bit us — `.filter` doesn't exist on an object,
        // and the pipeline crashes with
        // "devicePinMapping.filter is not a function".
        const raw = await CompilerModule.readJSONFile<DevicePin[] | Record<string, DevicePin[]>>(
          join(normalizedProjectPath, 'devices', 'pin-mapping.json'),
        )
        if (Array.isArray(raw)) {
          devicePinMapping = raw
        } else if (raw && typeof raw === 'object') {
          devicePinMapping = raw[boardTarget] ?? []
        } else {
          devicePinMapping = []
        }
      } catch {
        // Projects with no devices/pin-mapping.json (libraries, fresh
        // projects) get an empty array — generateDefinesContent emits
        // empty PINMASK_* entries in that case.
        devicePinMapping = []
      }
      const enabledLibraryNames = (projectData.libraries ?? []).map((ref) => ref.name)
      const archives = mainProcessBridge.loadEnabledArchives(enabledLibraryNames)
      libraryArchives = archives.archives
      missingLibraries = archives.missing
      const coreId = typeof boardEntry?.core === 'string' ? boardEntry.core : ''
      if (coreId.startsWith('arduino:avr')) {
        avrLibStdCppInclude = await this.ensureAvrLibStdCppCache()
      }
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error resolving build inputs: ${getErrorMessage(error)}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    // --- Build the editor's CompilerPlatformPort implementation ---
    const platformPort = createEditorCompilerPlatformPort(
      {
        handleTranspileXMLtoST: this.handleTranspileXMLtoST.bind(this),
        handleCompileArduinoProgram: this.handleCompileArduinoProgram.bind(this),
        handleUploadProgram: this.handleUploadProgram.bind(this),
        handleCoreInstallation: this.handleCoreInstallation.bind(this),
        handleLibraryInstallation: this.handleLibraryInstallation.bind(this),
        handleVendorPluginPackaging: this.handleVendorPluginPackaging.bind(this),
      },
      {
        normalizedProjectPath,
        compilationPath,
        sourceTargetFolderPath,
        boardTarget,
        boardCore,
        boardHalsContent: halsContent[boardTarget],
        cleanBuild: cleanBuild ?? false,
        mainProcessBridge,
        compressSourceFolder: (folderPath: string) => this.compressSourceFolder(folderPath),
        pollTimeoutMs: CompilerModule.COMPILATION_STATUS_TIMEOUT_MS,
        pollIntervalMs: CompilerModule.COMPILATION_STATUS_POLL_INTERVAL_MS,
        startTimeoutMs: POST_BUILD_START_TIMEOUT_MS,
        startIntervalMs: POST_BUILD_START_POLL_INTERVAL_MS,
      },
    )

    // Device context for the runtime-upload step.  Absent when the
    // user hasn't logged in to a runtime — pipeline will skip the
    // upload phase and emit a warning instead.
    const deviceContext =
      runtimeIpAddress && runtimeJwtToken
        ? { kind: 'editor-https' as const, ip: runtimeIpAddress, jwt: runtimeJwtToken }
        : undefined

    // Pull the persisted VPP Modbus screen state from
    // `devices/configuration.json` so non-runtime / non-simulator
    // targets get the matching `MBSERIAL_*` / `MBTCP_*` defines
    // baked into the firmware.  Without this, ModbusSlave.cpp's
    // `#ifdef MBSERIAL` blocks compile to nothing and the board
    // never enables Modbus — at which point the debugger can't
    // talk to it (failing MD5 verification after retries).
    let vppModbusState: VppModbusScreenState | undefined
    if (boardRuntime !== 'simulator' && boardRuntime !== 'openplc-compiler') {
      const devicesConfigurationFilePath = join(normalizedProjectPath, 'devices', 'configuration.json')
      try {
        const deviceConfig = await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
        const vendorScreenData = deviceConfig.vendorScreenData ?? {}
        vppModbusState = {
          modbus_rtu: vendorScreenData['modbus_rtu'] as VppModbusScreenState['modbus_rtu'],
          modbus_tcp: vendorScreenData['modbus_tcp'] as VppModbusScreenState['modbus_tcp'],
        }
      } catch {
        // No configuration.json — leave undefined so the shared
        // pipeline skips the Modbus block entirely (matches the
        // pre-VPP behaviour for boards that never had a comms
        // config persisted).
      }
    }

    // For Arduino VPP targets with a modular backplane, bake the
    // per-slot module-configuration bytes into vpp_config.h (the MCU
    // has no runtime JSON to load them from). The synthetic
    // `module-config` key flows through the generic vpp_config.h walker
    // as VPP_MODULE_CONFIG_ENTRIES_* macros. No-op for non-modular /
    // non-VPP / runtime-v4 / simulator targets.
    let effectiveVendorScreenData = vendorScreenData
    if (!isRuntimeV4 && !isSimulator) {
      const moduleConfigEntries = await this.buildVppArduinoModuleConfig(boardTarget, vendorScreenData ?? {})
      if (moduleConfigEntries.length > 0) {
        effectiveVendorScreenData = { ...(vendorScreenData ?? {}), 'module-config': { entries: moduleConfigEntries } }
      }
    }

    // --- Run the shared pipeline ---
    const result = await runCompilePipeline(
      {
        projectData,
        boardTarget,
        boardRuntime,
        boardEntry,
        devicePinMapping,
        isSimulator,
        isRuntimeV4,
        isRuntimeV3,
        compileOnly: compileOnly ?? false,
        libraryArchives,
        missingLibraries,
        firmwareSkeleton,
        strucppRuntimeHeaders,
        avrLibStdCppInclude,
        // Editor saturates every core on local arduino-cli (matches
        // pre-refactor behaviour); web's adapter sets this to false
        // because the centralised compile-service backend runs many
        // clients in a sandbox.
        arduinoCliParallel: true,
        deviceContext,
        communicationPort: communicationPort ?? undefined,
        ...(vppModbusState ? { vppModbusState } : {}),
        vendorScreenData: effectiveVendorScreenData,
      },
      platformPort,
      (event) => {
        _mainProcessPort.postMessage({
          logLevel: event.level,
          message: event.message,
          ...(event.compileError ? { compileError: event.compileError } : {}),
        })
      },
    )

    // --- Editor-specific epilogue: simulator firmware path + closePort ---
    if (isSimulator) {
      if (compileOnly) {
        _mainProcessPort.postMessage({ logLevel: 'info', message: 'Compilation successful.' })
        _mainProcessPort.postMessage({ closePort: true })
        _mainProcessPort.close()
        return
      }
      if (result.success) {
        // Resolve the per-FQBN sub-directory arduino-cli wrote the
        // .hex into.  Matches the layout the renderer's simulator
        // loader expects.  `boardEntry.platform` is populated by the
        // BoardInfoResolver above (hals.json OR VPP manifest), so
        // this works uniformly for both catalogs.
        const platform = typeof boardEntry?.platform === 'string' ? boardEntry.platform : ''
        const fqbnSubDir = platform.replaceAll(':', '.')
        const hexPath = join(compilationPath, 'examples', 'Baremetal', 'build', fqbnSubDir, 'Baremetal.ino.hex')
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'Compilation successful. Loading firmware into simulator...',
        })
        _mainProcessPort.postMessage({ simulatorFirmwarePath: hexPath, closePort: true })
        _mainProcessPort.close()
        return
      }
      // Failure path on simulator — separator + close.
      _mainProcessPort.postMessage({
        message:
          '-------------------------------------------------------------------------------------------------------------\n',
      })
      _mainProcessPort.close()
      return
    }

    // Runtime v4 / v3 / Arduino-direct paths all converge here.  If
    // an upload happened (or was skipped on purpose), trail the
    // separator and let the renderer pulse-check the deferred close.
    // The upload step itself runs inside `runCompilePipeline` (via
    // `platformPort.uploadArduinoBoard` for direct-Arduino targets,
    // honoring the `compileOnly` flag), so no explicit upload block
    // is needed here.
    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })
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

    const debugResolver = await this.#createBoardInfoResolver()
    const { boardRuntime } = debugResolver.resolve(boardTarget)
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

    if (isNewTranspilerEnabled()) {
      // JSON → ST in-process via `st-transpiler`.  Mirrors what
      // `editor-compiler-platform-port.transpileToSt` does for the
      // shared pipeline path, scoped down to the debug compile here.
      try {
        const ir = fromSchemaShape(projectData as unknown as SchemaProjectData)
        const result = runJsonTranspiler(ir)
        if (result.programSt === null || result.errors.length > 0) {
          const message = result.errors.join('\n') || 'Failed to generate Structured Text'
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message: `${message}\nStopping debug compilation process.`,
          })
          _mainProcessPort.close()
          return
        }
        for (const warning of result.warnings) {
          _mainProcessPort.postMessage({ logLevel: 'info', message: warning })
        }
        await mkdir(sourceTargetFolderPath, { recursive: true })
        const programStPath = join(sourceTargetFolderPath, 'program.st')
        await writeFile(programStPath, result.programSt, 'utf-8')
        _mainProcessPort.postMessage({ logLevel: 'info', message: `ST file generated at: ${programStPath}` })
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `Error transpiling JSON to ST: ${getErrorMessage(error)}\nStopping debug compilation process.`,
        })
        _mainProcessPort.close()
        return
      }
    } else {
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
        await this.handleTranspileXMLtoST(
          generatedXMLFilePath,
          (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          },
          ['--keep-structs'],
        )
      } catch (error) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `Error transpiling XML to ST: ${error as string}\nStopping debug compilation process.`,
        })
        _mainProcessPort.close()
        return
      }
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

    // The IPC args contract is preserved verbatim from the pre-
    // refactor signature so the renderer-side adapter is unchanged:
    //   [projectPath, projectData (build-pass), verifyProjectData,
    //    cleanBuild?]
    const [projectPath, projectData, verifyProjectData, cleanBuild = false] = args as [
      string,
      PLCProjectData,
      PLCProjectData,
      boolean | undefined,
    ]

    // Bridge the orchestrator's structured port API onto the desktop
    // platform's existing helpers.  This is the only desktop-specific
    // glue the library build needs — every stage decision lives in
    // the shared orchestrator from here on.
    const libraryPort = createDesktopLibraryBuildPort({
      transpileXmlToSt: (xmlPath, log, extraArgs) => this.handleTranspileXMLtoST(xmlPath, log, extraArgs),
      loadEnabledArchives: (names) => mainProcessBridge.loadEnabledArchives(names),
      runVerificationCompile: ({ projectPath: p, verifyProjectData: v, emit }) =>
        this.runVerificationCompile(p, v as PLCProjectData, mainProcessBridge, (message, logLevel) =>
          emit(message, logLevel),
        ),
    })

    const result = await runLibraryBuildPipeline(
      {
        projectPath,
        projectData,
        verifyProjectData,
        cleanBuild,
      },
      libraryPort,
      (event) => _mainProcessPort.postMessage({ logLevel: event.level, message: event.message }),
    )

    _mainProcessPort.postMessage({ libraryBuildResult: result })
    // Same 25ms delay the pre-refactor code used so the result
    // message is delivered before the port closes.
    setTimeout(() => _mainProcessPort.close(), 25)
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
