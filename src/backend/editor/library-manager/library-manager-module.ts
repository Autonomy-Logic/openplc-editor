import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'

import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { InstalledLibrary, LibraryInstallResult } from '../../../middleware/shared/ports/library-types'
import { assertPathContained, validatePathId } from '../../shared/utils/path-safety'
import type { LibraryRegistry } from './types'

/**
 * Strucpp's CODESYS importer + .stlib compiler.  Loaded lazily because
 * strucpp uses ESM features (import.meta) that don't survive Jest's
 * CJS transform; the actual import only happens when an install
 * call needs it.  Same shape as `loadStrucpp()` in the compiler module.
 */
type StrucppImportModule = {
  importCodesysLibrary: (path: string) => {
    success: boolean
    sources?: { fileName: string; source: string; category?: string }[]
    globalConstants?: Record<string, number>
    errors?: string[]
  }
  compileStlib: (
    sources: { fileName: string; source: string; category?: string }[],
    options: {
      name: string
      version: string
      namespace: string
      noSource?: boolean
      builtin?: boolean
      globalConstants?: Record<string, number>
    },
  ) => { success: boolean; archive?: unknown; errors?: { message: string; line?: number; file?: string }[] }
  loadStlibFromFile: (path: string) => unknown
}

function loadStrucpp(): StrucppImportModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('strucpp') as StrucppImportModule
}

/**
 * System-wide library pool.
 *
 * Two physical sources merge into one in-memory catalogue:
 *
 *   - **Bundled** — every `.stlib` shipping in the strucpp resources
 *     dir.  Discovered fresh each session (no on-disk registry
 *     entry), flagged `bundled: true`, never uninstallable.  Future
 *     strucpp releases that add libraries automatically grow this set.
 *
 *   - **User-installed** — `.stlib` archives the user imports
 *     directly + CODESYS `.lib`/`.library` files run through
 *     strucpp's importer to produce a `.stlib`.  Persisted under
 *     `{userData}/libraries/<name>/<name>.stlib` with metadata in
 *     `{userData}/libraries/registry.json`.
 *
 * Library identity = the strucpp manifest `name`.  That's the same
 * value `project.json`'s `libraries[].name` records, so project ↔
 * pool joins are O(1) on a Map keyed by name.
 */
export class LibraryManagerModule {
  private librariesDir: string
  private registryPath: string
  private bundledDir: string

  constructor(opts?: { librariesDir?: string; bundledDir?: string }) {
    this.librariesDir = opts?.librariesDir ?? join(app.getPath('userData'), 'libraries')
    this.registryPath = join(this.librariesDir, 'registry.json')
    this.bundledDir =
      opts?.bundledDir ?? this.resolveDefaultBundledDir()
    mkdirSync(this.librariesDir, { recursive: true })
  }

  /**
   * Resolve the strucpp-shipped bundled-libs directory.  Dev runs
   * point at the repo's `resources/strucpp/libs/`, packaged builds
   * at `process.resourcesPath/strucpp/libs/` — same logic the
   * existing `system-libraries:load-bundled` IPC handler uses.
   */
  private resolveDefaultBundledDir(): string {
    const isDev = process.env.NODE_ENV === 'development'
    return isDev
      ? join(process.cwd(), 'resources', 'strucpp', 'libs')
      : join(process.resourcesPath, 'strucpp', 'libs')
  }

  // -------------------------------------------------------------------------
  // Public API — IPC entry points
  // -------------------------------------------------------------------------

