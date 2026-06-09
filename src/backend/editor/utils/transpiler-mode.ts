/**
 * Build-time toggle that selects between the new in-process JSON →
 * Structured Text transpiler and the legacy bundled `xml2st`
 * subprocess. Default is `false` (legacy xml2st) — flip with
 * `OPENPLC_USE_NEW_TRANSPILER=1` to opt into the JSON-fed transpiler.
 *
 * Lives in `backend/editor/utils/` so every editor-side transpilation
 * call site (`editor-compiler-platform-port.transpileToSt`,
 * `desktop-library-build-port.transpileToSt`,
 * `CompilerModule.compileForDebugger`) reads the same flag.
 *
 * Named without the `use` prefix on purpose: `react-hooks/rules-of-hooks`
 * treats any `use*` call inside a non-component / non-hook function as
 * a violation.
 */
export function isNewTranspilerEnabled(): boolean {
  const v = process.env.OPENPLC_USE_NEW_TRANSPILER
  return v === '1' || v === 'true'
}
