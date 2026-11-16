import { spawn } from 'node:child_process'
import crypto, { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { join, resolve as pathResolve, sep as pathSep } from 'node:path'

import { LibraryManagerModule } from '@root/backend/editor/library-manager/library-manager-module'
import { buildUploadSnapshot } from '@root/backend/editor/project/build-upload-snapshot'
import { resolveBuildWorkspace } from '@root/backend/editor/project/cloud-build-workspace'
import { RUNTIME_API_PORT } from '@root/backend/editor/runtime/runtime-api-client'
import { resolveTrustedKeysArtifact } from '@root/backend/shared/compile/steps/generate-trusted-keys'
import type { VppModbusScreenState } from '@root/backend/shared/compile/steps/modbus-defines'
import { shouldWipeBuildFolder } from '@root/backend/shared/compile/steps/plan-build-tree-sync'
import { resolveBoardSelection } from '@root/backend/shared/compile/steps/resolve-board-selection'
import type { DependencyHintSurface } from '@root/backend/shared/packages/arduino-dependencies'

import { execRecipeArgv } from './recipe-exec'
type StrucppCompileError = import('strucpp').CompileError

import { buildArduinoCliCompileArgs } from '@root/backend/shared/firmware/build-arduino-cli-args'
import { runLibraryBuildPipeline } from '@root/backend/shared/library/library-build-orchestrator'
import { type NativePouRef, parseNativePouRefs } from '@root/backend/shared/library/native-pou-list'
import { buildKnownPous, emitCompileErrorEvents } from '@root/backend/shared/library/program-build-helpers'
import { runProgramBuildPipeline } from '@root/backend/shared/library/program-build-pipeline'
import { loadStrucpp } from '@root/backend/shared/library/strucpp-runtime'
import {
  fromSchemaShape,
  type SchemaProjectData,
  transpileToSt as runJsonTranspiler,
} from '@root/backend/shared/transpilers/st-transpiler'
import type { KnownPou } from '@root/backend/shared/utils/PLC/split-program-st'

/** Bridge contract `compileLibrary` needs from the main process. */
type LibraryCompileBridge = {
  loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
}

/** Validated form of the `compiler:run-compile-library` payload. */
type ParsedCompileLibraryArgs = {
  projectPath: string
  projectData: PLCProjectData
  nativePous: NativePouRef[]
}

/** Structural guard over the library-build IPC payload. */
function parseCompileLibraryArgs(
  raw: unknown,
): { ok: true; value: ParsedCompileLibraryArgs } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length < 2) {
    return {
      ok: false,
      error: 'Library build failed: malformed request (expected [projectPath, projectData, nativePous]).',
    }
  }
  const [projectPath, projectData, rawNativePous] = raw as unknown[]
  if (typeof projectPath !== 'string' || projectPath === '') {
    return { ok: false, error: 'Library build failed: request carried no project path.' }
  }
  if (typeof projectData !== 'object' || projectData === null) {
    return { ok: false, error: 'Library build failed: request carried no project data.' }
  }
  const data = projectData as Record<string, unknown>
  if (!Array.isArray(data.pous)) {
    return { ok: false, error: 'Library build failed: project data has no POU list.' }
  }
  const configuration = data.configuration
  if (typeof configuration !== 'object' || configuration === null) {
    return { ok: false, error: 'Library build failed: project data has no configuration.' }
  }
  const resource = (configuration as Record<string, unknown>).resource
  if (typeof resource !== 'object' || resource === null) {
    return { ok: false, error: 'Library build failed: project configuration has no resource.' }
  }
  const { tasks, instances } = resource as Record<string, unknown>
  if (!Array.isArray(tasks) || !Array.isArray(instances)) {
    return { ok: false, error: 'Library build failed: project resource has no task or instance list.' }
  }
  return {
    ok: true,
    value: {
      projectPath,
      projectData: projectData as PLCProjectData,
      nativePous: parseNativePouRefs(rawNativePous),
    },
  }
}

/** Project data with the optional C++ POU sidecar attached. */
type ProjectDataWithCppPous = PLCProjectData & {
  originalCppPous?: CppPouDataCode[]
}

/** Post-build PLC start retry loop bounds. */
const POST_BUILD_START_TIMEOUT_MS = 5000
const POST_BUILD_START_POLL_INTERVAL_MS = 150

import { assertPathContained } from '@root/backend/editor/utils/path-containment'
import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
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
import { buildVppPluginFiles } from '@root/backend/shared/utils/vpp/build-vpp-plugin-files'
import { buildModuleConfigEntries } from '@root/backend/shared/utils/vpp/generate-vendor-plugin-config'
import type { VppPackagePin } from '@root/backend/shared/utils/vpp/vpp-package-pin'
import { APP_VERSION } from '@root/frontend/data/constants/app-version'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { app as electronApp } from 'electron'
import JSZip from 'jszip'

import type { VppScreenConfigInputs } from '../../../middleware/shared/ports/compiler-platform-port'
import type { PersistentStorageSettings, PlatformOption } from '../../../middleware/shared/ports/types'
import { BoardInfoResolver } from '../../shared/hardware/board-info-resolver'
import { findVppDeviceByBoardName } from '../../shared/hardware/find-vpp-device'
import { persistentStorageSchema } from '../../shared/types/PLC/devices/configuration'
import { formatPackageIntegrityError, PackageManagerModule } from '../package-manager'
import { readPackageFile } from '../package-manager/read-package-file'
import { createDesktopLibraryBuildPort } from './desktop-library-build-port'
import { createEditorCompilerPlatformPort } from './editor-compiler-platform-port'
import type { CompileProgressChannel, HalsFile } from './types'

interface MethodsResult<T> {
  success: boolean
  data?: T
}
type HandleOutputDataCallback = (chunk: Buffer | string, logLevel?: 'info' | 'warning' | 'error') => void

type CompileArduinoProgramArgs = {
  boardTarget: string
  boardHalsContent: HalsFile[string]
  compilationPath: string
  handleOutputData: HandleOutputDataCallback
  cleanBuild?: boolean
}

