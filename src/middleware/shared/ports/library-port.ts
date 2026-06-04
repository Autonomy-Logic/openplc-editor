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
import type { ListPublicLibrariesArgs, ListPublicLibrariesResponse } from './public-catalog-types'
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
  /** C/C++ function blocks the library ships, carried verbatim
   *  through the archive.  Strucpp doesn't compile these — the
   *  consumer's program build grafts them into the project's own
   *  C++-POU pipeline (with a `<library_name>__<name>` rename for
   *  collision avoidance) and routes them through the existing
   *  `c_blocks.h` / `c_blocks_code.cpp` generation.  Absent on
   *  libraries that don't ship any. */
  cppBlocks?: Array<{
    name: string
    code: string
    /** Opaque on this side — the editor maps to/from `PLCVariable`
     *  on the renderer when grafting back into the project. */
    variables: unknown[]
    documentation?: string
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
   * The platform fetches each `.stlib` and routes it through the
   * same persistence path the file-picker install uses, returning a
   * per-item pass/fail summary so the UI can render a "5 succeeded,
   * 1 failed" toast.
   *
   * Optional alongside `queryPublicCatalog` — present iff that one is.
   */
  installFromCatalog?(publishedLibraryIds: string[]): Promise<CatalogInstallBatch>
}
