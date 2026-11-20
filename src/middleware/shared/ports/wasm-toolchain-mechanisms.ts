import type { WasmLibraryObjectKind } from './wasm-toolchain-types'

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
  /** Jobs that may run at once: 1, or more while held and the memory allows (`setHeld`). */
  readonly concurrency: number
  /**
   * Gets the toolchain's files ready through the mechanism; starts no worker. A success is kept; a failure is not, so
   * the next call tries again.
   */
  prepare(): Promise<void>
  /**
   * Runs one job on a worker, starting one when none is idle and the limit allows, after a stopping worker has exited.
   * Rejects only when the job could not run, never for a compile error.
   */
  run(job: WasmClangJob): Promise<WasmClangJobResult>
  /**
   * While held, jobs may run on more than one worker, as many as the platform's free memory allows; otherwise on one.
   * Releasing the hold ends nothing by itself.
   */
  setHeld?(held: boolean): void
  /**
   * Forgets a load failure when no job is running or queued, so the next job tries to start a worker again; ends no
   * worker. A held toolchain calls it where an unheld one would release.
   */
  retry?(): void
  /**
   * Ends the workers when no job is running or queued; resolves once they have exited, at once when there are none.
   * Ends nothing while jobs remain.
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

/**
 * Compiled objects shipped with the application, read only from the application's own files (the installed resources
 * on the desktop, the app's own origin on the web), never from a project or a folder users write. Each file is
 * returned verbatim; what it holds and whether it may be used is decided by the shared toolchain.
 */
export interface WasmShippedObjectSource {
  /** The bytes of one shipped file by its name, or null when there is no such file. */
  read(name: string): Promise<Uint8Array | null>
}

/**
 * The place next to each library archive where its compiled objects are kept, one file per library and kind of build.
 * Each file is stored and returned verbatim; what it holds and whether it may be used is decided by the shared
 * toolchain. A platform with no writable place for a library keeps nothing for it.
 */
export interface WasmLibraryObjectStore {
  /** The file of `library` for `kind`, or null when there is none. */
  read(library: string, kind: WasmLibraryObjectKind): Promise<Uint8Array | null>
  /** Replaces the file of `library` for `kind`; does nothing for a library the platform keeps no files next to. */
  write(library: string, kind: WasmLibraryObjectKind, bytes: Uint8Array): Promise<void>
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
  /** Memory the platform can hand out now, in bytes, read from the OS; undefined when it cannot tell. */
  availableMemoryBytes?(): number | undefined
  /** Processors of the machine; undefined when unknown. */
  cores?(): number | undefined
}
