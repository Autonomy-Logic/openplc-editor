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

/** A message the pool sends a clang worker: run one job. */
export interface ClangWorkerJobMessage {
  id: number
  argv: string[]
  tree: WasmToolchainTree
}

/** One clang worker, as a platform starts it: a thread, a Web Worker. */
export interface ClangWorkerHandle {
  post(message: ClangWorkerJobMessage): void
  /** Every message the worker sends, unchecked. */
  onMessage(listener: (raw: unknown) => void): void
  /** The worker failed or stopped; `reason` says how. */
  onFailure(listener: (reason: string) => void): void
  terminate(): Promise<unknown> | void
}

export interface ClangWorkerMechanism {
  /**
   * Gets the toolchain's files ready before any worker starts: checks they are there (desktop) or downloads them
   * (web). Rejects with the reason when it cannot.
   */
  load(): Promise<void>
  spawn(): ClangWorkerHandle
}
