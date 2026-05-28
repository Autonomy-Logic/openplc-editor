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
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  prepareXmlForLibraryBuild,
} from '@root/backend/shared/library/build-pipeline'
import { buildKnownPous, emitCompileErrorEvents } from '@root/backend/shared/library/program-build-helpers'
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
import { runCompilePipeline } from '@root/backend/shared/compile/pipeline'
import { generateDefinesContent } from '@root/backend/shared/compile/steps/generate-defines'
import { mergeStrucppRuntimeIntoSkeleton } from '@root/backend/shared/compile/steps/merge-strucpp-runtime-into-skeleton'
import { resolveBoardSelection } from '@root/backend/shared/compile/steps/resolve-board-selection'
import { readHalsFile } from '@root/backend/shared/firmware/hals-loader'
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
import { validatePathId } from '@root/backend/shared/utils/path-safety'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import { generateVendorPluginConfig } from '@root/backend/shared/utils/vpp/generate-vendor-plugin-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import type { CompileLibraryResult } from '@root/middleware/shared/ports/types'
import { app as electronApp, dialog, MessageChannelMain } from 'electron'
import type { MessagePortMain } from 'electron/main'
import JSZip from 'jszip'

import type { PackageManifest } from '../package-manager'
import { PackageManagerModule } from '../package-manager'
import { CreateXMLFile } from '../utils'
import { createEditorCompilerPlatformPort } from './editor-compiler-platform-port'
import type { ArduinoCoreControl, HalsFile } from './types'

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

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  xml2stBinaryPath: string

  strucppRuntimeDir: string

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

  // ############################################################################
  // =========================== Static methods =================================
  // ############################################################################
  static async readJSONFile<T>(filePath: string): Promise<T> {
    const data = await readFile(filePath, 'utf-8')
    return JSON.parse(data) as T
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

  async #getBoardRuntime(board: string) {
    const halsFileContent = await readHalsFile<HalsFile>()
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

  /**
   * Read the disk inputs `generateDefinesContent` needs (hals.json,
   * pin-mapping.json, program.st) and write the authored `defines.h`
   * to `build/<target>/src/defines.h`.
   *
   * The content-authoring logic lives in the shared
   * `backend/shared/compile/steps/generate-defines.ts` so the web's
   * pipeline can produce the same byte-for-byte `defines.h` from
   * the same inputs.  This method is thin glue around the shared
   * function — filesystem reads in, write call out.
   *
   * `defines.h` lives alongside `arduino.cpp` in `src/`.  The HAL
   * templates include it as plain `"defines.h"` so the file is found
   * whether arduino-cli compiles the source in place or moves it
   * into its sketch sandbox first — avoids the directory-relative
   * include that broke on paths with spaces and on VM shared-folder
   * mounts.
   */
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
    const devicesPinMappingFilePath = join(projectPath, 'devices', 'pin-mapping.json')
    const buildTargetDirectoryPath = join(projectPath, 'build', boardTarget)
    const stProgramFilePath = join(buildTargetDirectoryPath, 'src', 'program.st')
    const definitionsFilePath = join(buildTargetDirectoryPath, 'src', 'defines.h')

    const halsFileContent = await readHalsFile<HalsFile>()
    const devicePinMapping = await CompilerModule.readJSONFile<DevicePin[]>(devicesPinMappingFilePath)
    const stProgramFileContent = await readFile(stProgramFilePath, 'utf-8')

    const definesContent = generateDefinesContent({
      boardEntry: halsFileContent[boardTarget],
      devicePinMapping,
      stProgramFileContent,
      buildMD5Hash,
      boardRuntime,
    })

    try {
      await writeFile(definitionsFilePath, definesContent, { encoding: 'utf8' })
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

    const halsFileContent = await readHalsFile<HalsFile>()

    const boardSourceFile = halsFileContent[boardTarget]['source']

    const boardSourceFilePath = join(this.sourceDirectoryPath, 'hal', boardSourceFile)
    const arduinoCppFilePath = join(projectPath, 'build', boardTarget, 'src', 'arduino.cpp')

    try {
      await cp(boardSourceFilePath, arduinoCppFilePath, { recursive: true })
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
    boardRuntime: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks_code.cpp generation', 'info')
      return
    }

    const cppPous = originalCppPous
    // generateCBlocksCode now emits the full file (baseline + per-POU
    // wrappers + user code), so we overwrite rather than append. The
    // static Baremetal/c_blocks_code.cpp baseline is now redundant for
    // projects with C++ POUs but stays as a benign empty unit for
    // Arduino projects without any.
    const codeContent = generateCBlocksCode(cppPous)

    const codeFilePath =
      boardRuntime === 'openplc-compiler'
        ? join(compilationPath, 'src', 'c_blocks_code.cpp')
        : join(compilationPath, 'examples', 'Baremetal', 'c_blocks_code.cpp')

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

  async handleCompileArduinoProgram({
    boardHalsContent,
    compilationPath,
    handleOutputData,
    cleanBuild,
  }: CompileArduinoProgramArgs) {
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    if (cleanBuild) {
      handleOutputData('Clean build requested — arduino-cli cache will be invalidated.', 'info')
    }

    // The AVR toolchain doesn't ship a C++ stdlib; we bundle a
    // freestanding port at resources/sources/avr-libstdcpp/include
    // and pass it via -I.  Electron's user-data dir on macOS is
    // `~/Library/Application Support/<App>/`, and arduino-cli's
    // recipe substitution gets confused by quoted paths with embedded
    // spaces — so mirror the headers into a no-space cache directory
    // on first compile.  Versioned cache key self-invalidates on
    // editor upgrades that ship new headers.
    const avrLibStdCppInclude = boardHalsContent['core']?.startsWith('arduino:avr')
      ? await this.ensureAvrLibStdCppCache()
      : undefined

    // Shared with openplc-web's compiler-adapter — single source of
    // truth for arduino-cli compile argv composition.  Editor passes
    // `-j 0` (parallel: default true) to saturate cores on developer
    // machines; web passes parallel: false because compiler-service
    // multiplexes many clients in nsjail sandboxes.
    const buildProjectFlags = [
      ...buildArduinoCliCompileArgs(boardHalsContent, {
        sketchPath: join(baremetalPath, 'Baremetal.ino'),
        libraryPath: join(compilationPath, 'src'),
        avrLibStdCppInclude,
        cleanBuild,
      }),
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
          const vppPluginsConfContent = `${pluginName},./build/vpp/lib${pluginName}_plugin.so,1,1,./build/vpp/${pluginName}.json,\n`
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
        const fileHash = createHash('sha256')
          .update(fileContent as unknown as Uint8Array)
          .digest('hex')
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
    ]

    const halsContent = await readHalsFile<HalsFile>()
    const selection = resolveBoardSelection(
      halsContent as Record<string, Parameters<typeof resolveBoardSelection>[0][string]>,
      boardTarget,
    )
    // Resolved fields the rest of compileProgram consumes.  Default
    // to the shared resolver's output when the board lives in
    // hals.json; otherwise (VPP boards installed via `.vpp` packages)
    // fall back to the package-manager lookup so the runtime kind +
    // flags still reflect the user's selection.
    let boardEntry: Parameters<typeof runCompilePipeline>[0]['boardEntry']
    let boardRuntime: string
    let isSimulator: boolean
    let isRuntimeV3: boolean
    let isRuntimeV4: boolean
    if (selection.ok) {
      boardEntry = selection.boardEntry as unknown as Parameters<typeof runCompilePipeline>[0]['boardEntry']
      boardRuntime = selection.boardRuntime
      isSimulator = selection.isSimulator
      isRuntimeV3 = selection.isRuntimeV3
      isRuntimeV4 = selection.isRuntimeV4
    } else {
      // VPP fallback — board lives in an installed `.vpp` package
      // rather than hals.json.  Derive the runtime from the manifest's
      // `target.type` (matches the pre-refactor `#getBoardRuntime`
      // behaviour that fed all subsequent branching).  Web doesn't
      // need this fallback — its installed-package surface is empty
      // by design — so it stays in the editor-specific branch here.
      let vppRuntime: 'openplc-compiler' | 'arduino-cli' | null = null
      try {
        const packageManager = new PackageManagerModule()
        for (const pkg of packageManager.listInstalled()) {
          const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
          if (!manifest) continue
          const device = manifest.devices.find((d) => d.name === boardTarget)
          if (device) {
            vppRuntime = device.target.type === 'runtime-v4' ? 'openplc-compiler' : 'arduino-cli'
            break
          }
        }
      } catch {
        // Package manager errors fall through to the no-match path
        // below — same behaviour as `#getBoardRuntime`.
      }
      if (!vppRuntime) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `Board "${boardTarget}" not found in hals.json or installed VPP packages.`,
        })
        _mainProcessPort.postMessage({ logLevel: 'error', message: 'Stopping compilation process.' })
        _mainProcessPort.close()
        return
      }
      // VPP boards don't ship a hals.json entry — feed the pipeline
      // an empty placeholder.  The runtime-v4 / Arduino branches the
      // pipeline picks based on the flags below don't dereference
      // `boardEntry.platform` until the arduino-cli compile step,
      // which doesn't run for runtime-v4 (VPP boards' canonical
      // target).
      boardEntry = {} as unknown as Parameters<typeof runCompilePipeline>[0]['boardEntry']
      boardRuntime = vppRuntime
      isRuntimeV3 = boardTarget === 'OpenPLC Runtime v3'
      isRuntimeV4 = vppRuntime === 'openplc-compiler' && !isRuntimeV3
      isSimulator = false
    }
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
        // call into.  Editor's pre-refactor `handleGenerateArduinoCppFile`
        // copied `resources/sources/hal/<boardEntry.source>` to
        // `src/arduino.cpp`.  Read it here so the shared merge step
        // can drop it into the firmware skeleton at the canonical
        // path; without it, the link fails with `undefined reference
        // to hardwareInit` etc.
        let boardHalContent: string | undefined
        const boardSource = (boardEntry as { source?: string } | undefined)?.source
        if (typeof boardSource === 'string' && boardSource.length > 0) {
          const halPath = join(this.sourceDirectoryPath, 'hal', boardSource)
          try {
            boardHalContent = await readFile(halPath, 'utf-8')
          } catch (halErr) {
            _mainProcessPort.postMessage({
              logLevel: 'warning',
              message: `Could not read board HAL file at ${halPath}: ${getErrorMessage(halErr)}`,
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
        devicePinMapping = await CompilerModule.readJSONFile<DevicePin[]>(
          join(normalizedProjectPath, 'devices', 'pin-mapping.json'),
        )
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
        sendRuntimeUpload: (opts) => this.sendRuntimeUpload(opts),
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
        // loader expects.
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
          await writeFile(verifyCachePath, JSON.stringify({ md5: programStMd5, ...verification }, null, 2), 'utf-8')
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
