/**
 * Strucpp runtime loader — single source of truth for the typed
 * surface of the `strucpp` npm package as the editor consumes it.
 *
 * Why the lazy `require`:
 *
 *   - Strucpp uses ESM features (`import.meta`, top-level `await` in
 *     some helpers) that don't survive Jest's CJS transform.  Eager
 *     ESM imports here would break every test suite that touches a
 *     module that touches this one, regardless of whether the test
 *     actually calls into strucpp.  Deferring with `require` keeps the
 *     module load tree clean for tests; the real consumer paths pay
 *     the require cost once on first call.
 *
 *   - The typed surface (`StrucppRuntime`) is the small slice of
 *     strucpp's public API we actually use — keeps the editor honest
 *     about what it depends on, and surfaces breakage at the boundary
 *     when a strucpp upgrade changes a signature instead of deep
 *     inside a transitive caller.
 */

/**
 * Manifest validation result returned from `loadLibraryManifest`.
 * Mirrors strucpp's `LibraryManifest` shape narrowly enough for the
 * build pipeline to refuse bad input cleanly; full type lives in
 * strucpp itself and isn't re-declared here to avoid drift.
 */
export type StrucppManifestLike = {
  name: string
  version: string
  namespace: string
  displayName?: string
  description?: string
}

/**
 * Typed surface of the `strucpp` package as the editor consumes it.
 *
 * Union of the four call-sites that touch strucpp:
 *
 *   - `compile` / `formatDiagnostic` / `buildSourceMap` / `getVersion`
 *     — the compiler module's ST→C++ pipeline.
 *   - `compileStlib` — the library build pipeline.
 *   - `importCodesysLibrary` — the library manager's CODESYS import.
 *   - `loadStlibFromFile` — the library manager's archive parse path.
 */
export interface StrucppRuntime {
  /** Compile ST source → C++ via strucpp's main pipeline.  Used by
   *  the program compile + the C++ library verification step. */
  compile: typeof import('strucpp')['compile']
  /** Format a strucpp diagnostic as gcc-style stderr — fed into the
   *  editor's console click-to-open pipeline. */
  formatDiagnostic: typeof import('strucpp')['formatDiagnostic']
  /** Build a source map for the compiled output — used by
   *  `formatErrorWithPouContext` to render body-relative line numbers. */
  buildSourceMap: typeof import('strucpp')['buildSourceMap']
  /** Strucpp's version string — surfaces in the compile log and
   *  participates in the verification cache key. */
  getVersion: typeof import('strucpp')['getVersion']
  /** CODESYS V2.3 / V3 library importer.  Used by the library
   *  manager's install-from-codesys flow. */
  importCodesysLibrary: (path: string) => {
    success: boolean
    sources?: { fileName: string; source: string; category?: string }[]
    globalConstants?: Record<string, number>
    errors?: string[]
  }
  /** Compile ST sources into a `.stlib` archive.  This is the
   *  end-point the library build pipeline funnels through after
   *  splitting program.st per-POU. */
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
  /** Parse a `.stlib` archive from a file path on disk. */
  loadStlibFromFile: (path: string) => unknown
}

let cached: StrucppRuntime | null = null

/**
 * Load (or return cached) strucpp runtime.  Use this in any place
 * that needs strucpp — editor compiler module, library manager,
 * library build pipeline — instead of `require('strucpp')` directly.
 * One cache per process, so the require cost is paid once.
 */
export function loadStrucpp(): StrucppRuntime {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('strucpp') as StrucppRuntime
  return cached
}

/**
 * Test-only escape hatch.  Lets a Jest test inject a fake strucpp
 * runtime without monkey-patching `require`.  Production code never
 * calls this.
 */
export function __setStrucppRuntimeForTests(stub: StrucppRuntime | null): void {
  cached = stub
}
