/**
 * LibraryPort — abstracts the system-wide IEC 61131-3 library pool.
 *
 * Both bundled libraries (the IEC base set strucpp ships in
 * `<resources>/strucpp/libs/`) and user-installed libraries (under
 * `{userData}/libraries/`) flow through this port.  Bundled libs are
 * non-disableable and carry `bundled: true` on every shape that
 * surfaces them; user libs can be installed from either a native
 * `.stlib` archive or a CODESYS `.lib`/`.library` (the editor runs
 * the latter through strucpp's CODESYS importer to produce the
 * archive).
 *
 * Editor adapter: delegates to the main process LibraryManagerModule
 *   over IPC.  The renderer never touches the filesystem.
 * Web adapter (future): will fetch + manage libraries through a
 *   backend API following the same shape.
 */

import type { InstalledLibrary, LibraryInstallResult } from './library-types'
import type { ListPublicLibrariesArgs, ListPublicLibrariesResponse, PublicLibrary } from './public-catalog-types'
import type { Result, Unsubscribe } from './types'

/**
 * Per-library outcome of a batch catalog install.  Mirrors the
 * main-process `CatalogInstallItemResult` shape — kept in the port
 * layer so renderer + adapter don't pull from `backend/editor/*`
 * directly (a boundary the architecture lint check enforces).
 */
export interface CatalogInstallItem {
  publishedLibraryId: string
  success: boolean
  name?: string
  version?: string
  error?: string
}

export interface CatalogInstallBatch {
  results: CatalogInstallItem[]
}

export type CatalogQueryResult =
  | { success: true; data: ListPublicLibrariesResponse }
  | { success: false; error: string }

/**
 * Minimal subset of `strucpp.StlibArchive` the editor consumes.
 * Carrying a dedicated DTO here (rather than re-exporting strucpp's
 * types) keeps the editor's middleware layer free of a hard
 * dependency on the strucpp package surface — only the manifest
 * fields the editor renders are surfaced.  New fields strucpp adds
 * in the future are simply ignored until something here opts in to
 * them.
 */
export interface StlibArchiveDTO {
  manifest: {
    name: string
    /** Optional human-readable label.  Falls back to `name` when unset. */
    displayName?: string
    version: string
    namespace: string
    description?: string
    isBuiltin: boolean
    functions: Array<{
      name: string
      returnType: string
      parameters: Array<{ name: string; type: string; direction: 'input' | 'output' | 'inout' }>
      variadic?: { minArgs: number }
      documentation?: string
      category?: string
    }>
    functionBlocks: Array<{
      name: string
      inputs: Array<{ name: string; type: string }>
      outputs: Array<{ name: string; type: string }>
      inouts: Array<{ name: string; type: string }>
      documentation?: string
      category?: string
      /** Body language, when strucpp did NOT compile this block.
       *  Absent on ordinary ST/IL blocks (their C++ rides in the
       *  archive's chunks).  Present on a C/C++ or Python block:
       *  strucpp recovered the interface from the file's ST header,
       *  emitted no chunk, and carried the authored file verbatim in
       *  `sources`.  The consumer lowers that source itself at
       *  compile time, which is what keeps a published library
       *  working across native-bridge revisions. */
      implementation?: 'cpp' | 'python'
      /** Entry in `sources` holding this block's body.  Set with
       *  `implementation`; the file name need not match the block
       *  name, so it is carried explicitly rather than guessed. */
      sourceFile?: string
    }>
    types: Array<{
      name: string
      kind: 'struct' | 'enum' | 'alias'
      baseType?: string
      documentation?: string
      category?: string
    }>
  }
  globalConstants?: Record<string, number>
  /** Authored source files the archive ships.
   *
   *  ST entries are present unless the library was published
   *  closed-source (`--no-source`).  Native (C/C++, Python) entries
   *  are ALWAYS present: they have no compiled chunk, so the source
   *  is the deliverable and an archive without it is unbuildable.
   *  Located via a function block's `sourceFile`. */
  sources?: Array<{ fileName: string; source: string; category?: string }>
  /** Files the library ships for its blocks to compile against —
   *  headers they `#include`, `.cpp` units they need linked.  The
   *  consumer's program build materialises them into its own build
   *  tree, so a library and its sources cannot drift apart.  `path`
   *  is reproduced verbatim from the library's `resources/` tree.
   *  Absent on libraries that ship none. */
  resources?: Array<{
    path: string
    content: string
    /** `'base64'` when `content` carries bytes rather than text — see
     *  `LibraryResource`. Absent on a text file, so an archive of source-only
     *  libraries is unchanged. */
    encoding?: 'base64'
  }>
}

export interface LibraryPort {
  /**
   * Load every installed library (bundled + user-installed) as
   * parsed archives.  Returns the archives in a deterministic order
   * — bundled first, then user-installed alphabetical by `name` —
   * so the renderer's library tree renders stably across platforms.
   */
  loadAll(): Promise<StlibArchiveDTO[]>

  /**
   * Catalogue rows for the Library Manager's "System Libraries" tab.
   * Same set as `loadAll()` but with metadata (bundled flag, origin,
   * install timestamp) instead of full archive bodies.  Cheaper than
   * `loadAll()` for UI surfaces that don't need the POU lists.
   */
  listInstalled(): Promise<InstalledLibrary[]>

  /**
   * Open the platform's file picker and install whatever the user
   * selects.  Accepts `.stlib` archives (native strucpp format) and
   * `.lib`/`.library` files (CODESYS, run through strucpp's
   * importer to produce a `.stlib`).  Returns `{ canceled: true }`
   * when the user dismisses the picker.
   */
  installFromFile(): Promise<LibraryInstallResult>

  /**
   * Remove a user-installed library from the system pool.  Refuses
   * for bundled libraries — those are always-on; the caller should
   * disable them via project membership instead.
   */
  uninstall(name: string): Promise<Result>

  /**
   * Subscribe to system-pool change events fired after install /
   * uninstall succeeds (and from any future CDN flow).  Renderer
   * uses this to re-fetch `loadAll()` so the library tree picks up
   * additions/removals without a manual refresh.
   */
  onLibrariesChanged(callback: () => void): Unsubscribe

  /**
   * Page through the public library catalog hosted on autonomy-edge.
   * Optional — platforms that don't reach the catalog endpoint
   * (offline builds, unconfigured environments) leave it undefined
   * and the UI hides the "Add from catalog" entry point.
   */
  queryPublicCatalog?(args: ListPublicLibrariesArgs): Promise<CatalogQueryResult>

  /**
   * Install a batch of libraries selected from the public catalog.
   * Takes the full catalog rows (not just ids) because the platform
   * needs `authorHandle`/`displayName`/`description` — metadata the
   * downloaded `.stlib` archive's own manifest doesn't reliably carry.
   * The platform fetches each `.stlib` and routes it through the
   * same persistence path the file-picker install uses, returning a
   * per-item pass/fail summary so the UI can render a "5 succeeded,
   * 1 failed" toast.
   *
   * Optional alongside `queryPublicCatalog` — present iff that one is.
   */
  installFromCatalog?(libraries: PublicLibrary[]): Promise<CatalogInstallBatch>
}