  /**
   * Install the library at `filePath`.  Dispatches by extension:
   * `.stlib` is parsed and copied verbatim, `.lib`/`.library` is
   * piped through strucpp's CODESYS importer + compileStlib.
   *
   * Returns the same shape regardless of origin so the renderer
   * doesn't need to branch on file type.
   */
  async installFromFile(filePath: string): Promise<LibraryInstallResult> {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      const ext = extname(filePath).toLowerCase()
      if (ext === '.stlib') {
        return this.installStlib(filePath)
      }
      if (ext === '.lib' || ext === '.library') {
        return this.installFromCodesys(filePath)
      }
      return {
        success: false,
        error: `Unsupported library format: ${ext} (expected .stlib, .lib, or .library)`,
      }
    } catch (err) {
      return { success: false, error: `Install failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Catalogue rows for the manager UI.  Bundled libs appear first
   * (in alphabetical filename order from the strucpp dir), then
   * user-installed libs alphabetical by `name`.
   */
  listInstalled(): InstalledLibrary[] {
    const out: InstalledLibrary[] = []

    for (const archive of this.readBundledArchives()) {
      out.push({
        name: archive.manifest.name,
        version: archive.manifest.version,
        bundled: true,
        installedAt: '',
        origin: 'bundled',
        ...(archive.manifest.displayName ? { displayName: archive.manifest.displayName } : {}),
        ...(archive.manifest.description ? { description: archive.manifest.description } : {}),
      })
    }

    const registry = this.readRegistry()
    const userEntries = Object.entries(registry.libraries).sort(([a], [b]) => a.localeCompare(b))
    for (const [name, info] of userEntries) {
      const archive = this.readUserArchive(name, info.stlibPath)
      if (!archive) continue
      out.push({
        name,
        version: info.version,
        bundled: false,
        installedAt: info.installedAt,
        origin: info.origin,
        ...(archive.manifest.displayName ? { displayName: archive.manifest.displayName } : {}),
        ...(archive.manifest.description ? { description: archive.manifest.description } : {}),
      })
    }
    return out
  }

  /**
   * Return every installed archive's parsed contents — bundled then
   * user-installed alphabetical.  Used by the renderer to hydrate
   * the in-memory library state at startup and after install/uninstall
   * change events.
   */
  loadAll(): StlibArchiveDTO[] {
    const out: StlibArchiveDTO[] = []
    for (const archive of this.readBundledArchives()) out.push(archive)
    const registry = this.readRegistry()
    const userEntries = Object.entries(registry.libraries).sort(([a], [b]) => a.localeCompare(b))
    for (const [name, info] of userEntries) {
      const archive = this.readUserArchive(name, info.stlibPath)
      if (archive) out.push(archive)
    }
    return out
  }

  /**
   * Remove a user-installed library.  Refuses for bundled libraries
   * — those are always-on (the caller should disable them at the
   * project level instead).
   */
  uninstall(name: string): { success: boolean; error?: string } {
    try {
      validatePathId(name, 'name')
      if (this.isBundled(name)) {
        return { success: false, error: `Cannot uninstall bundled library '${name}'` }
      }

      const registry = this.readRegistry()
      const entry = registry.libraries[name]
      if (!entry) {
        return { success: false, error: `Library '${name}' is not installed` }
      }

      const libraryDir = join(this.librariesDir, name)
      assertPathContained(this.librariesDir, libraryDir, 'library install path')
      if (existsSync(libraryDir)) {
        rmSync(libraryDir, { recursive: true })
      }
      delete registry.libraries[name]
      this.writeRegistry(registry)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Uninstall failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // -------------------------------------------------------------------------
  // Install paths
  // -------------------------------------------------------------------------

  private async installStlib(filePath: string): Promise<LibraryInstallResult> {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return { success: false, error: 'Invalid .stlib: not valid JSON' }
    }
    return this.persistArchive(raw, 'stlib')
  }

  private async installFromCodesys(filePath: string): Promise<LibraryInstallResult> {
    const strucpp = loadStrucpp()
    const importResult = strucpp.importCodesysLibrary(filePath)
    if (!importResult.success || !importResult.sources) {
      const errs = (importResult.errors ?? ['unknown error']).join('; ')
      return { success: false, error: `CODESYS import failed: ${errs}` }
    }

    // Derive a stable name + version from the file basename.  CODESYS
    // .library files have richer metadata in the binary header, but
    // strucpp's importer doesn't currently surface it; falling back to
    // the filename gives the user a predictable identifier they can
    // rename later if needed.
    const baseName = basename(filePath, extname(filePath))
    let identifier = baseName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
    if (!identifier) identifier = 'imported-library'

    const compileResult = strucpp.compileStlib(importResult.sources, {
      name: identifier,
      version: '1.0.0',
      namespace: identifier.replace(/[^A-Za-z0-9_]/g, '_'),
      noSource: false,
      builtin: false,
      ...(importResult.globalConstants ? { globalConstants: importResult.globalConstants } : {}),
    })
    if (!compileResult.success || !compileResult.archive) {
      const errs = (compileResult.errors ?? []).map((e) => e.message).join('; ')
      return { success: false, error: `CODESYS compile failed: ${errs || 'unknown error'}` }
    }

    return this.persistArchive(compileResult.archive, 'codesys')
  }

  /**
   * Validate an in-memory archive (must look like an `StlibArchive`),
   * write it to disk under `{userData}/libraries/<name>/<name>.stlib`,
   * and register the entry.  Shared between the .stlib and CODESYS
   * paths so disk shape stays uniform regardless of origin.
   */
  private async persistArchive(raw: unknown, origin: 'stlib' | 'codesys'): Promise<LibraryInstallResult> {
    const archive = this.coerceArchive(raw)
    if (!archive) {
      return { success: false, error: 'Library archive is missing a manifest' }
    }
    const name = archive.manifest.name
    const version = archive.manifest.version
    if (typeof name !== 'string' || !name) {
      return { success: false, error: 'Library archive manifest is missing a name' }
    }
    if (typeof version !== 'string' || !version) {
      return { success: false, error: 'Library archive manifest is missing a version' }
    }

    try {
      validatePathId(name, 'manifest.name')
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (this.isBundled(name)) {
      return {
        success: false,
        error: `Cannot install '${name}' — a bundled library with this name already exists`,
      }
    }

    const libraryDir = join(this.librariesDir, name)
    assertPathContained(this.librariesDir, libraryDir, 'library install path')
    mkdirSync(libraryDir, { recursive: true })
    const stlibPath = join(libraryDir, `${name}.stlib`)
    writeFileSync(stlibPath, JSON.stringify(archive, null, 2) + '\n', 'utf-8')

    const registry = this.readRegistry()
    registry.libraries[name] = {
      version,
      installedAt: new Date().toISOString(),
      stlibPath,
      origin,
    }
    this.writeRegistry(registry)

    return { success: true, name, version, origin }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private bundledArchivesCache: StlibArchiveDTO[] | null = null
  private bundledNamesCache: Set<string> | null = null

  /** Discover bundled archives.  Cached for the process lifetime
   *  because the strucpp resources dir doesn't change at runtime. */
  private readBundledArchives(): StlibArchiveDTO[] {
    if (this.bundledArchivesCache) return this.bundledArchivesCache
    if (!existsSync(this.bundledDir)) {
      this.bundledArchivesCache = []
      this.bundledNamesCache = new Set()
      return []
    }
    const entries = readdirSync(this.bundledDir).filter((f) => f.endsWith('.stlib')).sort()
    const archives: StlibArchiveDTO[] = []
    const names = new Set<string>()
    for (const file of entries) {
      try {
        const raw = JSON.parse(readFileSync(join(this.bundledDir, file), 'utf-8')) as unknown
        const archive = this.coerceArchive(raw)
        if (archive) {
          archives.push(archive)
          names.add(archive.manifest.name)
        }
      } catch {
        // Skip malformed bundled archives — surfacing them as a hard
        // failure here would break startup; the missing entry is
        // self-evident in the manager UI.
      }
    }
    this.bundledArchivesCache = archives
    this.bundledNamesCache = names
    return archives
  }

  private isBundled(name: string): boolean {
    if (!this.bundledNamesCache) this.readBundledArchives()
    return this.bundledNamesCache!.has(name)
  }

  private readUserArchive(name: string, stlibPath: string): StlibArchiveDTO | null {
    try {
      assertPathContained(this.librariesDir, stlibPath, `library[${name}].stlibPath`)
    } catch {
      return null
    }
    if (!existsSync(stlibPath)) return null
    try {
      const raw = JSON.parse(readFileSync(stlibPath, 'utf-8')) as unknown
      return this.coerceArchive(raw)
    } catch {
      return null
    }
  }

  /**
   * Light-touch validation that an unknown JSON blob has the
   * `StlibArchive` shape the rest of the editor expects.  Doesn't
   * try to schema-validate every field — we trust strucpp's
   * compileStlib output and the .stlib format spec — but guards
   * against catastrophic mismatches (missing manifest, no name).
   */
  private coerceArchive(raw: unknown): StlibArchiveDTO | null {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as { manifest?: unknown }
    if (!obj.manifest || typeof obj.manifest !== 'object') return null
    return raw as StlibArchiveDTO
  }

  private readRegistry(): LibraryRegistry {
    if (!existsSync(this.registryPath)) {
      return { formatVersion: '1.0', libraries: {} }
    }
    try {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8')) as LibraryRegistry
    } catch {
      return { formatVersion: '1.0', libraries: {} }
    }
  }

  private writeRegistry(registry: LibraryRegistry): void {
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8')
  }
}
