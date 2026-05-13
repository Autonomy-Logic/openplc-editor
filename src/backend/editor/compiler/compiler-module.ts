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
type StrucppFormatDiagnostic = typeof import('strucpp')['formatDiagnostic']
type StrucppCompileError = import('strucpp').CompileError
type StrucppSourceMap = ReturnType<typeof import('strucpp')['buildSourceMap']>

import {
  composeVerificationProject,
  libraryBuildFromTranspiledSt,
  prepareXmlForLibraryBuild,
} from '@root/backend/shared/library/build-pipeline'
import { loadStrucpp } from '@root/backend/shared/library/strucpp-runtime'
import { type KnownPou, splitProgramSt } from '@root/backend/shared/utils/PLC/split-program-st'

/**
 * Wrap strucpp's plain (file:line:col) diagnostic with the POU/section
 * context the new error fields carry, so the editor's console shows
 * something the user can act on:
 *
 *     [Manual_Override / body line 7] Cannot assign WSTRING to BOOL
 *
 * For var-block errors with a known variable name, surface that
 * instead of the raw line number — the variables-table view doesn't
 * always show line numbers (table mode), and a name is more
 * actionable. Falls back to plain formatDiagnostic when none of the
 * new fields are populated (e.g. errors in synthetic _types.st /
 * _config.st sections, or before the splitter ran).
 */
function formatErrorWithPouContext(
  err: StrucppCompileError,
  formatDiagnostic: StrucppFormatDiagnostic,
  sourceMap: StrucppSourceMap,
): string {
  // `preferBodyLine: true` makes strucpp's gcc-style formatter render
  // body errors with the body-relative line in both the header column
  // and the snippet gutter, matching the Monaco body view the user
  // sees and the bracketed `[POU / body line N]` prefix we render
  // alongside.  Var-block errors and non-POU errors are unaffected.
  // CLI and vscode-extension callers don't pass this flag, so their
  // long-standing absolute-file-line output is preserved.
  const base = formatDiagnostic(err, sourceMap, { preferBodyLine: true })
  if (!err.pouName) return base
  let prefix: string
  if (err.section === 'body' && err.bodyLine !== undefined) {
    prefix = `[${err.pouName} / body line ${err.bodyLine}]`
  } else if (err.section === 'var-block') {
    prefix = err.variableName
      ? `[${err.pouName} / variable ${err.variableName}]`
      : `[${err.pouName} / variables, line ${err.line}]`
  } else {
    prefix = `[${err.pouName}]`
  }
  return `${prefix}\n${base}`
}

/**
 * Project data with the optional C++ POU sidecar attached. The base
 * PLCProjectData type doesn't carry C++ POUs because they're an
 * editor-side editor-only artefact; we splice them in for the compile
 * pipeline. Centralised here so the cast appears once instead of
 * inline at every read site.
 */
