import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

import type { CatalogTransportPort } from '../../../middleware/shared/ports/catalog-transport-port'
import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import type {
  EnabledArchives,
  InstalledLibrary,
  LibraryInstallResult,
  LibraryRef,
  VersionSubstitution,
} from '../../../middleware/shared/ports/library-types'
import type { PublicLibrary } from '../../../middleware/shared/ports/public-catalog-types'
import { bundledArchiveToInstalledRow, userArchiveToInstalledRow } from '../../shared/library/installed-library-rows'
import {
  prepareCodesysUpload,
  type PreparedLibrary,
  prepareStlibUpload,
} from '../../shared/library/prepare-library-upload'
import { downloadPublicLibrary } from '../../shared/library/public-catalog-client'
import { validatePathId } from '../../shared/utils/path-safety'
import { assertPathContained } from '../utils/path-containment'
import { createDesktopCatalogTransport } from './desktop-catalog-transport'
import {
  migrateRegistry,
  REGISTRY_FORMAT_VERSION,
  resolveVersion,
  versionDirName,
  versionsNewestFirst,
} from './registry-versions'
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
  private catalogTransport: CatalogTransportPort

  constructor(opts?: { librariesDir?: string; bundledDir?: string; catalogTransport?: CatalogTransportPort }) {
    this.librariesDir = opts?.librariesDir ?? join(app.getPath('userData'), 'libraries')
    this.registryPath = join(this.librariesDir, 'registry.json')
    this.bundledDir = opts?.bundledDir ?? this.resolveDefaultBundledDir()
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
      // One row per library, not per version: the row names the newest and
      // lists the rest, so the manager can offer them without duplicate rows.
      // Only versions whose archive is actually readable are listed -- and a
      // missing newest must not hide the ones that are still here.
      const readable = versionsNewestFirst(info.versions).filter(
        (version) => this.readUserArchive(name, info.versions[version].stlibPath) !== null,
      )
      const newest = readable[0]
      if (!newest) continue
      const entry = info.versions[newest]
      const archive = this.readUserArchive(name, entry.stlibPath)
      if (!archive) continue
      out.push({
        ...userArchiveToInstalledRow(archive, {
          name,
          version: newest,
          installedAt: entry.installedAt,
          origin: entry.origin,
        }),
        versions: readable,
      })
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
  loadEnabledArchives(refs: ReadonlyArray<LibraryRef>): EnabledArchives<StlibArchiveDTO> {
    const archives: StlibArchiveDTO[] = []
    for (const archive of this.readBundledArchives()) archives.push(archive)
    const registry = this.readRegistry()
    const missing: string[] = []
    const substituted: VersionSubstitution[] = []
    for (const ref of refs) {
      const installed = registry.libraries[ref.name]
      const resolved = installed ? resolveVersion(installed.versions, ref.version) : null
      if (!resolved) {
        missing.push(ref.name)
        continue
      }
      const archive = this.readUserArchive(ref.name, resolved.entry.stlibPath)
      if (!archive) {
        missing.push(ref.name)
        continue
      }
      // Reported rather than fatal: refusing to build a project whose pinned
      // version is not on this machine would strand it, and the substitution
      // is exactly what the caller needs to tell the user about.
      if (resolved.substituted && ref.version) {
        substituted.push({ name: ref.name, wanted: ref.version, used: resolved.version })
      }
      archives.push(archive)
    }
    return { archives, missing, substituted }
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
  readArchiveText(name: string, version?: string): string | null {
    const installed = this.readRegistry().libraries[name]
    const resolved = installed ? resolveVersion(installed.versions, version) : null
    if (resolved) {
      const { stlibPath } = resolved.entry
      try {
        assertPathContained(this.librariesDir, stlibPath, `library[${name}].stlibPath`)
        if (existsSync(stlibPath)) return readFileSync(stlibPath, 'utf-8')
      } catch {
        // Fall through to the bundled copy. A registry entry pointing outside
        // the libraries directory is exactly what that guard exists to stop.
      }
    }

    if (!existsSync(this.bundledDir)) return null
    for (const file of readdirSync(this.bundledDir).filter((f) => f.endsWith('.stlib'))) {
      try {
        const text = readFileSync(join(this.bundledDir, file), 'utf-8')
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
      // Every installed version, newest first. The renderer narrows this to
      // the one the open project pins; the pool itself carries them all so
      // that choice can be made without another round trip.
      for (const version of versionsNewestFirst(info.versions)) {
        const archive = this.readUserArchive(name, info.versions[version].stlibPath)
        if (archive) out.push(archive)
      }
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
  uninstall(name: string, version?: string): { success: boolean; error?: string } {
    try {
      validatePathId(name, 'name')
      if (this.isBundled(name)) {
        return { success: false, error: `Cannot uninstall bundled library '${name}'` }
      }

      const registry = this.readRegistry()
      const installed = registry.libraries[name]
      if (!installed) {
        return { success: false, error: `Library '${name}' is not installed` }
      }

      const libraryDir = join(this.librariesDir, name)
      assertPathContained(this.librariesDir, libraryDir, 'library install path')

      // One version, or the whole library when none is named.
      if (version !== undefined) {
        const entry = installed.versions[version]
        if (!entry) {
          return { success: false, error: `Library '${name}' version ${version} is not installed` }
        }
        // The folder comes from the entry, never from the version string.
        // `persistPrepared` sanitises a version into a folder name, so a
        // version legally installed as `1.0.0+sha.abc` does not name its own
        // directory and cannot be validated as a path id.
        const entryDir = dirname(entry.stlibPath)
        // A version migrated from the old layout keeps its archive directly in
        // the library folder, shared with its siblings — remove just the archive.
        const target = entryDir === libraryDir ? entry.stlibPath : entryDir
        assertPathContained(this.librariesDir, target, 'library install path')
        if (existsSync(target)) rmSync(target, { recursive: true })
        delete installed.versions[version]
        if (Object.keys(installed.versions).length === 0) {
          delete registry.libraries[name]
          // Last version gone: take the library folder with it rather than
          // leaving an empty directory behind.
          if (existsSync(libraryDir)) rmSync(libraryDir, { recursive: true })
        }
        this.writeRegistry(registry)
        return { success: true }
      }

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

    const registry = this.readRegistry()
    // Versions live side by side; installing one leaves the others alone, and
    // re-installing the same one replaces only itself -- so it keeps the folder
    // it already has rather than being given a fresh one.
    const installed = (registry.libraries[prepared.name] ??= { versions: {} })
    const existing = installed.versions[prepared.version]
    const folder = existing
      ? basename(dirname(existing.stlibPath))
      : versionDirName(
          prepared.version,
          Object.values(installed.versions).map((entry) => basename(dirname(entry.stlibPath))),
        )

    const versionDir = join(this.librariesDir, prepared.name, folder)
    assertPathContained(this.librariesDir, versionDir, 'library install path')
    mkdirSync(versionDir, { recursive: true })
    const stlibPath = join(versionDir, `${prepared.name}.stlib`)
    writeFileSync(stlibPath, prepared.archive, 'utf-8')

    installed.versions[prepared.version] = {
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
   *  because the strucpp resources dir doesn't change at runtime. */
  private readBundledArchives(): StlibArchiveDTO[] {
    if (this.bundledArchivesCache) return this.bundledArchivesCache
    if (!existsSync(this.bundledDir)) {
      this.bundledArchivesCache = []
      this.bundledNamesCache = new Set()
      return []
    }
    const entries = readdirSync(this.bundledDir)
      .filter((f) => f.endsWith('.stlib'))
      .sort()
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

  /** Always returned in the current format; a v1 file is migrated on read. */
  private readRegistry(): LibraryRegistry {
    if (!existsSync(this.registryPath)) {
      return { formatVersion: REGISTRY_FORMAT_VERSION, libraries: {} }
    }
    try {
      return migrateRegistry(JSON.parse(readFileSync(this.registryPath, 'utf-8')))
    } catch {
      return { formatVersion: REGISTRY_FORMAT_VERSION, libraries: {} }
    }
  }

  private writeRegistry(registry: LibraryRegistry): void {
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8')
  }
}
