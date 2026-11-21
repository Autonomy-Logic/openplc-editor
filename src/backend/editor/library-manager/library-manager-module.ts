import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

import type { CatalogTransportPort } from '../../../middleware/shared/ports/catalog-transport-port'
import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type { InstalledLibrary, LibraryInstallResult } from '../../../middleware/shared/ports/library-types'
import type { PublicLibrary } from '../../../middleware/shared/ports/public-catalog-types'
import { bundledArchiveToInstalledRow, userArchiveToInstalledRow } from '../../shared/library/installed-library-rows'
import {
  prepareCodesysUpload,
  type PreparedLibrary,
  prepareStlibUpload,
} from '../../shared/library/prepare-library-upload'
import { downloadPublicLibrary } from '../../shared/library/public-catalog-client'
import { selectBuildLibraryArchives } from '../../shared/library/select-library-archives'
import { stlibArchiveFromText } from '../../shared/library/stlib-archive-json'
import { validatePathId } from '../../shared/utils/path-safety'
import { libraryObjectFileName } from '../../shared/wasm-toolchain/library-objects'
import { assertPathContained } from '../utils/path-containment'
import { createDesktopCatalogTransport } from './desktop-catalog-transport'
import type { LibraryRegistry } from './types'

/**
 * Per-item result of a batch catalog install.  Errors are surfaced
 * inline so a single bad archive doesn't abort the rest — the modal
 * renders a per-row pass/fail summary.
 */
export interface CatalogInstallItemResult {
  publishedLibraryId: string
  success: boolean
  /** Manifest name once we've parsed the archive — present on success
   *  and on conflict-style failures ("already installed"). */
  name?: string
  version?: string
  error?: string
}

export interface CatalogInstallBatchResult {
  results: CatalogInstallItemResult[]
}

/**
 * Splice resolved displayName/description into a `.stlib` archive's
 * own manifest before it's persisted.  Only called when a catalog
 * install's metadata actually differs from what the downloaded
 * archive's manifest carries — a no-op archive is returned unchanged
 * on any parse failure so a malformed download still surfaces its
 * real error from `persistPrepared`'s own validation, not this helper.
 */
function withOverriddenManifestMetadata(
  archiveText: string,
  overrides: { displayName?: string; description?: string },
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(archiveText)
  } catch {
    return archiveText
  }
  if (!parsed || typeof parsed !== 'object') return archiveText
  const manifest = (parsed as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object') return archiveText
  return JSON.stringify({ ...parsed, manifest: { ...manifest, ...overrides } })
}

