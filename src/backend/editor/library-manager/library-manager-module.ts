import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'

import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { InstalledLibrary, LibraryInstallResult } from '../../../middleware/shared/ports/library-types'
import { importCodesysLibrary as sharedImportCodesys } from '../../shared/library/codesys-import'
import { compileStlib as sharedCompileStlib } from '../../shared/library/compile-stlib'
import {
  bundledArchiveToInstalledRow,
  userArchiveToInstalledRow,
} from '../../shared/library/installed-library-rows'
import { assertPathContained } from '../utils/path-containment'
import { validatePathId } from '../../shared/utils/path-safety'
import type { LibraryRegistry } from './types'

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
   * Resolve the strucpp-shipped bundled-libs directory.  Reads from
   * two different locations depending on dev vs packaged:
   *
   *   - **Dev**: `<repo>/node_modules/strucpp/libs/` — populated by
   *     `scripts/download-binaries.ts` on `npm install`.
   *
   *   - **Packaged**: `process.resourcesPath/strucpp/libs/` —
   *     populated by electron-builder's `extraResources` config.  We
   *     can't read from `app.getAppPath()/node_modules/strucpp` in
   *     packaged builds because strucpp isn't declared in
   *     `release/app/package.json`'s `dependencies`, so
   *     electron-builder prunes it out of the asar.
   */
  private resolveDefaultBundledDir(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'strucpp', 'libs')
    }
    return join(app.getAppPath(), 'node_modules', 'strucpp', 'libs')
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
      out.push(bundledArchiveToInstalledRow(archive))
    }

    const registry = this.readRegistry()
    const userEntries = Object.entries(registry.libraries).sort(([a], [b]) => a.localeCompare(b))
    for (const [name, info] of userEntries) {
      const archive = this.readUserArchive(name, info.stlibPath)
      if (!archive) continue
      out.push(
        userArchiveToInstalledRow(archive, {
          name,
          version: info.version,
          installedAt: info.installedAt,
          origin: info.origin,
        }),
      )
    }
    return out
  }

  /**
   * Load the full parsed archives for every enabled library — both
   * bundled and user-installed.  Used by the program build pipeline
   * (fed into `strucpp.compile`'s `libraries:` option) and by the
   * Library Project build pipeline (fed into `compileStlib`'s
   * dependency list so a library that references external symbols —
   * an OSCAT function, say — resolves at compile time).
   *
   * Bundled libraries are always-on and included unconditionally;
   * user libraries are filtered by `enabledNames`.  `missing` lists
   * enabled names that have no archive on disk so the caller can
   * surface a single "install or remove" error before strucpp runs,
   * instead of strucpp's per-symbol "function not found" cascade.
   */
  loadEnabledArchives(enabledNames: string[]): { archives: StlibArchiveDTO[]; missing: string[] } {
    const archives: StlibArchiveDTO[] = []
    for (const archive of this.readBundledArchives()) archives.push(archive)
    const registry = this.readRegistry()
    const missing: string[] = []
    for (const name of enabledNames) {
      const entry = registry.libraries[name]
      if (!entry) {
        missing.push(name)
        continue
      }
      const archive = this.readUserArchive(name, entry.stlibPath)
      if (!archive) {
        missing.push(name)
        continue
      }
      archives.push(archive)
    }
    return { archives, missing }
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
    // Read the .lib/.library bytes here (Node-only territory) and
    // hand them to the browser-pure shared importer.  The bytes-in
    // shape is the same the web backend uses against an HTTP upload
    // body, so the shared importer doesn't grow a path coupling.
    const bytes = new Uint8Array(readFileSync(filePath))
    const importResult = await sharedImportCodesys(bytes)
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

    const compileResult = sharedCompileStlib(importResult.sources, {
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
