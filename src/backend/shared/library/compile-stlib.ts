/**
 * Thin platform-agnostic wrapper around strucpp's `compileStlib`.
 *
 * Pure function call — no fs, no spawn.  Lives in `backend/shared`
 * so both Electron's compiler module and the web editor's backend
 * service can call into it without divergence.  Anywhere in the
 * editor that needs to produce a `.stlib` archive from ST sources
 * goes through this module; the strucpp signature shouldn't leak
 * past it.
 */

import { loadStrucpp } from './strucpp-runtime'

export interface CompileStlibSource {
  fileName: string
  source: string
  /** Optional category hint strucpp uses to group symbols
   *  (e.g. `'function'`, `'function-block'`, `'data-type'`).
   *  Matches the `category` field on the project-file specs the
   *  editor's save pipeline emits. */
  category?: string
}

export interface CompileStlibOptions {
  name: string
  version: string
  namespace: string
  /** Strip ST source from the archive — closed-source libraries. */
  noSource?: boolean
  /** Mark as a built-in runtime library (strucpp's bundled libs). */
  builtin?: boolean
  globalConstants?: Record<string, number>
}

export interface CompileStlibError {
  message: string
  line?: number
  file?: string
}

export interface CompileStlibResult {
  success: boolean
  /** Archive blob — opaque to this layer; the editor backend
   *  serialises it to the `.stlib` file via strucpp's archive
   *  writer.  Type is `unknown` here so the shared layer doesn't
   *  bind to strucpp's internal archive shape; the editor's
   *  serialiser narrows it where it needs to. */
  archive?: unknown
  errors?: CompileStlibError[]
}

/**
 * Compile a set of ST sources into a `.stlib` archive blob.  Caller
 * supplies the manifest options; this module passes them straight to
 * strucpp.  Returns `{success: false, errors}` on compilation errors
 * — no exceptions — so the caller can format diagnostics through the
 * editor's existing console pipeline.
 */
export function compileStlib(sources: CompileStlibSource[], options: CompileStlibOptions): CompileStlibResult {
  const strucpp = loadStrucpp()
  return strucpp.compileStlib(sources, options) as CompileStlibResult
}
