/**
 * LibraryPort — abstracts loading of bundled .stlib library archives.
 *
 * Editor adapter: reads .stlib files from `<resources>/strucpp/libs/` via
 *   the main process IPC bridge.
 * Web adapter (future): fetches the same files from a known URL.
 *
 * Each .stlib file is a JSON-serialized strucpp `StlibArchive` produced
 * by `npm run build` in the strucpp repo. The renderer never touches the
 * filesystem itself; the main process handles disk IO and returns the
 * parsed archive objects across IPC. The renderer then maps these into
 * the `SystemLibrary` shape the editor's library tree consumes — see
 * `src/frontend/utils/PLC/stlib-to-system-library.ts`.
 */

/**
 * Minimal subset of `strucpp.StlibArchive` the editor consumes. Carrying
 * a dedicated DTO here (rather than re-exporting strucpp's types) keeps
 * the editor's middleware layer free of a hard dependency on the strucpp
 * package surface — only the manifest fields the editor renders are
 * surfaced. New fields strucpp adds in the future are simply ignored
 * until something here opts in to them.
 */
export interface StlibArchiveDTO {
  manifest: {
    name: string
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
   * Load every bundled .stlib archive shipped with the app. Returns the
   * parsed archives in a deterministic order (filesystem order at the
   * adapter level — usually alphabetical on every platform we ship).
   *
   * Errors during load (missing dir, malformed JSON, etc.) propagate to
   * the caller so the app can surface them as a startup failure instead
   * of silently dropping libraries.
   */
  loadBundledLibraries(): Promise<StlibArchiveDTO[]>
}
