/**
 * Shared hals.json loader.
 *
 * `hals.json` is the canonical board catalogue both editor and web
 * consume — the file lives next to this module (`./hals.json`) and
 * is byte-identical between repos (Shared Surface Sync gate
 * enforces it).  This loader is the single import surface so all
 * call sites get the same parsed object, and so swapping the
 * physical location (bundling rules, packaging quirks) only needs
 * a one-line change here.
 *
 * Returns the parsed object via a `Promise` for compatibility with
 * the legacy `readJSONFile` async callers that scattered across
 * `compiler-module.ts` / `hardware-module.ts` — those calls become
 * `await readHalsFile()` with no further restructure.  The promise
 * resolves synchronously off the bundled module — there is no
 * actual I/O.
 *
 * Module is intentionally named `hals-loader.ts` (not `hals.ts`):
 * editor's webpack `resolve.extensions` lists `.json` before `.ts`,
 * so an extensionless import of `'.../firmware/hals'` was resolving
 * to `hals.json` and `readHalsFile` ended up `undefined` at
 * runtime — empty board list, board-settings screen blank.  Keeping
 * the loader's basename distinct from the data file's basename
 * sidesteps that resolution clash for both webpack and Vite.
 */

import halsContent from './hals.json'

/**
 * Untyped raw content from `hals.json`.  Consumers cast to the
 * platform-specific `HalsFile` (editor: `backend/editor/hardware/
 * types.ts`; web: same shape under bundled types) — both platforms
 * point their schema at this same file, so the cast lands in the
 * same place.
 */
export type RawHalsContent = typeof halsContent

/**
 * Async-shaped helper for legacy call sites built around
 * `readJSONFile(halsFilePath)`.  Resolves synchronously off the
 * imported JSON; safe to call repeatedly.
 */
export function readHalsFile<T = RawHalsContent>(): Promise<T> {
  return Promise.resolve(halsContent as unknown as T)
}

/**
 * Synchronous accessor for new call sites that don't need to thread
 * a promise.  Use this when the caller is already synchronous
 * (e.g. test fixtures, pipeline-arg construction).
 */
export function getHalsFile<T = RawHalsContent>(): T {
  return halsContent as unknown as T
}