type ProjectDataWithCppPous = import('@root/backend/shared/types/PLC/open-plc').PLCProjectData & {
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

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { generateEthercatConfig } from '@root/backend/shared/ethercat/generate-ethercat-config'
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
import { generateModbusMasterConfig } from '@root/backend/shared/utils/modbus/generate-modbus-master-config'
import { assertPathContained, validatePathId } from '@root/backend/shared/utils/path-safety'
import { XmlGenerator } from '@root/backend/shared/utils/PLC/xml-generator'
import { parsePlcStatus } from '@root/backend/shared/utils/plc-status'
import { generateVendorPluginConfig } from '@root/backend/shared/utils/vpp/generate-vendor-plugin-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { generateModbusSlaveConfig } from '@root/frontend/utils/modbus/generate-modbus-slave-config'
import { generateOpcUaConfig, OpcUaConfigError } from '@root/frontend/utils/opcua'
import { generateS7CommConfig } from '@root/frontend/utils/s7comm'
import { app as electronApp, dialog, MessageChannelMain } from 'electron'
import type { MessagePortMain } from 'electron/main'
import JSZip from 'jszip'

import type { PackageManifest } from '../package-manager'
import { PackageManagerModule } from '../package-manager'
import { CreateXMLFile } from '../utils'
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
  halsFilePath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  xml2stBinaryPath: string

  strucppRuntimeDir: string
  strucppLibsDir: string

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
    this.strucppLibsDir = this.#constructStrucppLibsDir()
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
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'strucpp',
      'runtime',
      'include',
    )
  }

  #constructStrucppLibsDir(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'strucpp',
      'libs',
    )
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
  async copyStaticFiles(compilationPath: string, boardTarget: string): Promise<MethodsResult<string>> {
    const sourceTargetFolderPath = join(compilationPath, 'src')

    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'Baremetal')

    const filesToCopy: Promise<void>[] = []

    if (boardTarget !== 'openplc-compiler') {
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
    } else {
      // OpenPLC Runtime v4 target: headers go under strucpp_runtime/include/
      // — that's where the runtime's scripts/compile.sh expects them after
      // extracting the upload zip into core/generated/.
      const cBlocksHeaderPath = join(this.sourceDirectoryPath, 'arduino', 'c_blocks.h')
      filesToCopy.push(
        this.copyStrucppRuntimeHeaders(join(sourceTargetFolderPath, 'strucpp_runtime', 'include')),
        cp(cBlocksHeaderPath, join(sourceTargetFolderPath, 'c_blocks.h')),
      )
    }

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
      const executeCommand = this.#executeXml2st(['--generate-st', generatedXMLFilePath])

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
       * Directories `strucpp.libraryPaths` should scan for `.stlib`
       * archives.  When supplied, fully overrides the default
       * "scan strucppLibsDir" behaviour — pass the bundled directory
       * plus any project-enabled user-installed directories.  When
       * omitted, the legacy "scan only strucppLibsDir" path keeps
       * working (bundled-only).
       */
      libraryDirs?: string[]
      /**
       * Names of libraries the project enables but the system pool
       * doesn't currently have on disk.  Surfaced as a pre-compile
       * error so the user gets a clear "open the Library Manager"
       * message instead of strucpp's per-symbol cascade.
       */
      missingLibraries?: string[]
    } = {},
  ): Promise<{ md5Hash: string }> {
    const stFilePath = join(sourceTargetFolderPath, 'program.st')
    const stSource = await readFile(stFilePath, { encoding: 'utf8' })

    handleOutputData('Compiling Structured Text to C++ with STruC++...', 'info')

    const {
      compile: strucppCompile,
      formatDiagnostic: strucppFormatDiagnostic,
      buildSourceMap: strucppBuildSourceMap,
    } = loadStrucpp()

    // Pre-compile gate: every library the project enables must be
    // resolvable on disk before strucpp runs, otherwise the
    // user gets a confusing "function 'X' not found" error per
    // missing symbol instead of a clear "library 'Y' is enabled but
    // not installed" message.
    if (options.missingLibraries && options.missingLibraries.length > 0) {
      const list = options.missingLibraries.join(', ')
      throw new Error(
        `Cannot compile: project enables libraries that are not installed (${list}). ` +
          `Open the Library Manager to install or remove them.`,
      )
    }

    // When the caller supplied a project-scoped directory list (the
    // editor path goes through this), use it as-is — bundled +
    // project-enabled subset only.  Fallback path (no list) scans
    // the strucpp resources dir directly so direct API consumers
    // and old call sites keep working with bundled-only behaviour.
    let libraryPaths: string[] = []
    if (options.libraryDirs && options.libraryDirs.length > 0) {
      libraryPaths = options.libraryDirs
    } else {
      const libsDir = this.strucppLibsDir
      try {
        await fs.access(libsDir)
        libraryPaths = [libsDir]
      } catch {
        // No libs directory available, compile without libraries
      }
    }

    // Precompute MD5 so STruC++ can embed it into debugMap (so the editor
    // can detect stale layouts without re-reading program.st).
    const md5Hash = crypto.createHash('md5').update(stSource).digest('hex')

    // Try to split program.st into per-POU files so strucpp errors come
    // back with `error.file === '<PouName>.st'` and the new
    // pouName/section/bodyLine fields populated. Failure is non-fatal:
    // we fall back to monolithic compilation, which is exactly today's
    // behaviour — the build never breaks because of the splitter.
    const split = options.pous && options.pous.length > 0 ? splitProgramSt(stSource, options.pous) : null
    if (options.pous && options.pous.length > 0 && !split) {
      handleOutputData(
        'ST splitter could not segment program.st; falling back to monolithic compilation. ' +
          'Error line numbers may not match the editor view.',
        'info',
      )
    }

    // Persist the offset table next to the build artefacts even though
    // nothing reads it yet — handy for future iec2c-error remapping on
    // Runtime v3 and trivial to produce.
    if (split) {
      const offsets: Record<string, { kind: string; startLine: number; endLine: number }> = {}
      for (const [name, off] of split.pouOffsets) offsets[name] = off
      await writeFile(
        join(sourceTargetFolderPath, 'program.st.map.json'),
        JSON.stringify({ pouOffsets: offsets }, null, 2),
        { encoding: 'utf8' },
      )
    }

    const stFileName = 'program.st'
    // When the project has C/C++ POUs, every per-POU TU may reference the
    // user-defined `<NAME>_VARS` struct and `<name>_setup` / `<name>_loop`
    // extern declarations. They live in c_blocks.h (generated immediately
    // after this step), so plumb the include through.
    const pouIncludes = options.hasCBlocks ? ['c_blocks.h'] : []

    let primaryFileName = stFileName
    let primarySource = stSource
    let additionalSources: { fileName: string; source: string }[] | undefined
    if (split) {
      const entries = [...split.files.entries()]
      // Take the first as primary; rest go through additionalSources.
      // Order doesn't affect compilation correctness — strucpp merges
      // every parsed unit before semantic analysis.
      const [firstName, firstSource] = entries[0]
      primaryFileName = firstName
      primarySource = firstSource
      additionalSources = entries.slice(1).map(([fileName, source]) => ({ fileName, source }))
    }

    const result = strucppCompile(primarySource, {
      headerFileName: 'generated.hpp',
      fileName: primaryFileName,
      debug: true,
      lineMapping: true,
      libraryPaths,
      md5: md5Hash,
      pouIncludes,
      ...(additionalSources ? { additionalSources } : {}),
    })

    // Source map covers every file we fed strucpp, so formatDiagnostic
    // can pull the offending source line whichever per-POU file the
    // error came from.
    const diagFiles = split
      ? [...split.files.entries()].map(([fileName, source]) => ({ fileName, source }))
      : [{ fileName: stFileName, source: stSource }]
    const diagSourceMap = strucppBuildSourceMap(diagFiles)

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
        const formatted = formatErrorWithPouContext(err, strucppFormatDiagnostic, diagSourceMap)
        handleOutputData(formatted, 'error', err)
      }
      throw new Error('STruC++ compilation failed')
    }

    for (const warn of result.warnings) {
      handleOutputData(
        formatErrorWithPouContext(warn, strucppFormatDiagnostic, diagSourceMap),
        'info',
        warn,
      )
    }

    // STruC++ splits the implementation across one TU per POU plus a
    // shared `configuration.cpp`. The runtime's Makefile picks up
    // every `*.cpp` under core/generated/ via wildcard, so emitting
    // more files just gives `make -j$(nproc)` more parallel work and
    // lets ccache reuse .o files for POUs whose source didn't change.
    // Falling back to `result.cppCode` keeps older strucpp builds (no
    // cppFiles) working — the runtime build sees a single generated.cpp
    // and compiles it serially, exactly as before.
    if (result.cppFiles && result.cppFiles.length > 0) {
      await Promise.all(
        result.cppFiles.map((f) =>
          writeFile(join(sourceTargetFolderPath, f.name), f.content, { encoding: 'utf8' }),
        ),
      )
    } else {
      await writeFile(join(sourceTargetFolderPath, 'generated.cpp'), result.cppCode, { encoding: 'utf8' })
    }
    await writeFile(join(sourceTargetFolderPath, 'generated.hpp'), result.headerCode, { encoding: 'utf8' })

    // Phase 4 debugger artifacts (present starting with strucpp v0.3.0).
    // debugTableCpp is the per-project pointer table for generated_debug.cpp.
    // debugMap is the editor-consumed manifest (path -> (arrayIdx, elemIdx)).
    if (result.debugTableCpp !== undefined) {
      await writeFile(
        join(sourceTargetFolderPath, 'generated_debug.cpp'),
        result.debugTableCpp,
        { encoding: 'utf8' },
      )
    }
    if (result.debugMap !== undefined) {
      await writeFile(
        join(sourceTargetFolderPath, 'debug-map.json'),
        JSON.stringify(result.debugMap, null, 2),
        { encoding: 'utf8' },
      )
      handleOutputData(
        `Debug map: ${result.debugMap.leaves.length} leaves in ${result.debugMap.arrays.length} arrays`,
        'info',
      )
    }

    handleOutputData(`C++ files generated at: ${sourceTargetFolderPath}`, 'info')
    handleOutputData(`Program MD5: ${md5Hash}`, 'info')

    return { md5Hash }
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

    const definitionsFilePath = join(buildTargetDirectoryPath, 'examples', 'Baremetal', 'defines.h')

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

    const halsFileContent = await CompilerModule.readJSONFile<HalsFile>(this.halsFilePath)

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

  async handleCompileArduinoProgram({
    boardHalsContent,
    compilationPath,
    handleOutputData,
    cleanBuild,
  }: CompileArduinoProgramArgs) {
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    // -j 0 — saturate every CPU core. arduino-cli's default is
    // sequential compilation; with the codegen split (one TU per POU
    // plus configuration.cpp + generated_debug.cpp) there are now
    // many independent .cpp files in the library folder, so
    // parallel compilation cuts wall-clock build time roughly
    // proportional to core count. Per-file build caching is enabled
    // by default — arduino-cli keys its cache on (sketch path,
    // flags, board) under ~/<user-cache>/arduino/sketches/<hash>/
    // and reuses .o files when their content hash matches. Together
    // with the build-folder wipe at createBasicDirectories(), this
    // gives the same edit-one-POU-rebuild-fast behaviour that the
    // v4 runtime gets via ccache + make -j.
    //
    // --clean — invalidate arduino-cli's per-file cache for the
    // selected sketch, forcing every TU to be recompiled from
    // scratch. Wired to the "Clean build and upload" UI option.
    let buildProjectFlags = ['compile', '-v', '-j', '0']
    if (cleanBuild) {
      buildProjectFlags.push('--clean')
      handleOutputData('Clean build requested — arduino-cli cache will be invalidated.', 'info')
    }

    if (boardHalsContent['c_flags']) {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.c.extra_flags=${boardHalsContent['c_flags'].map((f) => f).join(' ')}`,
      ]
    }

    if (boardHalsContent['cxx_flags']) {
      const cxxFlags = [...boardHalsContent['cxx_flags']]
      // AVR toolchains don't ship the C++ standard library (no
      // <type_traits>, <algorithm>, etc.). We bundle a freestanding-
      // libstdc++ port at resources/sources/avr-libstdcpp/include and
      // pass it via -I.
      //
      // The original path can sit anywhere — Electron's user-data dir
      // on macOS is `~/Library/Application Support/<App>/` and many
      // users have spaces in their home path. arduino-cli builds the
      // compile invocation by token-substituting compiler.cpp.extra_flags
      // into a recipe and processing the result; quoted paths with
      // embedded spaces have been known to confuse the substitution and
      // break AVR builds. Mirror the headers into a known no-space
      // cache path on first compile to sidestep that whole class of
      // breakage. Versioned cache key so the editor self-invalidates
      // on upgrades that ship new headers.
      if (boardHalsContent['core']?.startsWith('arduino:avr')) {
        const avrLibStdCppPath = await this.ensureAvrLibStdCppCache()
        cxxFlags.push(`-I${avrLibStdCppPath}`)
      }
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.cpp.extra_flags=${cxxFlags.join(' ')}`,
      ]
    }

    if (boardHalsContent['ld_flags']) {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `compiler.c.elf.extra_flags=${boardHalsContent['ld_flags'].map((f: string) => f).join(' ')}`,
      ]
    }

    // `upload.maximum_data_size` controls arduino-cli's post-link
    // size check, not the linker memory map (that's `ld_flags`).
    // For boards like the simulator that target a stock Arduino
    // platform but emulate more RAM than the canonical SoC, we
    // need to override both — otherwise the link succeeds but
    // arduino-cli rejects the binary with "data section exceeds
    // available space in board" because boards.txt still reports
    // 8192 bytes for atmega2560.
    if (typeof boardHalsContent['max_data_size'] === 'number') {
      buildProjectFlags = [
        ...buildProjectFlags,
        '--build-property',
        `upload.maximum_data_size=${boardHalsContent['max_data_size']}`,
      ]
    }

    buildProjectFlags = [
      ...buildProjectFlags,
      '--library',
      `${join(compilationPath, 'src')}`, // STruC++ generated code + runtime headers
      '--export-binaries', // Export binaries
      '-b',
      boardHalsContent['platform'], // Board target
      join(baremetalPath, 'Baremetal.ino'), // Arduino .ino file
      ...this.arduinoCliBaseParameters, // Base parameters
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

          const modules = matchingDevice.moduleSystem?.modules ?? []
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
       * Resolve a list of project-enabled library names to the disk
       * directories `strucpp.libraryPaths` should scan.  Bundled
       * libraries are always-on and live in a single shared dir;
       * each enabled user library gets its own folder.  Missing
       * names (enabled but not installed) come back so the caller
       * can abort with a clear error before strucpp runs.
       */
      resolveLibraryDirs: (enabledNames: string[]) => { dirs: string[]; missing: string[] }
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

    const normalizedProjectPath = projectPath.replace('project.json', '')

    const compilationPath = join(normalizedProjectPath, 'build', boardTarget) // Assuming the build folder is named 'build'

    const sourceTargetFolderPath = join(compilationPath, 'src') // Assuming the source folder is named 'src'

    let buildMD5Hash: string | null = null

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
      await this.copyStaticFiles(compilationPath, boardRuntime)
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
      const knownPous: KnownPou[] = projectData.pous.map((p) => ({
        name: p.data.name,
        kind:
          p.type === 'program'
            ? ('PROGRAM' as const)
            : p.type === 'function'
              ? ('FUNCTION' as const)
              : ('FUNCTION_BLOCK' as const),
        language: p.data.language as KnownPou['language'],
      }))
      // Resolve project-enabled libraries to disk directories.
      // Bundled libs are always-on; missing names (enabled but not
      // installed) abort the compile early in handleCompileSTtoCpp
      // with a clear "open the Library Manager" message.
      const enabledLibraryNames = (projectData.libraries ?? []).map((ref) => ref.name)
      const { dirs: libraryDirs, missing: missingLibraries } =
        mainProcessBridge.resolveLibraryDirs(enabledLibraryNames)
      const { md5Hash } = await this.handleCompileSTtoCpp(
        sourceTargetFolderPath,
        (data, logLevel, compileError) => {
          _mainProcessPort.postMessage({
            logLevel,
            message: data,
            ...(compileError ? { compileError } : {}),
          })
        },
        { hasCBlocks, pous: knownPous, libraryDirs, missingLibraries },
      )
      buildMD5Hash = md5Hash
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

    // Step 7: Generate C/C++ blocks header file
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

    // Step 8: Generate C/C++ blocks code file
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

      // Generate Runtime v4 conf/* files for BOTH compile-only and upload flows.
      // Without this, compile-only never produces ethercat.json (and other configs),
      // so users who only want the generated sources miss runtime configuration.
      if (isRuntimeV4) {
        try {
          // defines.h next to generated.cpp — picked up by the v4 runtime
          // shim (core/strucpp_runtime/runtime_v4_entry.cpp) via
          // __has_include so strucpp_program_md5 reflects the program
          // currently loaded. FC 0x45 (DEBUG_GET_MD5) returns this so the
          // editor can verify it's debugging the matching source. Macro
          // name matches the Arduino sketch's PROGRAM_MD5 convention.
          if (buildMD5Hash) {
            await writeFile(
              join(sourceTargetFolderPath, 'defines.h'),
              `#pragma once\n// Program MD5\n#define PROGRAM_MD5 "${buildMD5Hash}"\n`,
              { encoding: 'utf8' },
            )
          }
          await this.cleanConfFolder(sourceTargetFolderPath, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateModbusSlaveConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateModbusMasterConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateS7CommConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateOpcUaConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          await this.handleGenerateEthercatConfig(sourceTargetFolderPath, projectData, (data, logLevel) => {
            _mainProcessPort.postMessage({ logLevel, message: data })
          })
          // VPP plugin config + source copy for boards whose target is runtime-v4
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

        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)

        const header = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`,
        )
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
        const body = Buffer.concat([header, fileBuffer, footer] as unknown as ReadonlyArray<Uint8Array>)

        await new Promise<void>((resolve, reject) => {
          const req = https.request(
            {
              hostname: runtimeIpAddress,
              port: 8443,
              // ?clean=1 tells the runtime to wipe build/ and ccache
              // before compiling — wired to the "Clean build and
              // upload" UI option. Older runtimes that don't know
              // about the flag simply ignore it.
              path: cleanBuild ? '/api/upload-file?clean=1' : '/api/upload-file',
              method: 'POST',
              headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                Authorization: `Bearer ${runtimeJwtToken}`,
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
                  _mainProcessPort.postMessage({
                    logLevel: 'info',
                    message: 'Program uploaded successfully to runtime.',
                  })
                  try {
                    const response = JSON.parse(data) as { CompilationStatus?: string }
                    _mainProcessPort.postMessage({
                      logLevel: 'info',
                      message: `Runtime compilation started: ${response.CompilationStatus || 'COMPILING'}`,
                    })
                  } catch (_parseError) {
                    _mainProcessPort.postMessage({
                      logLevel: 'warning',
                      message: 'Could not parse runtime response',
                    })
                  }

                  const pollCompilationStatus = async (): Promise<'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'ERROR'> => {
                    let lastLogCount = 0
                    let finalResult: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'ERROR' | null = null
                    const startTime = Date.now()
                    const timeout = CompilerModule.COMPILATION_STATUS_TIMEOUT_MS
                    const pollInterval = CompilerModule.COMPILATION_STATUS_POLL_INTERVAL_MS

                    while (finalResult === null) {
                      if (Date.now() - startTime > timeout) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: 'Compilation status polling timed out after 20 minutes.',
                        })
                        finalResult = 'TIMEOUT'
                        continue
                      }

                      await new Promise((resolve) => setTimeout(resolve, pollInterval))

                      try {
                        const result = await mainProcessBridge.makeRuntimeApiRequest<{
                          status: string
                          logs: string[]
                          exit_code: number | null
                        }>(runtimeIpAddress, runtimeJwtToken, '/api/compilation-status', (data: string) => {
                          return JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
                        })

                        if (!result.success) {
                          _mainProcessPort.postMessage({
                            logLevel: 'error',
                            message: `Error polling compilation status: ${result.error}`,
                          })
                          finalResult = 'ERROR'
                          continue
                        }

                        const { status, logs, exit_code } = result.data!

                        if (logs.length > lastLogCount) {
                          const newLogs = logs.slice(lastLogCount)
                          newLogs.forEach((log) => {
                            const { level, cleanedMessage } = this.parseLogLevel(log)
                            _mainProcessPort.postMessage({
                              logLevel: level,
                              message: cleanedMessage,
                            })
                          })
                          lastLogCount = logs.length
                        }

                        if (status === 'SUCCESS') {
                          _mainProcessPort.postMessage({
                            logLevel: 'info',
                            message: `Compilation completed successfully (exit code: ${exit_code ?? 0}).`,
                          })
                          finalResult = 'SUCCESS'
                        } else if (status === 'FAILED') {
                          _mainProcessPort.postMessage({
                            logLevel: 'error',
                            message: `Compilation failed (exit code: ${exit_code ?? 1}).`,
                          })
                          finalResult = 'FAILED'
                        }
                      } catch (pollError) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: `Error polling compilation status: ${pollError instanceof Error ? pollError.message : String(pollError)}`,
                        })
                        finalResult = 'ERROR'
                      }
                    }
                    return finalResult
                  }

                  /**
                   * Send START to the runtime after a successful build, retrying on
                   * COMMAND:BUSY (the runtime returns BUSY while its STOP transition
                   * thread is still finishing the unload — plugin cleanup, pthread_join,
                   * etc.). Any non-BUSY error response (invalid program, compilation
                   * error, etc.) stops the retry immediately.
                   */
                  const startPlcAfterBuildWithRetry = async (): Promise<void> => {
                    const maxWaitMs = POST_BUILD_START_TIMEOUT_MS
                    const pollIntervalMs = POST_BUILD_START_POLL_INTERVAL_MS
                    const deadline = Date.now() + maxWaitMs

                    while (Date.now() < deadline) {
                      const result = await mainProcessBridge.makeRuntimeApiRequest<string>(
                        runtimeIpAddress,
                        runtimeJwtToken,
                        '/api/start-plc',
                        (data: string) => {
                          const parsed = JSON.parse(data) as { status?: string }
                          return (parsed.status ?? '').trim()
                        },
                      )

                      if (!result.success) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: `Failed to start PLC: ${result.error}`,
                        })
                        return
                      }

                      const rawStatus = result.data ?? ''
                      if (rawStatus.includes('START:OK') || rawStatus.includes('ALREADY_RUNNING')) {
                        _mainProcessPort.postMessage({
                          logLevel: 'info',
                          message: 'PLC started.',
                        })
                        return
                      }

                      // Only BUSY is retryable — everything else is a real error from the runtime.
                      if (!rawStatus.includes('BUSY')) {
                        _mainProcessPort.postMessage({
                          logLevel: 'error',
                          message: `Failed to start PLC: ${rawStatus || 'unknown response'}`,
                        })
                        return
                      }

                      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
                    }

                    _mainProcessPort.postMessage({
                      logLevel: 'warning',
                      message: `PLC did not start within ${maxWaitMs}ms — runtime remained busy. Press Play to retry.`,
                    })
                  }

                  pollCompilationStatus()
                    .then(async (compileStatus) => {
                      // Auto-start the PLC on successful build. The runtime no longer
                      // restarts on its own after an upload, so the editor owns the
                      // retry-on-BUSY policy and the error reporting.
                      if (compileStatus === 'SUCCESS' && !compileOnly) {
                        await startPlcAfterBuildWithRetry()
                      }

                      if (runtimeIpAddress && runtimeJwtToken) {
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
                              _mainProcessPort.postMessage({
                                plcStatus: status,
                              })
                            }
                          }
                        } catch (_statusError) {
                          // Silently ignore status check errors - this is a best-effort update
                        }
                      }

                      _mainProcessPort.postMessage({
                        message:
                          '-------------------------------------------------------------------------------------------------------------\n',
                      })
                      _mainProcessPort.close()
                    })
                    .catch((error) => {
                      _mainProcessPort.postMessage({
                        logLevel: 'error',
                        message: `Unexpected error in compilation polling: ${getErrorMessage(error)}`,
                      })
                      _mainProcessPort.postMessage({
                        message:
                          '-------------------------------------------------------------------------------------------------------------\n',
                      })
                      _mainProcessPort.close()
                    })

                  resolve()
                } else {
                  _mainProcessPort.postMessage({
                    logLevel: 'error',
                    message: `Upload failed: ${data || 'HTTP ' + res.statusCode}`,
                  })
                  reject(new Error(`Upload failed with status ${res.statusCode}`))
                }
              })
            },
          )
          req.setTimeout(300000, () => {
            req.destroy()
            _mainProcessPort.postMessage({
              logLevel: 'error',
              message: 'Upload request timed out after 5 minutes.',
            })
            reject(new Error('Upload timeout'))
          })
          req.on('error', (error: Error) => {
            _mainProcessPort.postMessage({
              logLevel: 'error',
              message: `Upload error: ${error.message}`,
            })
            reject(error)
          })
          req.write(body)
          req.end()
        })
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
      // For simulator targets, send the HEX firmware path back to the renderer.
      // Derive the build sub-directory from the platform FQBN (e.g. "arduino:avr:mega" → "arduino.avr.mega")
      // so it stays in sync with the hals.json entry.
      const fqbnSubDir = halsContent[boardTarget]['platform'].replaceAll(':', '.')
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
        await this.handleUploadProgram({
          projectPath: normalizedProjectPath,
          arduinoPlatform: halsContent[boardTarget]['platform'],
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
      resolveLibraryDirs: (enabledNames: string[]) => { dirs: string[]; missing: string[] }
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
      const knownPous: KnownPou[] = projectData.pous.map((p) => ({
        name: p.data.name,
        kind:
          p.type === 'program'
            ? ('PROGRAM' as const)
            : p.type === 'function'
              ? ('FUNCTION' as const)
              : ('FUNCTION_BLOCK' as const),
        language: p.data.language as KnownPou['language'],
      }))
      const enabledLibraryNames = (projectData.libraries ?? []).map((ref) => ref.name)
      const { dirs: libraryDirs, missing: missingLibraries } =
        mainProcessBridge.resolveLibraryDirs(enabledLibraryNames)
      await this.handleCompileSTtoCpp(
        sourceTargetFolderPath,
        (data, logLevel, compileError) => {
          _mainProcessPort.postMessage({
            logLevel,
            message: data,
            ...(compileError ? { compileError } : {}),
          })
        },
        { hasCBlocks, pous: knownPous, libraryDirs, missingLibraries },
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
    mainProcessBridge: {
      makeRuntimeApiRequest: <T = void>(
        ipAddress: string,
        jwtToken: string,
        endpoint: string,
        responseParser?: (data: string) => T,
      ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
      resolveLibraryDirs: (enabledNames: string[]) => { dirs: string[]; missing: string[] }
      loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
    },
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
    const finish = (result: import('@root/middleware/shared/ports/types').CompileLibraryResult) => {
      _mainProcessPort.postMessage({ libraryBuildResult: result })
      setTimeout(() => _mainProcessPort.close(), 25)
    }

    const [projectPath, projectData, cleanBuild = false] = args as [string, PLCProjectData, boolean | undefined]
    const normalizedProjectPath = projectPath.replace('project.json', '')

    post('Starting library build...')

    // Stage 0: read manifest from disk.
    const manifestPath = join(normalizedProjectPath, 'library.json')
    let manifestJson: string
    try {
      manifestJson = await readFile(manifestPath, { encoding: 'utf8' })
    } catch (error) {
      post(`Could not read library.json: ${getErrorMessage(error)}`, 'error')
      finish({ success: false, error: 'Could not read library.json' })
      return
    }

    // Stage 1: manifest validation + XML generation.
    const project: import('@root/backend/shared/types/PLC/open-plc').PLCProject = {
      meta: { name: '', type: 'plc-library' as const },
      data: projectData as unknown as import('@root/backend/shared/types/PLC/open-plc').PLCProjectData,
    }
    const stage1 = prepareXmlForLibraryBuild(project, manifestJson)
    if ('error' in stage1) {
      post(stage1.error, 'error')
      finish({ success: false, error: stage1.error })
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
      const msg = `Could not prepare build directory: ${getErrorMessage(error)}`
      post(msg, 'error')
      finish({ success: false, error: msg })
      return
    }

    const xmlPath = join(libraryBuildSrcDir, 'plc.xml')
    try {
      await writeFile(xmlPath, xml, 'utf-8')
    } catch (error) {
      const msg = `Could not write plc.xml: ${getErrorMessage(error)}`
      post(msg, 'error')
      finish({ success: false, error: msg })
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
      const msg = `xml2st failed: ${getErrorMessage(error)}`
      post(msg, 'error')
      finish({ success: false, error: msg })
      return
    }

    // Stage 3: read program.st + run library compile.
    const programStPath = join(libraryBuildSrcDir, 'program.st')
    let programSt: string
    try {
      programSt = await readFile(programStPath, { encoding: 'utf8' })
    } catch (error) {
      const msg = `Could not read program.st from xml2st output: ${getErrorMessage(error)}`
      post(msg, 'error')
      finish({ success: false, error: msg })
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
      const list = missingDeps.join(', ')
      const msg =
        `Library build aborted: enabled libraries are not installed (${list}). ` +
        `Open the Library Manager to install or remove them.`
      post(msg, 'error')
      finish({ success: false, error: msg, libraryName: manifest.name })
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
    const verifyCachePath = join(libraryBuildDir, '.verify-cache.json')
    let cachedVerification: import('@root/middleware/shared/ports/types').CompileLibraryResult['verification']
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

    let verification: import('@root/middleware/shared/ports/types').CompileLibraryResult['verification']
    if (cachedVerification) {
      verification = cachedVerification
      post(
        `Skipping verification (cached: ${cachedVerification.success ? 'pass' : 'fail'}). ` +
          'Use "Clean build" to force re-verification.',
      )
    } else {
      const verifyProject = composeVerificationProject({
        meta: { name: manifest.name, type: 'plc-library' },
        data: projectData as unknown as import('@root/backend/shared/types/PLC/open-plc').PLCProjectData,
      })
      post('Verifying with OpenPLC Simulator (avr-gcc)...')
      try {
        // The verification pipeline is chatty — strucpp + arduino-cli
        // together emit dozens of progress lines that bury the
        // user's actual library-build outcome.  Swallow them
        // internally; on failure the captured first error surfaces
        // in the summary warning below.  Build artefacts under
        // `build/OpenPLC Simulator/` remain on disk for any deeper
        // diagnostic the user wants to chase.
        verification = await this.runVerificationCompile(
          normalizedProjectPath,
          verifyProject.data,
          mainProcessBridge,
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
    const stage2 = libraryBuildFromTranspiledSt(programSt, knownPous, manifest, {
      pouDocs,
      dependencyArchives: depArchives,
      dependencyRefs: enabledLibraryRefs,
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
      const msg = `Could not write ${manifest.name}.stlib: ${getErrorMessage(error)}`
      post(msg, 'error')
      finish({ success: false, error: msg })
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
   * Verification is advisory: the `.stlib` is already on disk by the
   * time we get here, so the renderer doesn't need a play-by-play of
   * strucpp's and arduino-cli's chatter.  We absorb the stream
   * silently, keep the first error message (most actionable; later
   * errors are usually cascades), and return a summary.
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
    bridge: {
      makeRuntimeApiRequest: <T = void>(
        ipAddress: string,
        jwtToken: string,
        endpoint: string,
        responseParser?: (data: string) => T,
      ) => Promise<{ success: true; data?: T } | { success: false; error: string }>
      resolveLibraryDirs: (enabledNames: string[]) => { dirs: string[]; missing: string[] }
    },
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
        if (data.logLevel === 'error' && data.message !== undefined && firstError === null) {
          // Keep only the first error — by the time arduino-cli or
          // strucpp emits a second one it's usually a cascade of the
          // first.  Use `decodePortMessage` so a Node `Buffer`
          // payload (which arrives here as a `Uint8Array` after
          // structured clone) renders as readable text in the
          // summary, not the comma-separated number list `.toString()`
          // gives back.
          firstError = decodePortMessage(data.message)
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
