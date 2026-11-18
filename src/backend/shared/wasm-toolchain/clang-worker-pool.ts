import type {
  ClangWorkerHandle,
  ClangWorkerMechanism,
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

/** What a clang worker sends back: ready once loaded, then one result or error per job. */
export type ClangWorkerReply =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: WasmClangJobResult }
  | { type: 'error'; id: number; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isTree = (value: unknown): value is WasmToolchainTree => isRecord(value) && !ArrayBuffer.isView(value)

/** Checks a message from a clang worker; anything else is `null`. */
export function parseClangWorkerReply(value: unknown): ClangWorkerReply | null {
  if (!isRecord(value)) return null
  if (value.type === 'ready') return { type: 'ready' }
  if (typeof value.id !== 'number') return null
  if (value.type === 'error' && typeof value.message === 'string') {
    return { type: 'error', id: value.id, message: value.message }
  }
  const result = value.result
  if (
    value.type === 'result' &&
    isRecord(result) &&
    typeof result.exitCode === 'number' &&
    typeof result.stderr === 'string' &&
    typeof result.stdout === 'string' &&
    isTree(result.tree)
  ) {
    return {
      type: 'result',
      id: value.id,
      result: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout, tree: result.tree },
    }
  }
  return null
}

/** How long a worker may take to load the toolchain before it counts as failed. */
export const WORKER_LOAD_DEADLINE_MS = 120_000
/** How long one clang job may run before its worker counts as stuck. */
export const JOB_DEADLINE_MS = 120_000

/** The message a toolchain that could not be loaded is reported with. */
export const wasmToolchainLoadMessage = (reason: string): string =>
  `The WebAssembly compiler could not be loaded: ${reason}`

/**
 * The toolchain could not be loaded: its files are missing or broken, or its worker could not be started or never
 * became ready.
 */
export class WasmToolchainLoadError extends Error {
  constructor(readonly reason: string) {
    super(wasmToolchainLoadMessage(reason))
    this.name = 'WasmToolchainLoadError'
  }
}

export interface ClangWorkerPoolOptions {
  loadDeadlineMs?: number
  jobDeadlineMs?: number
}

type Timer = ReturnType<typeof setTimeout>

/** A job waiting for the worker. */
interface Queued {
  job: WasmClangJob
  resolve: (result: WasmClangJobResult) => void
  reject: (error: Error) => void
}

/** The job the worker is running, with the deadline that started when it was handed over. */
interface Running extends Queued {
  id: number
  timer: Timer
}

/** Why a worker failed: it reported an error, or it ran past a deadline. */
type FailureCause = 'error' | 'deadline'

/** Where the worker is in its life: loading the toolchain, waiting for a job, or running one. */
type WorkerState = { kind: 'loading'; loadTimer: Timer } | { kind: 'idle' } | { kind: 'busy'; running: Running }

interface LiveWorker {
  handle: ClangWorkerHandle
  state: WorkerState
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const ignore = (): void => undefined

/**
 * Runs clang jobs on one worker, one job at a time; jobs wait in a queue. The worker starts with the first job and
 * ends on `release()`. A worker counts from its spawn until its termination has settled, and a new one starts only
 * after the previous one exited. A worker that fails or runs a job past its deadline is terminated and its job fails;
 * one that cannot be started, or fails before it is ready, fails every job with `WasmToolchainLoadError` until the
 * next `release()`. A worker error before it is ready also discards the toolchain's stored files and clears the kept
 * `prepare()`, so the next load runs again.
 */
export class ClangWorkerPool implements WasmClangRunner {
  readonly concurrency = 1
  private readonly loadDeadlineMs: number
  private readonly jobDeadlineMs: number
  private worker: LiveWorker | null = null
  private stopping: Promise<void> | null = null
  private queue: Queued[] = []
  private prepared: Promise<void> | null = null
  private loadFailure: WasmToolchainLoadError | null = null
  private discarding: Promise<void> | null = null
  private nextId = 1

  constructor(
    private readonly mechanism: ClangWorkerMechanism,
    options: ClangWorkerPoolOptions = {},
  ) {
    this.loadDeadlineMs = options.loadDeadlineMs ?? WORKER_LOAD_DEADLINE_MS
    this.jobDeadlineMs = options.jobDeadlineMs ?? JOB_DEADLINE_MS
  }

  /** Gets the toolchain's files ready through the mechanism, starting no worker. A failure is not kept. */
  prepare(): Promise<void> {
    this.prepared ??= this.loadFiles().catch((error: unknown) => {
      this.prepared = null
      throw error
    })
    return this.prepared
  }

  /** Runs one job on the worker. A toolchain that cannot load rejects with `WasmToolchainLoadError`. */
  async run(job: WasmClangJob): Promise<WasmClangJobResult> {
    if (this.loadFailure) throw this.loadFailure
    try {
      await this.prepare()
    } catch (error) {
      throw new WasmToolchainLoadError(reasonOf(error))
    }
    return new Promise<WasmClangJobResult>((resolve, reject) => {
      this.queue.push({ job, resolve, reject })
      this.dispatch()
    })
  }

  /**
   * Ends the worker when no job is running or queued, and forgets a load failure; resolves once the worker has
   * exited. While jobs remain it ends nothing.
   */
  async release(): Promise<void> {
    const worker = this.worker
    if (this.queue.length > 0 || worker?.state.kind === 'busy') return
    this.loadFailure = null
    if (worker) {
      this.worker = null
      if (worker.state.kind === 'loading') clearTimeout(worker.state.loadTimer)
      this.stop(worker.handle)
    }
    await this.stopping
  }

