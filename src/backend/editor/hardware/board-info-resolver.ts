/**
 * Board build info resolver.
 *
 * Returns per-board compile/upload information from a uniform shape,
 * regardless of source (legacy `hals.json` or installed VPP manifest).
 * Phase 0 of the VPP compile-pipeline migration (see
 * `local-dev-toolkit/backlog/vpp-compile-pipeline-migration.md`):
 * additive only — no existing call site is rewired here. Subsequent
 * phases swap each `hals.json` read in the compiler module for
 * `getBoardBuildInfo()`.
 *
 * Precedence: `hals.json` wins when a board exists in both catalogs.
 * This preserves current behavior; once the builtin entries leave
 * `hals.json` (Phase 7) the conflict surface disappears.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import type { PlatformOption } from '../../../middleware/shared/ports/types'
import type { InstalledPackage, PackageManifest } from '../package-manager/types'
import type { BoardInfo, HalsFile } from './types'

/** Minimal interface from PackageManagerModule that the resolver needs. */
export interface PackageManagerLike {
  listInstalled(): InstalledPackage[]
  getInstalledPackageManifest(packageId: string): PackageManifest | null
}

/**
 * Compile/upload-time information about a board, sourced uniformly.
 * The compiler reads from this shape only; never directly from
 * `hals.json` or the VPP manifest after Phase 6.
 */
export interface BoardBuildInfo {
  /** Which catalog provided the entry. */
  source: 'hals' | 'vpp'
  /** Toolchain selector: `arduino-cli` | `openplc-compiler` | `simulator`. */
  compiler: string

  // arduino-cli targets ----------------------------------------------------
  core?: string
  platform?: string
  boardManagerUrl?: string
  /** Absolute path to the HAL `.cpp` copied into the Baremetal sketch. */
  halSourceFile?: string
  compilerFlags?: {
    c_flags?: string[]
    cxx_flags?: string[]
    ld_flags?: string[]
  }
  define?: string | string[]
  extraArduinoLibraries?: string[]
  /** Absolute path to a package-supplied `libraries/` folder, if any. */
  localLibrariesDir?: string
  /** Override for arduino-cli's post-link `upload.maximum_data_size` check. */
  maxDataSize?: number
  /**
   * User-selectable FQBN sub-options surfaced from the VPP manifest. The
   * editor renders a dropdown per entry and appends `:<key>=<chosen_id>`
   * to `platform` at compile/upload time. Absent for boards that don't
   * expose variants (Mega, Uno R4, ESP32 boards today). hals.json
   * builtins (Simulator, Runtime v3/v4) never carry this field.
   */
  platformOptions?: PlatformOption[]

  // runtime-v4 targets -----------------------------------------------------
  pluginType?: 'python' | 'native'
  pluginEntry?: string
  configTemplate?: string
  requirements?: string

  // VPP metadata -----------------------------------------------------------
  vppPackageId?: string
  vppDeviceId?: string
  vppPackagePath?: string
}

type JsonReader = <T>(filePath: string) => Promise<T>

const defaultReader: JsonReader = async <T>(filePath: string) => {
  const data = await readFile(filePath, 'utf-8')
  return JSON.parse(data) as T
}

export class BoardInfoResolver {
  constructor(
    private readonly halsFilePath: string,
    private readonly sourcesDirectoryPath: string,
    private readonly packageManager: PackageManagerLike,
    private readonly readJSONFile: JsonReader = defaultReader,
  ) {}

  async resolve(boardName: string): Promise<BoardBuildInfo> {
    const fromHals = await this.#tryHalsLookup(boardName)
    if (fromHals) return fromHals

    const fromVpp = this.#tryVppLookup(boardName)
    if (fromVpp) return fromVpp

    throw new Error(`Board "${boardName}" not found in hals.json or any installed VPP package`)
  }

