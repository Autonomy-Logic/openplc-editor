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
import type { Result, Unsubscribe } from './types'

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
}