/**
 * System-wide library pool.
 *
 * Two physical sources merge into one in-memory catalogue:
 *
 *   - **Bundled** — every `.stlib` shipping in the strucpp resources
 *     dir and in the HMI widgets dir (the pinned openplc-hmi-widgets
 *     release).  Discovered fresh each session (no on-disk registry
 *     entry), flagged `bundled: true`, never uninstallable.
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
  private hmiWidgetsDir: string
  private catalogTransport: CatalogTransportPort

  constructor(opts?: {
    librariesDir?: string
    bundledDir?: string
    hmiWidgetsDir?: string
    catalogTransport?: CatalogTransportPort
  }) {
    this.librariesDir = opts?.librariesDir ?? join(app.getPath('userData'), 'libraries')
    this.registryPath = join(this.librariesDir, 'registry.json')
    this.bundledDir = opts?.bundledDir ?? this.resolveDefaultBundledDir()
    this.hmiWidgetsDir = opts?.hmiWidgetsDir ?? this.resolveDefaultHmiWidgetsDir()
    // The catalog transport is injected so tests can stub HTTP — the
    // default desktop impl reads `OPENPLC_EDGE_API_URL` lazily on
    // every request, so it picks up env changes without restarting.
    this.catalogTransport = opts?.catalogTransport ?? createDesktopCatalogTransport()
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
   *
   *   - **Built, not packaged** (`release/app/dist/main/main.js` run directly, as the e2e suite does): the app path is
   *     `release/app`, which has no strucpp, so the working directory's `node_modules` is read instead.
   */
  private resolveDefaultBundledDir(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'strucpp', 'libs')
    }
    const fromApp = join(app.getAppPath(), 'node_modules', 'strucpp', 'libs')
    return existsSync(fromApp) ? fromApp : join(process.cwd(), 'node_modules', 'strucpp', 'libs')
  }

  /**
   * The pre-installed HMI widget libraries (`npm run setup:hmi-widgets`): `vendor/hmi-widgets/` in a checkout,
   * `process.resourcesPath/hmi-widgets/` when packaged.
   */
  private resolveDefaultHmiWidgetsDir(): string {
    if (app.isPackaged) return join(process.resourcesPath, 'hmi-widgets')
    const fromApp = join(app.getAppPath(), 'vendor', 'hmi-widgets')
    return existsSync(fromApp) ? fromApp : join(process.cwd(), 'vendor', 'hmi-widgets')
  }

  /** The `.stlib` files of the bundled directories, strucpp's first, each sorted by file name. */
  private bundledFiles(): string[] {
    return [this.bundledDir, this.hmiWidgetsDir].flatMap((dir) =>
      existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => f.endsWith('.stlib'))
            .sort()
            .map((f) => join(dir, f))
        : [],
    )
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
   * Selection is `selectBuildLibraryArchives`: bundled libraries
   * always, user-installed ones by `enabledNames`.  `missing` lists
   * enabled names that have no archive on disk so the caller can
   * surface a single "install or remove" error before strucpp runs,
   * instead of strucpp's per-symbol "function not found" cascade.
   */
  loadEnabledArchives(enabledNames: string[]): { archives: StlibArchiveDTO[]; missing: string[] } {
    const registry = this.readRegistry()
    const installed = Object.entries(registry.libraries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, info]) => ({ name, archive: this.readUserArchive(name, info.stlibPath) }))
    return selectBuildLibraryArchives(this.readBundledArchives(), installed, enabledNames)
  }

  /**
   * The raw `.stlib` text for one library, or null when this machine does not
   * have it.
   *
   * Text rather than the parsed archive on purpose: this feeds the project
   * snapshot stored on a device, which bundles libraries verbatim and hashes
   * them so the opening client can tell "same library" from "same name and
   * version, different bytes". Re-serialising a parsed archive would hash a
   * representation of the artifact rather than the artifact.
   *
   * User-installed wins over bundled, matching `loadAll`'s precedence: a
   * library someone installed deliberately is the one the project means.
   */
  readArchiveText(name: string): string | null {
    const entry = this.readRegistry().libraries[name]
    if (entry) {
      try {
        assertPathContained(this.librariesDir, entry.stlibPath, `library[${name}].stlibPath`)
        if (existsSync(entry.stlibPath)) return readFileSync(entry.stlibPath, 'utf-8')
      } catch {
        // Fall through to the bundled copy. A registry entry pointing outside
        // the libraries directory is exactly what that guard exists to stop.
      }
    }

    for (const file of this.bundledFiles()) {
      try {
        const text = readFileSync(file, 'utf-8')
        const parsed = JSON.parse(text) as { manifest?: { name?: unknown } }
        if (parsed.manifest?.name === name) return text
      } catch {
        // Skip a malformed bundled archive, as readBundledArchives does.
      }
    }
    return null
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
   * Install one or more libraries from the public catalog hosted on
   * autonomy-edge.  Each row's archive is fetched, validated, and
   * persisted via the same `.stlib` install path the file picker
   * uses — only the source of the archive bytes differs.  Takes the
   * full catalog rows (not just ids) for the same reason the web
   * adapter does: `authorHandle`/`displayName`/`description` are
   * metadata the downloaded `.stlib` archive's own manifest doesn't
   * reliably carry — see `library-port.ts`.
   *
   * Failures are per-item: a 404 / parse error / name-collision on
   * one library doesn't abort the rest, so the modal can show
   * "5 succeeded, 1 failed" rather than throw away the whole batch.
   * Emits a single `libraries:changed` after the loop (the IPC
   * handler does this) so the renderer refreshes once, not N times.
   */
  async installFromCatalog(libraries: PublicLibrary[]): Promise<CatalogInstallBatchResult> {
    const results: CatalogInstallItemResult[] = []
    for (const row of libraries) {
      try {
        const archiveText = await downloadPublicLibrary(this.catalogTransport, { id: row.id })
        const prepared = prepareStlibUpload(archiveText)
        // The archive's own manifest carries the author as whatever
        // free text the library's author typed in — the catalog
        // row's authorHandle is the real, authoritative publisher
        // identity from autonomy-edge, so it wins here.  Mirrors the
        // web adapter's finalization in web-library-manager.ts.
        //
        // Unlike web (which sends displayName/description/author as
        // separate fields to a backend that stores them alongside the
        // archive), this platform has nowhere else to keep them:
        // `listInstalled()` reads displayName/description straight
        // back off the persisted archive's own manifest (see
        // `userArchiveToInstalledRow`), so the override has to be
        // baked into the archive text before it's written — otherwise
        // it's computed here and silently dropped. `InstalledLibrary`
        // has no author field on this platform at all, so `author`
        // is finalized for parity with web's PreparedLibrary shape
        // but isn't persisted or shown anywhere (yet).
        const finalized: PreparedLibrary = {
          ...prepared,
          displayName: row.displayName || prepared.displayName,
          description: row.description ?? prepared.description,
          author: row.authorHandle || prepared.author,
        }
        const archive =
          finalized.displayName === prepared.displayName && finalized.description === prepared.description
            ? finalized.archive
            : withOverriddenManifestMetadata(finalized.archive, {
                displayName: finalized.displayName,
                description: finalized.description,
              })
        const persistResult = this.persistPrepared({ ...finalized, archive })
        if (persistResult.success && !persistResult.canceled) {
          results.push({
            publishedLibraryId: row.id,
            success: true,
            name: persistResult.name,
            version: persistResult.version,
          })
        } else if (!persistResult.success) {
          results.push({
            publishedLibraryId: row.id,
            success: false,
            name: finalized.name,
            version: finalized.version,
            error: persistResult.error,
          })
        }
      } catch (err) {
        results.push({
          publishedLibraryId: row.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { results }
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

  /**
   * The file next to a user-installed library's archive that holds its compiled object of `kind`, named by
   * `libraryObjectFileName`; null for a library this machine keeps no files next to (bundled, unknown, or a name or
   * kind that is not a plain file name part).
   */
  private libraryObjectPath(name: string, kind: string): string | null {
    try {
      validatePathId(name, 'name')
    } catch {
      return null
    }
    const entry = this.readRegistry().libraries[name]
    if (!entry) return null
    try {
      assertPathContained(this.librariesDir, entry.stlibPath, `library[${name}].stlibPath`)
    } catch {
      return null
    }
    const fileName = libraryObjectFileName(basename(entry.stlibPath), kind)
    return fileName === null ? null : join(dirname(entry.stlibPath), fileName)
  }

  /** The bytes of a library's compiled object of `kind`, as stored next to its archive; null when there are none. */
  readLibraryObject(name: string, kind: string): Uint8Array | null {
    const path = this.libraryObjectPath(name, kind)
    if (path === null || !existsSync(path)) return null
    return new Uint8Array(readFileSync(path))
  }

  /** Stores a library's compiled object of `kind` next to its archive; does nothing for a library with no folder. */
  writeLibraryObject(name: string, kind: string, bytes: Uint8Array): void {
    const path = this.libraryObjectPath(name, kind)
    if (path === null || !existsSync(dirname(path))) return
    writeFileSync(path, bytes)
  }

  // -------------------------------------------------------------------------
  // Install paths
  // -------------------------------------------------------------------------

  /**
   * Install a `.stlib` from text rather than a file on disk.
   *
   * The archives bundled with a retrieved project arrive as text -- they came
   * out of a ZIP fetched from a device, never touching the filesystem. Writing
   * them to a temp file just to read them back would add a failure mode and an
   * exposure window for no benefit: `installStlib` already reduces to
   * `prepareStlibUpload(text)` plus the shared persist step.
   *
   * The text is validated by the same strucpp preparer as any other install,
   * so an archive from a device gets no more trust than one a user picked.
   */
  async installFromText(archiveText: string): Promise<LibraryInstallResult> {
    let prepared: PreparedLibrary
    try {
      prepared = prepareStlibUpload(archiveText)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    return this.persistPrepared(prepared)
  }

  private async installStlib(filePath: string): Promise<LibraryInstallResult> {
    let prepared: PreparedLibrary
    try {
      prepared = prepareStlibUpload(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    return this.persistPrepared(prepared)
  }

  private async installFromCodesys(filePath: string): Promise<LibraryInstallResult> {
    // Read the .lib/.library bytes here (Node-only territory) and
    // hand them to the platform-agnostic shared preparer.  The
    // bytes-in / filename-in shape is the same web's library-adapter
    // uses against an HTTP upload, so the shared module isn't coupled
    // to either backend's storage.
    let prepared: PreparedLibrary
    try {
      prepared = await prepareCodesysUpload(new Uint8Array(readFileSync(filePath)), basename(filePath))
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    return this.persistPrepared(prepared)
  }

  /**
   * Write a strucpp-validated archive under
   * `{userData}/libraries/<name>/<name>.stlib` and register it.
   * Manifest parsing + extraction already happened in the shared
   * preparer; this step is pure storage + filesystem-safety checks.
   */
  private persistPrepared(prepared: PreparedLibrary): LibraryInstallResult {
    try {
      validatePathId(prepared.name, 'manifest.name')
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (this.isBundled(prepared.name)) {
      return {
        success: false,
        error: `Cannot install '${prepared.name}' — a bundled library with this name already exists`,
      }
    }

    const libraryDir = join(this.librariesDir, prepared.name)
    assertPathContained(this.librariesDir, libraryDir, 'library install path')
    mkdirSync(libraryDir, { recursive: true })
    const stlibPath = join(libraryDir, `${prepared.name}.stlib`)
    writeFileSync(stlibPath, prepared.archive, 'utf-8')

    const registry = this.readRegistry()
    registry.libraries[prepared.name] = {
      version: prepared.version,
      installedAt: new Date().toISOString(),
      stlibPath,
      origin: prepared.origin,
    }
    this.writeRegistry(registry)

    return {
      success: true,
      name: prepared.name,
      version: prepared.version,
      origin: prepared.origin,
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private bundledArchivesCache: StlibArchiveDTO[] | null = null
  private bundledNamesCache: Set<string> | null = null

  /** Discover bundled archives.  Cached for the process lifetime
   *  because the bundled directories don't change at runtime. */
  private readBundledArchives(): StlibArchiveDTO[] {
    if (this.bundledArchivesCache) return this.bundledArchivesCache
    const archives: StlibArchiveDTO[] = []
    const names = new Set<string>()
    for (const file of this.bundledFiles()) {
      try {
        const archive = stlibArchiveFromText(readFileSync(file, 'utf-8'))
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
      return stlibArchiveFromText(readFileSync(stlibPath, 'utf-8'))
    } catch {
      return null
    }
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