export function standardFlagsForCore(core: string | undefined): string[] {
  if (core === undefined) return []
  if (core.startsWith('arduino:megaavr')) return ['-std=gnu++14', '-fno-sized-deallocation']
  const belowCxx14 = ['arduino:avr', 'arduino:samd', 'FACTS:samd', 'industrialshields:esp32']
  return belowCxx14.some((id) => core.startsWith(id)) ? ['-std=gnu++14'] : []
}

/**
 * Where a `-std=` value sits relative to the others, so an older one can be
 * told from a newer. The letter spellings are gcc's pre-ratification names for
 * the same standards.
 */
function cxxStandardRank(flag: string): number | undefined {
  const named = /^-std=(?:gnu|c)\+\+(.+)$/.exec(flag)
  if (named === null) return undefined
  const ranks: Record<string, number> = {
    '98': 1998,
    '03': 2003,
    '0x': 2011,
    '11': 2011,
    '1y': 2014,
    '14': 2014,
    '1z': 2017,
    '17': 2017,
    '2a': 2020,
    '20': 2020,
    '2b': 2023,
    '23': 2023,
  }
  return ranks[named[1]]
}

/**
 * Append the core's standard flags to `cxxFlags`, keeping a `-std` the board already declares unless that one is
 * older than what the runtime needs.
 */
export function mergeStandardFlags(cxxFlags: string[], core: string | undefined): string[] {
  const merged = [...cxxFlags]
  for (const flag of standardFlagsForCore(core)) {
    const name = flag.split('=')[0]
    const at = merged.findIndex((existing) => existing.startsWith(name))
    if (at === -1) {
      merged.push(flag)
      continue
    }
    if (name !== '-std') continue
    const declared = cxxStandardRank(merged[at])
    const needed = cxxStandardRank(flag)
    if (declared !== undefined && needed !== undefined && declared < needed) merged[at] = flag
  }
  return merged
}

