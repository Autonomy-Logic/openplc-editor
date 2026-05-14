/**
 * Thin wrapper around strucpp's `.stlib` archive parser.
 *
 * Same shape as the other strucpp wrappers in this folder: keeps
 * the platform-coupled surface (file path) at the strucpp boundary,
 * exposes an editor-friendly signature, and lives in
 * `backend/shared/` so both Electron's library manager and the web
 * editor's backend can call it.
 *
 * NOTE: strucpp's loader currently takes a path on disk.  Same
 * upgrade path as `importCodesysLibrary` — when strucpp grows a
 * bytes-in variant, this shim will swap and editor callers won't
 * notice.
 */

import { loadStrucpp } from './strucpp-runtime'

export function loadStlibFromFile(path: string): unknown {
  const strucpp = loadStrucpp()
  return strucpp.loadStlibFromFile(path)
}
