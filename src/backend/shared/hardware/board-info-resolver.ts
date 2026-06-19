/**
 * Board build info resolver — single canonical source of truth for
 * board-info lookup across the OpenPLC compile pipeline.
 *
 * One uniform shape (`BoardBuildInfo`) regardless of catalog source:
 * `hals.json` (the built-in Simulator / Runtime v3 / Runtime v4
 * entries) or an installed VPP manifest (Arduino-family devices plus
 * future runtime-v4 plugins shipped as `.vpp` packages).
 *
 * Forward-compatible with the eventual web-side VPP catalog:
 * platform-specific I/O is injected through `BoardInfoResolverConfig`
 * (the package-manager source, hals-source path resolution, and
 * package-relative path resolution).  The editor passes its
 * filesystem-backed `PackageManagerModule`; web ships a no-op
 * `packageManager` stub today and a real impl when VPP-on-web lands.
 *
 * Pure: no fs I/O, no electron, no globals.  Caller is responsible
 * for loading `hals.json` ahead of time and passing the content in.
 *
 * Precedence: `hals.json` wins when a board exists in both catalogs.
 * Preserves the editor's pre-migration behavior; once builtin
 * entries leave `hals.json` (later VPP-migration phase) the
 * conflict surface disappears.
 */

import type { DebugSpec } from '../../../middleware/shared/ports/debug-spec-types'
import type { InstalledPackage, PackageManifest, PlatformOption } from '../../../middleware/shared/ports/types'
import type { TargetCapabilities } from '../../../middleware/shared/utils/target-capabilities/types'

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * Slice of a `hals.json` entry the resolver reads.  Defined inline
 * (rather than reusing editor's zod-derived `BoardInfo`) so the
 * shared zone stays free of editor-only types and the web build
 * doesn't drag a zod schema into its bundle.
 */
export interface HalsBoardEntry {
  /** Toolchain selector: `'arduino-cli' | 'openplc-compiler' | 'simulator'`. */
  compiler: string
  core?: string
  platform?: string
  /** Manifest-relative HAL `.cpp` filename — fed through
   *  `resolveHalSourcePath` to the platform's opaque-key form
   *  (filesystem path on editor; bundled-asset key on web). */
  source?: string
  board_manager_url?: string
  c_flags?: string[]
  cxx_flags?: string[]
  ld_flags?: string[]
  define?: string | string[]
  extra_libraries?: string[]
  max_data_size?: number
  /** Per-board capability overrides — same merge semantics as the
   *  VPP-side `device.capabilities` field.  Resolved by
   *  `resolveTargetCapabilities` on top of the compiler preset. */
  capabilities?: Partial<TargetCapabilities>
  /** Declarative debug-channel resolver spec.  See `debug-spec.ts`
   *  for the schema.  Boards without a spec fall back to the
   *  "Debugging Not Available" outcome on the renderer side. */
  debug?: DebugSpec
}

/**
 * Map of board-name → entry, byte-identical with the shipped
 * `hals.json` content (Shared Surface Sync gate).
 */
export type HalsFileContent = Record<string, HalsBoardEntry>

/**
 * Narrow surface of the editor's `PackageManagerModule` the resolver
 * actually reads.  Web ships a no-op stub returning `[]` / `null`
 * until the VPP catalog lands on web; until then the VPP-lookup
 * branch is naturally bypassed.
 */
export interface PackageManagerPort {
  listInstalled(): InstalledPackage[]
  getInstalledPackageManifest(packageId: string): PackageManifest | null
}

/**
 * Platform-specific bits the resolver injects.  Keeping these out
 * of the shared class lets the resolver stay pure and bundler-
 * agnostic — editor passes node:fs / node:path-backed adapters;
 * web passes browser-friendly equivalents.
 */
export interface BoardInfoResolverConfig {
  /** Already-loaded `hals.json` content.  Editor reads from disk;
   *  web pulls via `import.meta.glob` at bundle time. */
  halsContent: HalsFileContent
  /** VPP package source.  Editor: `PackageManagerModule`.  Web:
   *  no-op stub today; real impl when VPP catalog lands on web. */
  packageManager: PackageManagerPort
  /** Convert a hals.json `source` field (relative HAL filename) to
   *  the opaque key downstream consumers will use.  Editor: an
   *  absolute filesystem path under `resources/sources/hal/`.  Web:
   *  a bundled-asset key under the same prefix. */
  resolveHalSourcePath: (relSource: string) => string
  /** Security-checked join for VPP-package-relative paths
   *  (`device.hal.source`, `device.hal.pluginEntry`, etc.).  The
   *  default implementation uses `path.resolve` + a traversal
   *  guard.  Editor uses the default; web won't call it until VPP
   *  lands on web, at which point its adapter overrides with
   *  whatever its package-storage scheme requires. */
  resolvePackageRelativePath: (packagePath: string, relPath: string) => string
}

/**
 * Compile/upload-time information about a board, sourced uniformly.
 * The compiler reads from this shape only; never directly from
 * `hals.json` or a VPP manifest.
 */
export interface BoardBuildInfo {
  /** Which catalog provided the entry. */
  source: 'hals' | 'vpp'
  /** Toolchain selector: `'arduino-cli' | 'openplc-compiler' | 'simulator'`. */
  compiler: string
  /** Mirror of `compiler` — convenience for callers that already
   *  treat the toolchain as the runtime identifier (editor's
   *  pre-migration `boardRuntime` variable). */
  boardRuntime: string
  /** `true` when this is the in-browser avr8js simulator target.
   *  Derived from `compiler === 'simulator'`. */
  isSimulator: boolean
  /** `true` when this is the legacy `'OpenPLC Runtime v3'` daemon.
   *  Derived from the board name string — v3 and v4 share the
   *  `'openplc-compiler'` `compiler` field, so the name is the only
   *  classifier. */
  isRuntimeV3: boolean
  /** `true` when this is the v4 vPLC runtime (compiler === 'openplc-compiler'
   *  and not v3). */
  isRuntimeV4: boolean

  // arduino-cli targets ----------------------------------------------------
  core?: string
  /** FQBN.  Consumed by `buildArduinoCliCompileArgs` and the
   *  hex-path derivation that the simulator-firmware loader keys
   *  off (`platform.replaceAll(':', '.')`). */
  platform?: string
  boardManagerUrl?: string
  /** Opaque key for the HAL `.cpp` to copy into the Baremetal
   *  sketch.  Format determined by the platform's
   *  `resolveHalSourcePath` / `resolvePackageRelativePath`
   *  (filesystem path on editor; bundled-asset key on web). */
  halSourceFile?: string
  compilerFlags?: {
    c_flags?: string[]
    cxx_flags?: string[]
    ld_flags?: string[]
  }
  /** Per-board `#define` lines — fed straight into
   *  `generateDefinesContent`'s "Board defines" section. */
  define?: string | string[]
  extraArduinoLibraries?: string[]
  /** Opaque key for a package-supplied `libraries/` folder. */
  localLibrariesDir?: string
  /** Prebuilt arduino-hal (provisioning="prebuilt"): the precompiled Arduino
   *  library dir, linked via a 2nd `--library`. Its presence marks an arduino
   *  prebuilt board (the source HAL still compiles as the integration layer). */
  precompiledLibraryDir?: string
  /** Exact Arduino core version to install/verify before linking a prebuilt
   *  arduino library (ABI-locked). From `target.coreVersion`. */
  coreVersion?: string
  /** Per-board capability overrides.  Merged by
   *  `resolveTargetCapabilities` on top of the compiler preset.
   *  Sourced from `hals.json` `capabilities` (static boards) or VPP
   *  manifest `device.capabilities` (VPP boards) — both paths feed
   *  the same shape so the pipeline reads a single field. */
  capabilities?: Partial<TargetCapabilities>
  /** Override for arduino-cli's `upload.maximum_data_size` check. */
  maxDataSize?: number
  /**
   * User-selectable FQBN sub-options surfaced from the VPP manifest.
   * The editor renders a dropdown per entry and appends
   * `:<key>=<chosen_id>` to `platform` at compile/upload time.
   * Absent for boards that don't expose variants; hals.json
   * builtins never carry this field.
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

  // Debug-channel resolver spec --------------------------------------------
  /** Declarative debug spec consumed by `resolveDebugConnection`.
   *  Carries through from both `hals.json` entries and VPP manifest
   *  device entries.  Undefined when the board didn't declare one;
   *  callers can fall back to "Debugging Not Available". */
  debug?: DebugSpec
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/** `boardName` literal that classifies as legacy Runtime v3. */
const RUNTIME_V3_NAME = 'OpenPLC Runtime v3'

export class BoardInfoResolver {
  constructor(private readonly config: BoardInfoResolverConfig) {}

  /**
   * Resolve a board name to its uniform build-info shape.  Throws
   * when the board isn't found in either catalog — callers expecting
   * a missing board to be a soft failure should `try/catch` and
   * fall back to their own error handling.
   */
  resolve(boardName: string): BoardBuildInfo {
    const fromHals = this.#tryHalsLookup(boardName)
    if (fromHals) return this.#withFlags(boardName, fromHals)

    const fromVpp = this.#tryVppLookup(boardName)
    if (fromVpp) return this.#withFlags(boardName, fromVpp)

    throw new Error(`Board "${boardName}" not found in hals.json or any installed VPP package`)
  }

  #tryHalsLookup(
    boardName: string,
  ): Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> | null {
    const entry = this.config.halsContent[boardName]
    if (!entry) return null
    return this.#fromHalsEntry(entry)
  }

  #fromHalsEntry(
    entry: HalsBoardEntry,
  ): Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> {
    const info: Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> = {
      source: 'hals',
      compiler: entry.compiler,
    }
    if (entry.core) info.core = entry.core
    if (entry.platform) info.platform = entry.platform
    if (entry.board_manager_url) info.boardManagerUrl = entry.board_manager_url
    if (entry.source) info.halSourceFile = this.config.resolveHalSourcePath(entry.source)
    const flags = this.#collectFlags(entry.c_flags, entry.cxx_flags, entry.ld_flags)
    if (flags) info.compilerFlags = flags
    if (entry.define) info.define = entry.define
    if (entry.extra_libraries) info.extraArduinoLibraries = entry.extra_libraries
    if (entry.max_data_size !== undefined) info.maxDataSize = entry.max_data_size
    if (entry.capabilities) info.capabilities = entry.capabilities
    if (entry.debug) info.debug = entry.debug
    return info
  }

  #tryVppLookup(
    boardName: string,
  ): Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> | null {
    for (const pkg of this.config.packageManager.listInstalled()) {
      const manifest = this.config.packageManager.getInstalledPackageManifest(pkg.packageId)
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
  ): Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> {
    const info: Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'> = {
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
    if (device.target.coreVersion) info.coreVersion = device.target.coreVersion

    const resolveRel = this.config.resolvePackageRelativePath
    if (device.hal.source) info.halSourceFile = resolveRel(pkg.path, device.hal.source)
    if (device.hal.pluginEntry) info.pluginEntry = resolveRel(pkg.path, device.hal.pluginEntry)
    if (device.hal.configTemplate) info.configTemplate = resolveRel(pkg.path, device.hal.configTemplate)
    if (device.hal.requirements) info.requirements = resolveRel(pkg.path, device.hal.requirements)
    if (device.hal.libraries) info.localLibrariesDir = resolveRel(pkg.path, device.hal.libraries)
    if (device.hal.precompiledLibrary) info.precompiledLibraryDir = resolveRel(pkg.path, device.hal.precompiledLibrary)

    const flags = this.#collectFlags(
      device.hal.compilerFlags?.c_flags,
      device.hal.compilerFlags?.cxx_flags,
      device.hal.compilerFlags?.ld_flags,
    )
    if (flags) info.compilerFlags = flags
    if (device.hal.define) info.define = device.hal.define
    if (device.hal.extraArduinoLibraries) info.extraArduinoLibraries = device.hal.extraArduinoLibraries
    if (device.capabilities) info.capabilities = device.capabilities

    if (device.hal.pluginType === 'python' || device.hal.pluginType === 'native') {
      info.pluginType = device.hal.pluginType
    }
    if (device.debug) info.debug = device.debug
    return info
  }

  /** Add runtime-classification flags + `boardRuntime` mirror on
   *  top of the base shape.  Centralised so hals and VPP lookups
   *  classify identically. */
  #withFlags(
    boardName: string,
    base: Omit<BoardBuildInfo, 'boardRuntime' | 'isSimulator' | 'isRuntimeV3' | 'isRuntimeV4'>,
  ): BoardBuildInfo {
    const boardRuntime = base.compiler
    const isRuntimeV3 = boardName === RUNTIME_V3_NAME
    const isRuntimeV4 = boardRuntime === 'openplc-compiler' && !isRuntimeV3
    const isSimulator = boardRuntime === 'simulator'
    return { ...base, boardRuntime, isSimulator, isRuntimeV3, isRuntimeV4 }
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
}