  async #tryHalsLookup(boardName: string): Promise<BoardBuildInfo | null> {
    let hals: HalsFile
    try {
      hals = await this.readJSONFile<HalsFile>(this.halsFilePath)
    } catch {
      return null
    }
    const entry = hals[boardName] as BoardInfo | undefined
    if (!entry) return null
    return this.#fromHalsEntry(entry)
  }

  #fromHalsEntry(entry: BoardInfo): BoardBuildInfo {
    const info: BoardBuildInfo = { source: 'hals', compiler: entry.compiler }
    if (entry.core) info.core = entry.core
    if (entry.platform) info.platform = entry.platform
    if (entry.board_manager_url) info.boardManagerUrl = entry.board_manager_url
    if (entry.source) info.halSourceFile = join(this.sourcesDirectoryPath, 'hal', entry.source)
    const flags = this.#collectFlags(entry.c_flags, entry.cxx_flags, entry.ld_flags)
    if (flags) info.compilerFlags = flags
    if (entry.define) info.define = entry.define
    if (entry.extra_libraries) info.extraArduinoLibraries = entry.extra_libraries
    if (entry.max_data_size !== undefined) info.maxDataSize = entry.max_data_size
    return info
  }

  #tryVppLookup(boardName: string): BoardBuildInfo | null {
    for (const pkg of this.packageManager.listInstalled()) {
      const manifest = this.packageManager.getInstalledPackageManifest(pkg.packageId)
      if (!manifest) continue
      const device = manifest.devices.find((d) => d.name === boardName)
      if (!device) continue
      return this.#fromVppDevice(device, pkg, manifest)
    }
    return null
  }

  #fromVppDevice(
    device: PackageManifest['devices'][number],
    pkg: InstalledPackage,
    manifest: PackageManifest,
  ): BoardBuildInfo {
    const info: BoardBuildInfo = {
      source: 'vpp',
      compiler: this.#mapTargetTypeToCompiler(device.target.type),
      vppPackageId: manifest.package.id,
      vppDeviceId: device.id,
      vppPackagePath: pkg.path,
    }
    if (device.target.core) info.core = device.target.core
    if (device.target.platform) info.platform = device.target.platform
    if (device.target.boardManagerUrl) info.boardManagerUrl = device.target.boardManagerUrl
    if (device.target.platformOptions && device.target.platformOptions.length > 0) {
      info.platformOptions = device.target.platformOptions
    }

    if (device.hal.source) info.halSourceFile = this.#resolveWithinPackage(pkg.path, device.hal.source)
    if (device.hal.pluginEntry) info.pluginEntry = this.#resolveWithinPackage(pkg.path, device.hal.pluginEntry)
    if (device.hal.configTemplate) info.configTemplate = this.#resolveWithinPackage(pkg.path, device.hal.configTemplate)
    if (device.hal.requirements) info.requirements = this.#resolveWithinPackage(pkg.path, device.hal.requirements)
    if (device.hal.libraries) info.localLibrariesDir = this.#resolveWithinPackage(pkg.path, device.hal.libraries)

    const flags = this.#collectFlags(
      device.hal.compilerFlags?.c_flags,
      device.hal.compilerFlags?.cxx_flags,
      device.hal.compilerFlags?.ld_flags,
    )
    if (flags) info.compilerFlags = flags
    if (device.hal.define) info.define = device.hal.define
    if (device.hal.extraArduinoLibraries) info.extraArduinoLibraries = device.hal.extraArduinoLibraries

    if (device.hal.pluginType === 'python' || device.hal.pluginType === 'native') {
      info.pluginType = device.hal.pluginType
    }
    return info
  }

  #mapTargetTypeToCompiler(targetType: string): string {
    if (targetType === 'arduino-cli') return 'arduino-cli'
    if (targetType === 'runtime-v4') return 'openplc-compiler'
    return targetType
  }

  #collectFlags(c?: string[], cxx?: string[], ld?: string[]): BoardBuildInfo['compilerFlags'] | undefined {
    if (!c && !cxx && !ld) return undefined
    const out: NonNullable<BoardBuildInfo['compilerFlags']> = {}
    if (c) out.c_flags = c
    if (cxx) out.cxx_flags = cxx
    if (ld) out.ld_flags = ld
    return out
  }

  /**
   * Resolve a manifest-relative path to absolute, with a guard against
   * traversal attempts (e.g. `../../etc/passwd`).
   */
  #resolveWithinPackage(packagePath: string, relPath: string): string {
    const root = resolve(packagePath)
    const candidate = resolve(root, relPath)
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new Error(`Path "${relPath}" escapes package directory ${packagePath}`)
    }
    return candidate
  }
}
