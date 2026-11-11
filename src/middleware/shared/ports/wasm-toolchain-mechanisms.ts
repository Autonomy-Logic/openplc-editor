/**
 * Mechanisms behind the in-editor WebAssembly toolchain.
 *
 * All compile logic is shared (`backend/shared/wasm-toolchain/`). A platform supplies only the runner, which
 * makes no decisions: where clang runs (worker threads, Web Workers) and how the toolchain is loaded.
 */

/** A file tree as clang sees it: directories are nested objects, files are text or bytes. */
export type WasmToolchainTree = { [name: string]: string | Uint8Array | WasmToolchainTree }

/** One clang or clang++ invocation. */
export interface WasmClangJob {
  /** Full argv, starting with `clang` or `clang++`. */
  argv: string[]
  /** The working directory clang runs in. */
  tree: WasmToolchainTree
}

export interface WasmClangJobResult {
  /** 0 when clang succeeded. */
  exitCode: number
  /** Everything clang wrote to stderr. */
  stderr: string
  /** The working directory after the run, with the files clang wrote. Empty when it failed. */
  tree: WasmToolchainTree
}

export interface WasmClangRunner {
  /** How many jobs the runner executes at the same time. */
  readonly concurrency: number
  /** Loads the toolchain into memory. Resolves once jobs can run; rejects when the toolchain cannot load. */
  prepare(): Promise<void>
  /** Runs one job. Rejects only when the job could not be run at all, never for a compile error. */
  run(job: WasmClangJob): Promise<WasmClangJobResult>
}