/** Marks a VPP builder failure that the degrade-and-continue catch rethrows. */
class VppPackagingFailure extends Error {}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  strucppRuntimeDir: string

  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  /** Whether the bundled binaries and sources sit beside the checkout instead of inside an installed app. */
  static readonly DEVELOPMENT_MODE = !electronApp.isPackaged

  // Runtime API polling configuration.
  static readonly COMPILATION_STATUS_TIMEOUT_MS = 20 * 60 * 1000
  static readonly COMPILATION_STATUS_POLL_INTERVAL_MS = 1000

  /** How a build that fails on a missing core tells the user to repair it. */
  readonly dependencyHintSurface: DependencyHintSurface

  constructor(options: { dependencyHintSurface?: DependencyHintSurface } = {}) {
    this.dependencyHintSurface = options.dependencyHintSurface ?? 'desktop'
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.strucppRuntimeDir = this.#constructStrucppRuntimeDir()
  }

  /** Build a `BoardInfoResolver` wired with the editor's filesystem-backed adapters. */
  async #createBoardInfoResolver(): Promise<BoardInfoResolver> {
    const halsContent = await readHalsFile<HalsFile>()
    const resolvePackageRelativePath = (pkgPath: string, relPath: string): string => {
      const root = pathResolve(pkgPath)
      const candidate = pathResolve(root, relPath)
      if (candidate !== root && !candidate.startsWith(root + pathSep)) {
        throw new Error(`Path "${relPath}" escapes package directory ${pkgPath}`)
      }
      return candidate
    }
    return new BoardInfoResolver({
      halsContent,
      packageManager: new PackageManagerModule(),
      resolveHalSourcePath: (rel) => join(this.sourceDirectoryPath, 'hal', rel),
      resolvePackageRelativePath,
      readPackageFile,
    })
  }

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

  #constructStrucppRuntimeDir(): string {
    if (electronApp.isPackaged) {
      return join(process.resourcesPath, 'strucpp', 'runtime', 'include')
    }
    return join(electronApp.getAppPath(), 'node_modules', 'strucpp', 'src', 'runtime', 'include')
  }

  /** Pull the user's platformOption selections out of a project's devices/configuration.json. */
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

  /** Starts arduino-cli with the editor's configuration file. */
  spawnArduinoCli(args: string[]) {
    return this.#executeArduinoCliCommand([...args, ...this.arduinoCliBaseParameters])
  }

  #executeArduinoCliCommand(args: string[]) {
    let arduinoCliBinaryPath = this.arduinoCliBinaryPath
    if (CompilerModule.HOST_PLATFORM === 'win32') {
      arduinoCliBinaryPath += '.exe'
    }
    return spawn(arduinoCliBinaryPath, args)
  }

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
      binaryPath += '.exe'
    }
    const { stdout, stderr } = await execRecipeArgv([binaryPath, 'version', flag, configFilePath, '--json'])
    if (stderr) {
      throw new Error(`Arduino CLI not available: ${stderr}`)
    }

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

  async createMD5Hash(content: string): Promise<string> {
    const crypto = await import('node:crypto')
    return crypto.createHash('md5').update(content).digest('hex')
  }

  async createBasicDirectories(
    projectFolderPath: string,
    boardTarget: string,
    wipe: boolean,
  ): Promise<MethodsResult<string | string[]>> {
    let result: MethodsResult<string | string[]> = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')

    if (wipe) {
      await fs.rm(boardDirectory, { recursive: true, force: true })
    }

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
      filesToCopy.push(
        cp(staticArduinoFilesPath, sourceTargetFolderPath, { recursive: true }),
        this.copyStrucppRuntimeHeaders(sourceTargetFolderPath),
        cp(staticBaremetalFilesPath, join(compilationPath, 'examples', 'Baremetal'), { recursive: true }),
      )
    } else if (!isRuntimeV4) {
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

  /** Copy STruC++ C++ runtime headers to the target directory. */
  private async copyStrucppRuntimeHeaders(targetDir: string): Promise<void> {
    const runtimeDir = this.strucppRuntimeDir
    try {
      await fs.access(runtimeDir)
    } catch {
      throw new Error(
        `STruC++ runtime headers not found at ${runtimeDir}. Run "npm run setup:binaries" to download them.`,
      )
    }
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
   * + `resources/sources/Baremetal/*`) into an in-memory file map
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
      // eslint-disable-next-line no-empty
    } catch {}

    try {
      const baremetalEntries = await readdir(baremetalDir, { withFileTypes: true })
      await Promise.all(
        baremetalEntries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const content = await readFile(join(baremetalDir, e.name), 'utf-8')
            files[`examples/Baremetal/${e.name}`] = content
          }),
      )
      // eslint-disable-next-line no-empty
    } catch {}

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
   * Mirror the bundled avr-libstdcpp headers into a stable no-space cache path so arduino-cli's
   * compiler.cpp.extra_flags substitution doesn't trip on a path containing spaces (common on macOS Electron
   * userData paths).
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

  async handleCompileSTtoCpp(
    sourceTargetFolderPath: string,
    handleOutputData: (chunk: Buffer | string, logLevel?: 'info' | 'error', compileError?: StrucppCompileError) => void,
    options: {
      hasCBlocks?: boolean
      pous?: KnownPou[]
      libraries: unknown[]
      missingLibraries?: string[]
    },
  ): Promise<{ md5Hash: string; strucppFiles: Record<string, string> }> {
    const stFilePath = join(sourceTargetFolderPath, 'program.st')
    const stSource = await readFile(stFilePath, { encoding: 'utf8' })

    handleOutputData('Compiling Structured Text to C++ with STruC++...', 'info')

    const md5 = crypto.createHash('md5').update(stSource).digest('hex')

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

    const strucppFiles: Record<string, string> = {}
    for (const f of result.files) strucppFiles[f.name] = f.content

    return { md5Hash: result.md5Hash, strucppFiles }
  }

  async handleGenerateArduinoCppFile(projectPath: string, boardTarget: string) {
    let result: MethodsResult<string> = { success: false }

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

    const userTypeNames = (projectData.dataTypes ?? []).map((dataType) => dataType.name)
    const headerContent: string = generateCBlocksHeader(cppPous, userTypeNames)
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
    _boardRuntime: string,
    handleOutputData: HandleOutputDataCallback,
  ) {
    const originalCppPous = projectData.originalCppPous || []

    if (originalCppPous.length === 0) {
      handleOutputData('No C/C++ blocks found, skipping c_blocks_code.cpp generation', 'info')
      return
    }

    const cppPous = originalCppPous
    const userTypeNames = (projectData.dataTypes ?? []).map((dataType) => dataType.name)
    const codeContent = generateCBlocksCode(cppPous, userTypeNames)
    const codeFilePath = join(compilationPath, 'src', 'c_blocks_code.cpp')

    try {
      await writeFile(codeFilePath, codeContent, { encoding: 'utf8' })
      handleOutputData(`C blocks code file populated at: ${codeFilePath}`, 'info')
    } catch (error) {
      throw new Error(`Error writing c_blocks_code.cpp file: ${(error as Error).message}`)
    }
  }

  /**
   * Probes the runtime at `<ip>:RUNTIME_API_PORT/api/version` (unauthenticated)
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
          port: RUNTIME_API_PORT,
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

    const resolver = await this.#createBoardInfoResolver()
    const info = resolver.resolve(boardTarget)
    if (!info.platform) {
      throw new Error(`Board "${boardTarget}" does not declare a platform (FQBN)`)
    }

    const projectPath = path.dirname(path.dirname(compilationPath))
    const selectedPlatformOptions = await this.#readSelectedPlatformOptions(projectPath)
    const effectiveFqbn = CompilerModule.applyPlatformOptions(
      info.platform,
      info.platformOptions,
      selectedPlatformOptions,
    )

    const avrLibStdCppInclude =
      info.core?.startsWith('arduino:avr') || info.core?.startsWith('arduino:megaavr')
        ? await this.ensureAvrLibStdCppCache()
        : undefined

    const cxxFlags: string[] = info.compilerFlags?.cxx_flags ? [...info.compilerFlags.cxx_flags] : []
    if (avrLibStdCppInclude) cxxFlags.push(`-I${avrLibStdCppInclude}`)

    const effectiveCxxFlags = mergeStandardFlags(cxxFlags, info.core)

    const compileEntry = {
      platform: info.platform,
      core: info.core,
      c_flags: info.compilerFlags?.c_flags,
      cxx_flags: info.compilerFlags?.cxx_flags,
      ld_flags: info.compilerFlags?.ld_flags,
      max_data_size: info.maxDataSize,
    }
    void boardHalsContent
    const cxxFlagsArg =
      effectiveCxxFlags.length > 0
        ? ['--build-property', `compiler.cpp.extra_flags=${effectiveCxxFlags.join(' ')}`]
        : []
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
      ...(info.precompiledLibraryDir ? ['--library', info.precompiledLibraryDir] : []),
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
    uploadMethod,
    ipAddress,
    handleOutputData,
  }: {
    projectPath: string
    arduinoPlatform: string
    compilationPath: string
    communicationPort?: string
    uploadMethod?: 'serial' | 'ethernet'
    ipAddress?: string
    handleOutputData: HandleOutputDataCallback
  }) {
    const isEthernet = uploadMethod === 'ethernet'
    let port = isEthernet ? ipAddress : communicationPort
    if (!port) {
      const devicesDirectoryPath = join(projectPath, 'devices')
      const devicesConfigurationFilePath = join(devicesDirectoryPath, 'configuration.json')
      try {
        const { communicationPort: persistedPort, runtimeIpAddress } =
          await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
        port = isEthernet ? runtimeIpAddress : persistedPort
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          handleOutputData?.(
            `Warning: could not read ${devicesConfigurationFilePath}: ` +
              `${error instanceof Error ? error.message : String(error)}. ` +
              'Continuing as if the file were absent.\n',
          )
        }
      }
    }
    const baremetalPath = join(compilationPath, 'examples', 'Baremetal')

    if (!port) {
      throw new Error(
        isEthernet
          ? 'No device IP specified — set the device IP address in Board Settings'
          : 'No communication port specified — select a serial port for this board',
      )
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
      const stdoutTail: string[] = []

      child.stdout.on('data', (data: Buffer) => {
        handleOutputData(data)
        stdoutTail.push(data.toString())
        if (stdoutTail.length > 40) stdoutTail.shift()
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
          const detail = stderrData.trim() || stdoutTail.join('').trim()
          reject(new Error(`Upload failed with code ${code}\n${detail}`))
        }
      })
    })
  }

  async compressSourceFolder(sourceFolderPath: string): Promise<Buffer> {
    const zip = new JSZip()

    async function addFilesToZip(currentPath: string, zipFolder: JSZip, relativePath: string = ''): Promise<void> {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
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
    screenConfigInputs: VppScreenConfigInputs,
    handleOutputData: HandleOutputDataCallback,
  ): Promise<void> {
    const integrity = new PackageManagerModule().verifyBoardPackageIntegrity(boardTarget)
    if (!integrity.ok) {
      const message = formatPackageIntegrityError(boardTarget, integrity)
      handleOutputData(message, 'error')
      throw new Error(message)
    }

    let trustedKeysC: string | null = null
    {
      const licensableMatch = new PackageManagerModule().findDeviceByBoardName(boardTarget)
      if (!licensableMatch) {
        let isBuiltinTarget = false
        try {
          const hals = await readHalsFile<HalsFile>()
          isBuiltinTarget = Boolean(hals[boardTarget])
        } catch {
          isBuiltinTarget = false
        }
        if (!isBuiltinTarget) {
          handleOutputData(
            `No installed VPP package matches board "${boardTarget}", so the licensing gate could not be ` +
              'evaluated. If this board belongs to a licensed VPP, its trusted-keys table was NOT generated ' +
              'and the plugin will fail to link on the device — reinstall the package.',
            'warning',
          )
        }
      }
      if (
        licensableMatch &&
        licensableMatch.device.target.type === 'runtime-v4' &&
        licensableMatch.device.capabilities?.isLicensable === true
      ) {
        let trustedKeysJson: string | null = null
        try {
          trustedKeysJson = await readFile(join(licensableMatch.pkg.path, 'trusted_keys.json'), 'utf-8')
        } catch {
          trustedKeysJson = null
        }
        const artifact = resolveTrustedKeysArtifact({
          isLicensable: true,
          packageLabel: licensableMatch.pkg.packageId,
          trustedKeysJson,
        })
        if (artifact.kind === 'packaging-fault') {
          handleOutputData(artifact.message, 'error')
          throw new Error(artifact.message)
        }
        if (artifact.kind === 'generated') {
          trustedKeysC = artifact.content
          handleOutputData(
            `Trusted-keys table generated for the plugin link set: ${artifact.keyCount} key(s), table size ${artifact.tableSize}`,
            'info',
          )
        }
      }
    }

    try {
      const match = new PackageManagerModule().findDeviceByBoardName(boardTarget)

      if (!match) {
        handleOutputData(`Board "${boardTarget}" is not from a VPP package, skipping VPP packaging`, 'info')
        return
      }

      const matchingPackagePath = match.pkg.path
      const matchingDevice = match.device

      if (matchingDevice.target.type !== 'runtime-v4') {
        handleOutputData(
          `VPP board "${boardTarget}" is not runtime-v4 (target=${matchingDevice.target.type}), skipping VPP packaging`,
          'info',
        )
        return
      }

      handleOutputData(`Detected VPP runtime-v4 board: ${boardTarget}`, 'info')

      let vendorScreenData: Record<string, unknown> = {}
      let recordedPin: VppPackagePin | undefined
      try {
        const deviceConfigRaw = await readFile(join(normalizedProjectPath, 'devices', 'configuration.json'), 'utf-8')
        const deviceConfig = JSON.parse(deviceConfigRaw) as {
          vendorScreenData?: Record<string, unknown>
          vppPackagePinsByBoard?: Record<string, VppPackagePin>
        }
        vendorScreenData = deviceConfig.vendorScreenData ?? {}
        recordedPin = deviceConfig.vppPackagePinsByBoard?.[boardTarget]
        // eslint-disable-next-line no-empty
      } catch {}

      let devicePins: DevicePin[] = []
      try {
        const parsedPins: unknown = JSON.parse(
          await readFile(join(normalizedProjectPath, 'devices', 'pin-mapping.json'), 'utf-8'),
        )
        if (Array.isArray(parsedPins)) {
          devicePins = parsedPins as DevicePin[]
        } else if (parsedPins && typeof parsedPins === 'object') {
          devicePins = (parsedPins as Record<string, DevicePin[]>)[boardTarget] ?? []
        }
        // eslint-disable-next-line no-empty
      } catch {}

      const rawModules = matchingDevice.moduleSystem?.modules ?? []
      const modules = await Promise.all(
        rawModules.map(async (m) => {
          const rel = (m as { configScreen?: string }).configScreen
          if (!rel) return m
          try {
            const screenPath = join(matchingPackagePath, rel)
            assertPathContained(matchingPackagePath, screenPath, 'module configScreen')
            return { ...m, configScreenDefinition: JSON.parse(await readFile(screenPath, 'utf-8')) as unknown }
          } catch (err) {
            handleOutputData(`Failed to load configScreen ${rel} for module ${m.id}: ${getErrorMessage(err)}`, 'error')
            return m
          }
        }),
      )

      const packageFiles = new Map<string, Uint8Array>()
      const readPackageFile = async (rel: string): Promise<void> => {
        const absolute = join(matchingPackagePath, rel)
        assertPathContained(matchingPackagePath, absolute, 'VPP package file')
        packageFiles.set(rel, Uint8Array.from(await readFile(absolute)))
      }

      const configTemplateRelPath = matchingDevice.hal?.configTemplate
      if (configTemplateRelPath) {
        try {
          await readPackageFile(configTemplateRelPath)
        } catch (err) {
          handleOutputData(
            `Failed to read VPP config template at ${configTemplateRelPath}: ${getErrorMessage(err)}`,
            'error',
          )
        }
      }

      const pluginEntryRelPath = matchingDevice.hal?.pluginEntry
      if (pluginEntryRelPath) {
        const isPrebuilt = matchingDevice.hal?.provisioning === 'prebuilt'
        const pluginDirRelPath = isPrebuilt ? pluginEntryRelPath.replace(/\/+$/, '') : path.dirname(pluginEntryRelPath)
        const pluginSourceDir = join(matchingPackagePath, pluginDirRelPath)
        try {
          assertPathContained(matchingPackagePath, pluginSourceDir, 'matchingDevice.hal.pluginEntry')
          const stat = await fs.stat(pluginSourceDir)
          if (!stat.isDirectory()) {
            handleOutputData(`VPP plugin source path is not a directory: ${pluginEntryRelPath}`, 'error')
            return
          }
        } catch (err) {
          handleOutputData(
            `VPP plugin source directory not found at ${pluginEntryRelPath}: ${getErrorMessage(err)}`,
            'error',
          )
          return
        }

        const collect = async (dir: string, rel: string): Promise<void> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const childRel = rel ? `${rel}/${entry.name}` : entry.name
            if (entry.isSymbolicLink()) {
              handleOutputData(`Skipping symlink in VPP plugin source: ${childRel}`, 'info')
              continue
            }
            if (entry.isDirectory()) {
              await collect(join(dir, entry.name), childRel)
            } else if (entry.isFile()) {
              await readPackageFile(`${pluginDirRelPath.split(path.sep).join('/')}/${childRel}`)
            }
          }
        }
        await collect(pluginSourceDir, '')
      }

      let packageSignature: unknown = null
      try {
        packageSignature = JSON.parse(await readFile(join(matchingPackagePath, 'signature.json'), 'utf-8'))
      } catch {
        packageSignature = null
      }

      const built = await buildVppPluginFiles({
        device: matchingDevice,
        packageFiles,
        packageSignature,
        vendorScreenData,
        devicePins: devicePins as unknown as Array<Record<string, unknown>>,
        modules,
        trustedKeysC,
        pin: {
          ...(recordedPin !== undefined && { recorded: recordedPin }),
          installed: readInstalledPin(match.pkg.packageId),
        },
        sha256Hex: (bytes) => createHash('sha256').update(bytes).digest('hex'),
        packageId: match.pkg.packageId,
        screenConfigInputs,
      })

      for (const warning of built.warnings) handleOutputData(warning, 'info')
      for (const message of built.errors) handleOutputData(message, 'error')
      if (built.errors.length > 0) {
        throw new VppPackagingFailure(built.errors[0])
      }

      if (Object.keys(built.files).some((name) => name.startsWith('vpp_plugin/'))) {
        await fs.rm(join(sourceTargetFolderPath, 'vpp_plugin'), { recursive: true, force: true })
      }

      for (const [relPath, bytes] of Object.entries(built.files)) {
        const destination = join(sourceTargetFolderPath, ...relPath.split('/'))
        assertPathContained(sourceTargetFolderPath, destination, 'VPP bundle path')
        await mkdir(path.dirname(destination), { recursive: true })
        await writeFile(destination, bytes)
      }

      if (built.pluginName) {
        handleOutputData(`Generated conf/${built.pluginName}.json for VPP plugin`, 'info')
        handleOutputData('Generated vpp_plugins.conf', 'info')
      }
      if (built.pluginFiles.length > 0) {
        const checksum = new TextDecoder().decode(built.files['vpp_plugin/checksum.sha256'] ?? new Uint8Array()).trim()
        handleOutputData(
          `Copied ${built.pluginFiles.length} VPP plugin ${built.provisioning} file(s) to vpp_plugin/ ` +
            `(checksum: ${checksum.slice(0, 12)}...)`,
          'info',
        )
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      handleOutputData(`Failed VPP plugin packaging: ${errorMessage}`, 'error')
      if (error instanceof VppPackagingFailure) throw error
    }
  }

  /** Compute per-slot module-configuration bytes for an Arduino VPP target with a modular backplane. */
  async buildVppArduinoModuleConfig(
    boardTarget: string,
    vendorScreenData: Record<string, unknown>,
  ): Promise<Array<{ slot: number; bytes: number[] }>> {
    try {
      const match = new PackageManagerModule().findDeviceByBoardName(boardTarget)

      const rawModules = match?.device.moduleSystem?.modules
      if (!match || !rawModules || rawModules.length === 0) return []

      const pkgPath = match.pkg.path
      const modules = await Promise.all(
        rawModules.map(async (m) => {
          let configScreenDefinition: unknown
          const rel = (m as { configScreen?: string }).configScreen
          if (rel) {
            try {
              const raw = await readFile(join(pkgPath, rel), 'utf-8')
              configScreenDefinition = JSON.parse(raw)
              // eslint-disable-next-line no-empty
            } catch {}
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

  /** Arduino-path trusted-keys injection. */
  applyTrustedKeysToSkeleton(input: {
    isRuntimeV3: boolean
    isLicensable: boolean
    packageLabel: string
    trustedKeysJson: string | null
    firmwareSkeleton: Record<string, string>
    postMessage: (msg: { logLevel: 'info' | 'warning' | 'error'; message: string }) => void
  }): boolean {
    const { isRuntimeV3, isLicensable, packageLabel, trustedKeysJson, firmwareSkeleton, postMessage } = input
    if (isRuntimeV3 || !isLicensable) return true

    const artifact = resolveTrustedKeysArtifact({ isLicensable: true, packageLabel, trustedKeysJson })
    if (artifact.kind === 'packaging-fault') {
      postMessage({ logLevel: 'error', message: `${artifact.message}\nStopping compilation process.` })
      return false
    }
    if (artifact.kind === 'generated') {
      firmwareSkeleton['examples/Baremetal/trusted_keys.c'] = artifact.content
      postMessage({
        logLevel: 'info',
        message: `Trusted-keys table generated: ${artifact.keyCount} key(s), table size ${artifact.tableSize}`,
      })
    }
    return true
  }

  /**
   * Main compile entry point.  Drives the full Step 0-13 flow
   * through the shared `runCompilePipeline` orchestrator
   * (`backend/shared/compile/pipeline.ts`); platform-specific bits
   * (arduino-cli spawn, runtime upload) are abstracted
   * behind `EditorCompilerPlatformPort`.  Single source of truth
   * for compile behaviour shared with openplc-web.
   */
  async compileProgram(
    args: Array<string | null | boolean | undefined | object>,
    _mainProcessPort: CompileProgressChannel,
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
        snapshotBuffer?: Buffer
        snapshotMetadata?: string
        onUploadAccepted?: (responseBody: string) => void
      }) => Promise<{ success: true; data: string } | { success: false; error: string }>
      getRuntimeUsername?: () => string | null
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

    const boardPackageIntegrity = new PackageManagerModule().verifyBoardPackageIntegrity(boardTarget)
    if (!boardPackageIntegrity.ok) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${formatPackageIntegrityError(boardTarget, boardPackageIntegrity)}\nStopping compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

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

    const normalizedProjectPath = resolveBuildWorkspace(projectPath.replace('project.json', ''))
    const compilationPath = join(normalizedProjectPath, 'build', boardTarget)
    const sourceTargetFolderPath = join(compilationPath, 'src')

    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Compiling program for project: ${projectPath} and board target: ${boardTarget}`,
    })
    _mainProcessPort.postMessage({ logLevel: 'warning', message: 'Host Hardware Info:' })
    _mainProcessPort.postMessage({ message: this.getHostHardwareInfo() })

    const hasServers = projectData.servers && projectData.servers.length > 0
    const targetIgnoresServers = boardRuntime === 'openplc-compiler' || boardRuntime === 'simulator'
    if (!isRuntimeV4 && targetIgnoresServers && hasServers) {
      _mainProcessPort.postMessage({
        logLevel: 'warning',
        message: `Warning: Your project contains Modbus Server configurations, but the selected target (${boardTarget}) does not support this feature. The server configurations will be ignored during compilation.`,
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

    try {
      await this.createBasicDirectories(
        normalizedProjectPath,
        boardTarget,
        shouldWipeBuildFolder({ cleanBuild: cleanBuild ?? false, isRuntimeV3, isRuntimeV4 }),
      )
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

    let firmwareSkeleton: Record<string, string>
    let staticFirmwareFiles: Record<string, string> = {}
    let strucppRuntimeHeaders: Record<string, string>
    let devicePinMapping: DevicePin[]
    let libraryArchives: unknown[]
    let missingLibraries: string[]
    let avrLibStdCppInclude = ''
    try {
      firmwareSkeleton = await this.loadFirmwareSkeletonInMemory(boardRuntime)
      strucppRuntimeHeaders = isRuntimeV4 ? await this.loadStrucppRuntimeHeaders() : {}
      if (!isRuntimeV4) {
        const v4Layout = await this.loadStrucppRuntimeHeaders()
        staticFirmwareFiles = mergeStrucppRuntimeIntoSkeleton({ firmwareSkeleton, strucppRuntimeHeaders: v4Layout })
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
        if (!boardHalContent && !isRuntimeV3) {
          const where = boardInfo.halSourceFile
            ? `its HAL source could not be read from ${boardInfo.halSourceFile}`
            : 'it did not resolve a HAL source file (a VPP package may have failed to load — try reinstalling it)'
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message:
              `Board "${boardTarget}" cannot be compiled: ${where}. ` +
              'Without a HAL the firmware has no hardware I/O layer.\nStopping compilation process.',
          })
          _mainProcessPort.close()
          return
        }
        firmwareSkeleton = mergeStrucppRuntimeIntoSkeleton({
          firmwareSkeleton,
          strucppRuntimeHeaders: v4Layout,
          boardHalContent,
        })

        for (const licenseStoreFile of boardInfo.licenseStoreFiles ?? []) {
          try {
            const content = await readFile(licenseStoreFile, 'utf-8')
            firmwareSkeleton[`examples/Baremetal/${path.basename(licenseStoreFile)}`] = content
            _mainProcessPort.postMessage({
              logLevel: 'info',
              message: `License store backend included: ${path.basename(licenseStoreFile)}`,
            })
          } catch (lsErr) {
            _mainProcessPort.postMessage({
              logLevel: 'warning',
              message:
                `Could not read license-store backend at ${licenseStoreFile}: ${getErrorMessage(lsErr)}. ` +
                'This board will report that it cannot store a license.',
            })
          }
        }
        if (boardInfo.capabilities?.isLicensable === true && (boardInfo.licenseStoreFiles ?? []).length === 0) {
          _mainProcessPort.postMessage({
            logLevel: 'warning',
            message:
              `Board "${boardTarget}" belongs to a licensed VPP but its manifest declares no ` +
              '`hal.licenseStore`. Every licensed VPP needs one, so this is a packaging fault: the ' +
              'firmware will link the weak default and report that its license storage is missing.',
          })
        }

        {
          let trustedKeysJson: string | null = null
          if (!isRuntimeV3 && boardInfo.capabilities?.isLicensable === true && boardInfo.vppPackagePath) {
            try {
              trustedKeysJson = await readFile(join(boardInfo.vppPackagePath, 'trusted_keys.json'), 'utf-8')
            } catch {
              trustedKeysJson = null
            }
          }
          const proceed = this.applyTrustedKeysToSkeleton({
            isRuntimeV3,
            isLicensable: boardInfo.capabilities?.isLicensable === true,
            packageLabel: boardInfo.vppPackageId ?? boardTarget,
            trustedKeysJson,
            firmwareSkeleton,
            postMessage: (msg) => _mainProcessPort.postMessage(msg),
          })
          if (!proceed) {
            _mainProcessPort.close()
            return
          }
        }
      }
      try {
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

    const platformPort = createEditorCompilerPlatformPort(
      {
        handleCompileArduinoProgram: this.handleCompileArduinoProgram.bind(this),
        handleUploadProgram: this.handleUploadProgram.bind(this),
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
        staticFirmwareFiles,
        mainProcessBridge,
        compressSourceFolder: (folderPath: string) => this.compressSourceFolder(folderPath),
        buildUploadSnapshot: async () => {
          const libraryManager = new LibraryManagerModule()
          return buildUploadSnapshot({
            projectPath: normalizedProjectPath,
            editorVersion: APP_VERSION,
            uploadedBy: mainProcessBridge.getRuntimeUsername?.() ?? '',
            readLibraryArchive: (name) => libraryManager.readArchiveText(name),
          })
        },
        getVppRuntimeFloor: (board: string) => new PackageManagerModule().getRuntimeFloorForBoard(board),
        pollTimeoutMs: CompilerModule.COMPILATION_STATUS_TIMEOUT_MS,
        pollIntervalMs: CompilerModule.COMPILATION_STATUS_POLL_INTERVAL_MS,
        startTimeoutMs: POST_BUILD_START_TIMEOUT_MS,
        startIntervalMs: POST_BUILD_START_POLL_INTERVAL_MS,
      },
    )

    const deviceContext =
      runtimeIpAddress && runtimeJwtToken
        ? { kind: 'editor-https' as const, ip: runtimeIpAddress, jwt: runtimeJwtToken }
        : undefined

    let vppModbusState: VppModbusScreenState | undefined
    const uploadsOverEthernet = boardEntry?.uploadMethod === 'ethernet'
    if (boardRuntime !== 'simulator' && boardRuntime !== 'openplc-compiler') {
      const devicesConfigurationFilePath = join(normalizedProjectPath, 'devices', 'configuration.json')
      let configuredIp: string | undefined
      try {
        const deviceConfig = await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
        const vendorScreenData = deviceConfig.vendorScreenData ?? {}
        configuredIp = deviceConfig.runtimeIpAddress
        vppModbusState = {
          serial: vendorScreenData['serial'] as VppModbusScreenState['serial'],
          network: vendorScreenData['network'] as VppModbusScreenState['network'],
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          _mainProcessPort.postMessage({
            logLevel: 'warning',
            message:
              `Could not read ${devicesConfigurationFilePath}: ` +
              `${error instanceof Error ? error.message : String(error)}. ` +
              'Continuing as if the file were absent — any device settings it held are being ignored.',
          })
        }
      }

      if (uploadsOverEthernet) {
        if (vppModbusState?.network?.enabled === false) {
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message:
              `The Network section is turned off for "${boardTarget}", but Ethernet is this board's ` +
              'only access path: it carries the debugger and it is how an upload reaches the device ' +
              'at all. Turn the Network section back on, or pick a target that has another way in. ' +
              'This build will not quietly re-enable it for you.',
          })
          _mainProcessPort.close()
          return
        }
      }
      if (uploadsOverEthernet) {
        const ip = runtimeIpAddress || vppModbusState?.network?.ip_address || configuredIp
        if (!ip) {
          _mainProcessPort.postMessage({
            logLevel: 'error',
            message:
              `No IP address for "${boardTarget}". Set one on the device's Network screen — an ` +
              'ethernet-upload board reaches the editor over the network and has no other way in, ' +
              'so this build refuses to invent an address for it.',
          })
          _mainProcessPort.close()
          return
        }
        const gwFromIp = (a: string) => a.replace(/\.\d+$/, '.1')
        const subnet = vppModbusState?.network?.subnet || '255.255.255.0'
        const gateway = vppModbusState?.network?.gateway || gwFromIp(ip)
        const dns = vppModbusState?.network?.dns || gateway
        const iface = vppModbusState?.network?.interface || 'Ethernet'
        const enableDhcp = vppModbusState?.network?.enable_dhcp ?? false
        vppModbusState = {
          ...(vppModbusState ?? {}),
          network: {
            ...(vppModbusState?.network ?? {}),
            enabled: true,
            interface: iface,
            enable_dhcp: enableDhcp,
            ip_address: ip,
            subnet,
            gateway,
            dns,
          },
        }
      }
    }

    let persistentStorage: PersistentStorageSettings | undefined
    let targetHidesPersistentStorage = false
    if (isRuntimeV4) {
      const devicesConfigurationFilePath = join(normalizedProjectPath, 'devices', 'configuration.json')
      let storageStanzaInvalid = false
      try {
        const deviceConfig = await CompilerModule.readJSONFile<DeviceConfiguration>(devicesConfigurationFilePath)
        const parsedStorage = persistentStorageSchema.safeParse(deviceConfig.persistentStorage)
        if (parsedStorage.success) {
          persistentStorage = parsedStorage.data
        } else if (deviceConfig.persistentStorage !== undefined) {
          storageStanzaInvalid = true
        }
        // eslint-disable-next-line no-empty
      } catch {}

      if (storageStanzaInvalid) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message:
            'Persistent storage settings in devices/configuration.json could not be read.\n' +
            'Refusing to build: uploading without them would switch persistent storage OFF on ' +
            'the device, and retained variables would stop being kept.\n' +
            'Open the Persistent Storage screen and re-save the setting, then build again.\n' +
            'Stopping compilation process.',
        })
        _mainProcessPort.close()
        return
      }
      const vppDevice = findVppDeviceByBoardName(new PackageManagerModule(), boardTarget)
      targetHidesPersistentStorage = (vppDevice?.device.hidesNativeScreens ?? []).includes('persistent-storage')
    }

    let effectiveVendorScreenData = vendorScreenData
    if (!isRuntimeV4 && !isSimulator) {
      const moduleConfigEntries = await this.buildVppArduinoModuleConfig(boardTarget, vendorScreenData ?? {})
      if (moduleConfigEntries.length > 0) {
        effectiveVendorScreenData = { ...(vendorScreenData ?? {}), 'module-config': { entries: moduleConfigEntries } }
      }
    }

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
        arduinoCliParallel: true,
        deviceContext,
        communicationPort: communicationPort ?? undefined,
        runtimeIpAddress: runtimeIpAddress ?? undefined,
        ...(vppModbusState ? { vppModbusState } : {}),
        ...(persistentStorage ? { persistentStorage } : {}),
        targetHidesPersistentStorage,
        vendorScreenData: effectiveVendorScreenData,
        editorVersion: APP_VERSION,
        dependencyHintSurface: this.dependencyHintSurface,
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

    if (isSimulator) {
      if (compileOnly) {
        if (result.success) {
          _mainProcessPort.postMessage({ logLevel: 'info', message: 'Compilation successful.' })
        }
        _mainProcessPort.postMessage({ closePort: true, success: result.success })
        _mainProcessPort.close()
        return
      }
      if (result.success) {
        const platform = typeof boardEntry?.platform === 'string' ? boardEntry.platform : ''
        const fqbnSubDir = platform.replaceAll(':', '.')
        const hexPath = join(compilationPath, 'examples', 'Baremetal', 'build', fqbnSubDir, 'Baremetal.ino.hex')
        _mainProcessPort.postMessage({
          logLevel: 'info',
          message: 'Compilation successful. Loading firmware into simulator...',
        })
        _mainProcessPort.postMessage({ simulatorFirmwarePath: hexPath, closePort: true, success: true })
        _mainProcessPort.close()
        return
      }
      _mainProcessPort.postMessage({
        message:
          '-------------------------------------------------------------------------------------------------------------\n',
      })
      _mainProcessPort.postMessage({ closePort: true, success: false })
      _mainProcessPort.close()
      return
    }

    _mainProcessPort.postMessage({
      message:
        '-------------------------------------------------------------------------------------------------------------\n',
    })
    _mainProcessPort.postMessage({ closePort: true, success: result.success })
    setTimeout(() => {
      _mainProcessPort.close()
    }, 25)
  }

  async compileForDebugger(
    args: Array<string | null | PLCProjectData>,
    _mainProcessPort: CompileProgressChannel,
    mainProcessBridge: {
      loadEnabledArchives: (enabledNames: string[]) => { archives: unknown[]; missing: string[] }
    },
  ): Promise<void> {
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting debug compilation process...' })

    const [projectPath, boardTarget, projectData] = args as [string, string, PLCProjectData]

    const debugPackageIntegrity = new PackageManagerModule().verifyBoardPackageIntegrity(boardTarget)
    if (!debugPackageIntegrity.ok) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${formatPackageIntegrityError(boardTarget, debugPackageIntegrity)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

    const debugResolver = await this.#createBoardInfoResolver()
    const { boardRuntime, isRuntimeV3, isRuntimeV4 } = debugResolver.resolve(boardTarget)
    const wipeBuildFolder = shouldWipeBuildFolder({ cleanBuild: false, isRuntimeV3, isRuntimeV4 })
    const normalizedProjectPath = resolveBuildWorkspace(projectPath.replace('project.json', ''))
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
      await this.createBasicDirectories(normalizedProjectPath, boardTarget, wipeBuildFolder)
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

    type DebugStResult = { ok: true; programSt: string } | { ok: false; programSt?: undefined; error: string }

    const runDebugInProcess = (): DebugStResult => {
      try {
        const ir = fromSchemaShape(projectData as unknown as SchemaProjectData)
        const result = runJsonTranspiler(ir)
        if (result.programSt === null || result.errors.length > 0) {
          return { ok: false, error: result.errors.join('\n') || 'Failed to generate Structured Text' }
        }
        return { ok: true, programSt: result.programSt }
      } catch (error) {
        return { ok: false, error: `st-transpiler failed: ${getErrorMessage(error)}` }
      }
    }

    const programStPath = join(sourceTargetFolderPath, 'program.st')
    try {
      await mkdir(sourceTargetFolderPath, { recursive: true })
      const stResult = runDebugInProcess()
      if (!stResult.ok) {
        _mainProcessPort.postMessage({
          logLevel: 'error',
          message: `${stResult.error}\nStopping debug compilation process.`,
        })
        _mainProcessPort.close()
        return
      }
      await writeFile(programStPath, stResult.programSt, 'utf-8')
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error writing ST file: ${getErrorMessage(error)}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }
    _mainProcessPort.postMessage({ logLevel: 'info', message: `ST file generated at: ${programStPath}` })

    try {
      if (wipeBuildFolder) {
        await this.copyStaticFiles(compilationPath, boardRuntime)
        _mainProcessPort.postMessage({ logLevel: 'info', message: 'Static files copied successfully.' })
      }
    } catch (error) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Error copying static files: ${error as string}\nStopping debug compilation process.`,
      })
      _mainProcessPort.close()
      return
    }

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

  /** Build a `.stlib` archive from a Library Project on disk. */
  async compileLibrary(
    args: unknown,
    _mainProcessPort: CompileProgressChannel,
    mainProcessBridge: LibraryCompileBridge,
  ): Promise<void> {
    _mainProcessPort.start()

    const parsed = parseCompileLibraryArgs(args)
    if (!parsed.ok) {
      _mainProcessPort.postMessage({ logLevel: 'error', message: parsed.error })
      _mainProcessPort.postMessage({ libraryBuildResult: { success: false, error: parsed.error } })
      setTimeout(() => _mainProcessPort.close(), 25)
      return
    }
    const { projectPath, projectData, nativePous } = parsed.value

    const libraryPort = createDesktopLibraryBuildPort({
      loadEnabledArchives: (names) => mainProcessBridge.loadEnabledArchives(names),
    })

    const result = await runLibraryBuildPipeline(
      {
        projectPath,
        projectData,
        nativePous,
      },
      libraryPort,
      (event) => _mainProcessPort.postMessage({ logLevel: event.level, message: event.message }),
    )

    _mainProcessPort.postMessage({ libraryBuildResult: result })
    setTimeout(() => _mainProcessPort.close(), 25)
  }
}
export { CompilerModule }

/** The installed package's pinnable identity, or null when it has none. */
function readInstalledPin(packageId: string): VppPackagePin | null {
  try {
    return new PackageManagerModule().getPackagePin?.(packageId) ?? null
  } catch {
    return null
  }
}
