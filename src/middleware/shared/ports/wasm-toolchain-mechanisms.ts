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
  /** Everything clang wrote to stdout. */
  stdout: string
  /** The working directory after the run, with the files clang wrote. Empty when it failed. */
  tree: WasmToolchainTree
}

export interface WasmClangRunner {
  /** Jobs run one at a time: always 1. */
  readonly concurrency: number
  /**
   * Gets the toolchain's files ready through the mechanism; starts no worker. A success is kept; a failure is not, so
   * the next call tries again.
   */
  prepare(): Promise<void>
  /**
   * Runs one job on the one worker, starting it when none is alive, after a stopping worker has exited. Rejects only
   * when the job could not run, never for a compile error.
   */
  run(job: WasmClangJob): Promise<WasmClangJobResult>
  /**
   * Ends the worker when no job is running or queued; resolves once it has exited, at once when there is none. Ends
   * nothing while jobs remain.
   */
  release(): Promise<void>
}

/**
 * Durable storage of compiled objects across sessions: opaque records by key, stored and returned verbatim. What a
 * record holds and when it is still valid is decided by the shared toolchain.
 */
export interface WasmObjectStore {
  readAll(): Promise<Array<[key: string, record: Uint8Array]>>
  write(key: string, record: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
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
  /**
   * Whether the worker is running a job. A platform where an idle worker would keep the process alive (a Node
   * thread) lets it go while idle; others ignore it.
   */
  setBusy?(busy: boolean): void
  /** Ends the worker. A promise settles once it has exited; a `void` return means it exited when the call returned. */
  terminate(): Promise<unknown> | void
}

export interface ClangWorkerMechanism {
  /**
   * Gets the toolchain's files ready before any worker starts: checks every file is there (desktop) or stores them in
   * Cache Storage, downloading the missing ones (web). Rejects with the reason when it cannot, naming the first missing
   * file on the desktop.
   */
  load(): Promise<void>
  spawn(): ClangWorkerHandle
  /** Deletes the toolchain's stored files, so the next load downloads them again. */
  discard?(): Promise<void>
}