  /** Waits for a discard of the stored files to settle, whatever its outcome, then gets the files ready. */
  private async loadFiles(): Promise<void> {
    const discarding = this.discarding
    if (discarding) {
      await discarding
      if (this.discarding === discarding) this.discarding = null
    }
    await this.mechanism.load()
  }

  /** Starts deleting the toolchain's stored files through the mechanism, when it can; a failure is ignored. */
  private discardFiles(): void {
    if (!this.mechanism.discard) return
    let discarded: Promise<void>
    try {
      discarded = this.mechanism.discard()
    } catch (error) {
      discarded = Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    this.discarding = discarded.then(ignore, ignore)
  }

  /**
   * Hands the next job to the idle worker, starting one when none is alive and none is stopping. After a load failure
   * the waiting jobs fail with it.
   */
  private dispatch(): void {
    if (this.queue.length === 0) return
    if (this.loadFailure) {
      const failure = this.loadFailure
      for (const waiting of this.queue.splice(0)) waiting.reject(failure)
      return
    }
    if (this.stopping) return
    const worker = this.worker ?? this.start()
    if (worker?.state.kind !== 'idle') return
    const next = this.queue.shift()
    if (next) this.hand(worker, next)
  }

  /**
   * Starts the worker. One that cannot be started is a load failure: the waiting jobs fail with
   * `WasmToolchainLoadError`, and so does every job until the next `release()`.
   */
  private start(): LiveWorker | null {
    try {
      return this.spawn()
    } catch (error) {
      const failure = new WasmToolchainLoadError(`the compiler worker could not be started (${reasonOf(error)})`)
      this.loadFailure = failure
      for (const waiting of this.queue.splice(0)) waiting.reject(failure)
      return null
    }
  }

  /** Gives a job to the idle worker. If the job cannot be posted, only that job fails and the worker stays. */
  private hand(worker: LiveWorker, queued: Queued): void {
    const id = this.nextId++
    const timer = setTimeout(
      () => this.fail(worker, `a job ran longer than ${seconds(this.jobDeadlineMs)}`, 'deadline'),
      this.jobDeadlineMs,
    )
    worker.state = { kind: 'busy', running: { ...queued, id, timer } }
    worker.handle.setBusy?.(true)
    try {
      worker.handle.post({ id, argv: queued.job.argv, tree: queued.job.tree })
    } catch (error) {
      clearTimeout(timer)
      worker.state = { kind: 'idle' }
      worker.handle.setBusy?.(false)
      queued.reject(error instanceof Error ? error : new Error(String(error)))
      this.dispatch()
    }
  }

  /** Starts a worker, marked idle so it does not keep the process alive until it is handed a job. */
  private spawn(): LiveWorker {
    const handle = this.mechanism.spawn()
    const loadTimer = setTimeout(
      () => this.fail(worker, `it did not load within ${seconds(this.loadDeadlineMs)}`, 'deadline'),
      this.loadDeadlineMs,
    )
    const worker: LiveWorker = { handle, state: { kind: 'loading', loadTimer } }
    this.worker = worker
    handle.onMessage((raw) => this.receive(worker, raw))
    handle.onFailure((reason) => this.fail(worker, reason, 'error'))
    handle.setBusy?.(false)
    return worker
  }

  /** Handles a reply of the current worker; replies of a worker no longer current are ignored. */
  private receive(worker: LiveWorker, raw: unknown): void {
    if (worker !== this.worker) return
    const reply = parseClangWorkerReply(raw)
    if (!reply) return
    if (reply.type === 'ready') {
      if (worker.state.kind !== 'loading') return
      clearTimeout(worker.state.loadTimer)
      worker.state = { kind: 'idle' }
      this.dispatch()
      return
    }
    if (worker.state.kind !== 'busy' || worker.state.running.id !== reply.id) return
    const running = worker.state.running
    clearTimeout(running.timer)
    worker.state = { kind: 'idle' }
    worker.handle.setBusy?.(false)
    if (reply.type === 'result') running.resolve(reply.result)
    else running.reject(new Error(reply.message))
    this.dispatch()
  }

  /**
   * Terminates the current worker after a failure. The job it ran fails with the reason; when it never became ready,
   * the toolchain counts as not loadable until the next `release()`, and after an error its stored files are discarded
   * and the kept `prepare()` is cleared.
   */
  private fail(worker: LiveWorker, reason: string, cause: FailureCause): void {
    if (worker !== this.worker) return
    this.worker = null
    const state = worker.state
    switch (state.kind) {
      case 'loading':
        clearTimeout(state.loadTimer)
        this.loadFailure = new WasmToolchainLoadError(reason)
        if (cause === 'error') {
          this.prepared = null
          this.discardFiles()
        }
        break
      case 'busy':
        clearTimeout(state.running.timer)
        state.running.reject(new Error(`The compiler worker stopped (${reason}).`))
        break
      case 'idle':
        break
      default: {
        const unreachable: never = state
        return unreachable
      }
    }
    this.stop(worker.handle)
    this.dispatch()
  }

  /** Terminates a worker; it counts as stopping until its termination has settled, then waiting jobs go on. */
  private stop(handle: ClangWorkerHandle): void {
    let exit: Promise<unknown>
    try {
      exit = Promise.resolve(handle.terminate())
    } catch {
      exit = Promise.resolve()
    }
    const stopping: Promise<void> = exit.then(ignore, ignore).then(() => {
      if (this.stopping === stopping) this.stopping = null
      this.dispatch()
    })
    this.stopping = stopping
  }
}
