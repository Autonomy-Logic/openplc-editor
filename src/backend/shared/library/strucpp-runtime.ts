/**
 * Strucpp runtime loader — single source of truth for the typed
 * surface of the strucpp package as the editor consumes it.
 *
 * This module lives in `backend/shared/` and therefore must be
 * byte-identical between openplc-editor and openplc-web.  It only
 * imports the pure (`strucpp`) entry — never `strucpp/node` — so
 * the same code compiles for the Electron main process AND for
 * the web backend's browser-bundled service.  Anything that needs
 * filesystem paths is Node-only and lives in `backend/editor/`,
 * where the caller reads bytes/text from disk and hands them in.
 *
 * Why the lazy `require` rather than a top-level `import`:
 *
 *   Strucpp uses ESM features (`import.meta`, top-level await in
 *   some helpers) that don't survive Jest's CJS transform.  Eager
 *   imports here would break every test suite that transitively
 *   touches this module, regardless of whether the test actually
 *   exercises strucpp.  Deferring with `require` keeps the module
 *   load tree clean for tests; the real consumer paths pay the
 *   require cost once on first call.  Webpack handles the same
 *   `require('strucpp')` as a static dependency at bundle time.
 *
 *   Vite caveat: `require()` in source isn't covered by Vite's
 *   commonjs interop in the browser bundle and silently returns
 *   `undefined`, so web's compile path can't go through this
 *   loader for the bundled-archive parse step.  Web's
 *   `middleware/adapters/web/services/bundled-stlibs.ts` imports
 *   `loadStlibFromString` from `strucpp` directly via static ESM —
 *   that file is web-platform-only so editor's Jest never resolves
 *   it.  The shared `parseStlibArchive` helper here remains for the
 *   editor's main-process callers (which Webpack handles).
 */

/**
 * Typed surface of strucpp's pure entry as the editor consumes it.
 *
 *   - `compile` / `formatDiagnostic` / `buildSourceMap` /
 *     `getVersion` — the compiler pipeline.
 *   - `compileStlib` — the library build pipeline.
 *   - `importCodesysLibraryFromBytes` — CODESYS V2.3 / V3 import
 *     (bytes-in; the caller reads the file or upload).
 *   - `loadStlibFromString` — `.stlib` archive parser (text-in;
 *     the caller reads the file or fetches the URL).
 *
 * Every entry pulls its signature through `typeof import('strucpp')[k]`
 * so adding a parameter on the strucpp side surfaces as a compile
 * error here, not as a silent runtime drift.
 */
export interface StrucppRuntime {
  compile: (typeof import('strucpp'))['compile']
  formatDiagnostic: (typeof import('strucpp'))['formatDiagnostic']
  buildSourceMap: (typeof import('strucpp'))['buildSourceMap']
  getVersion: (typeof import('strucpp'))['getVersion']
  compileStlib: (typeof import('strucpp'))['compileStlib']
  importCodesysLibraryFromBytes: (typeof import('strucpp'))['importCodesysLibraryFromBytes']
  loadStlibFromString: (typeof import('strucpp'))['loadStlibFromString']
}

let cached: StrucppRuntime | null = null

/**
 * Load (or return cached) strucpp runtime.  Use this in any place
 * that needs strucpp — instead of `require('strucpp')` directly —
 * so the lazy-require pattern, the cache, and the typed surface
 * stay in one place.
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
