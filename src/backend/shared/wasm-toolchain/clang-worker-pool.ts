import type {
  ClangWorkerHandle,
  ClangWorkerMechanism,
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

import { clangWorkerLimit } from './worker-limit'

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

/** How long a worker limit read from the platform's free memory is reused before it is read again. */
const LIMIT_TTL_MS = 1000

/**
 * Runs clang jobs on one worker, one job at a time each; jobs wait in a queue. A worker starts with the first job and
 * workers end on `release()`. While held (`setHeld`), the pool grows to more workers, each started when every worker
 * is busy and jobs wait, as many as `clangWorkerLimit` allows from the platform's free memory at that moment, one
 * loading at a time. A worker counts from its spawn until its termination has settled, and no worker starts while one
 * is stopping. A worker that fails or runs a job past its deadline is terminated and its job fails. When the only
 * worker cannot be started, or fails before it is ready, every job fails with `WasmToolchainLoadError` until the next
 * `release()`, and after an error the toolchain's stored files are discarded and the kept `prepare()` is cleared; a
 * further worker that fails that way only stops the pool growing until the next `release()`.
 */
export class ClangWorkerPool implements WasmClangRunner {
  private readonly loadDeadlineMs: number
  private readonly jobDeadlineMs: number
  private workers: LiveWorker[] = []
  private stops = new Set<Promise<void>>()
  private queue: Queued[] = []
  private prepared: Promise<void> | null = null
  private loadFailure: WasmToolchainLoadError | null = null
  private discarding: Promise<void> | null = null
  private nextId = 1
  private held = false
  private growthFailed = false
  private limitCache: { at: number; value: number } | null = null

  constructor(
    private readonly mechanism: ClangWorkerMechanism,
    options: ClangWorkerPoolOptions = {},
  ) {
    this.loadDeadlineMs = options.loadDeadlineMs ?? WORKER_LOAD_DEADLINE_MS
    this.jobDeadlineMs = options.jobDeadlineMs ?? JOB_DEADLINE_MS
  }

  /** Jobs that may run at once: the worker limit while held, else 1. */
  get concurrency(): number {
    return this.limit()
  }

  /** Allows more than one worker while held; dropping the hold stops the growth but ends no worker. */
  setHeld(held: boolean): void {
    this.held = held
    this.limitCache = null
    if (held) this.dispatch()
  }

  /** Gets the toolchain's files ready through the mechanism, starting no worker. A failure is not kept. */
  prepare(): Promise<void> {
    this.prepared ??= this.loadFiles().catch((error: unknown) => {
      this.prepared = null
      throw error
    })
    return this.prepared
  }

  /** Runs one job on a worker. A toolchain that cannot load rejects with `WasmToolchainLoadError`. */
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
   * Ends every worker when no job is running or queued, and forgets a load failure; resolves once they have exited.
   * While jobs remain it ends nothing.
   */
  async release(): Promise<void> {
    if (this.queue.length > 0 || this.workers.some((w) => w.state.kind === 'busy')) return
    this.loadFailure = null
    this.growthFailed = false
    for (const worker of this.workers.splice(0)) {
      if (worker.state.kind === 'loading') clearTimeout(worker.state.loadTimer)
      this.stop(worker.handle)
    }
    await Promise.all([...this.stops])
  }

  /** Workers allowed now: 1 unless held, else the limit from the platform's free memory, read at most once a second. */
  private limit(): number {
    if (!this.held || this.growthFailed) return 1
    const now = Date.now()
    if (!this.limitCache || now - this.limitCache.at > LIMIT_TTL_MS) {
      this.limitCache = {
        at: now,
        value: clangWorkerLimit(this.mechanism.availableMemoryBytes?.(), this.mechanism.cores?.()),
      }
    }
    return this.limitCache.value
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
   * Hands waiting jobs to idle workers, then starts a worker when jobs still wait, none is loading or stopping, and the
   * limit allows another. After a load failure the waiting jobs fail with it.
   */
  private dispatch(): void {
    if (this.queue.length === 0) return
    if (this.loadFailure) {
      const failure = this.loadFailure
      for (const waiting of this.queue.splice(0)) waiting.reject(failure)
      return
    }
    for (const worker of this.workers) {
      if (worker.state.kind !== 'idle') continue
      const next = this.queue.shift()
      if (!next) return
      this.hand(worker, next)
    }
    if (this.queue.length === 0 || this.stops.size > 0) return
    if (this.workers.some((w) => w.state.kind === 'loading')) return
    if (this.workers.length === 0 || this.workers.length < this.limit()) this.start()
  }

  /**
   * Starts a worker. When the pool has none, one that cannot be started is a load failure: the waiting jobs fail with
   * `WasmToolchainLoadError`, and so does every job until the next `release()`. A further worker that cannot be
   * started only stops the pool growing.
   */
  private start(): void {
    try {
      this.spawn()
    } catch (error) {
      if (this.workers.length > 0) {
        this.growthFailed = true
        return
      }
      const failure = new WasmToolchainLoadError(`the compiler worker could not be started (${reasonOf(error)})`)
      this.loadFailure = failure
      for (const waiting of this.queue.splice(0)) waiting.reject(failure)
    }
  }

  /** Gives a job to an idle worker. If the job cannot be posted, only that job fails and the worker stays. */
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
    this.workers.push(worker)
    handle.onMessage((raw) => this.receive(worker, raw))
    handle.onFailure((reason) => this.fail(worker, reason, 'error'))
    handle.setBusy?.(false)
    return worker
  }

  /** Handles a reply of a current worker; replies of a worker no longer in the pool are ignored. */
  private receive(worker: LiveWorker, raw: unknown): void {
    if (!this.workers.includes(worker)) return
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
   * Terminates a worker after a failure. The job it ran fails with the reason. When it never became ready and no other
   * worker is alive, the toolchain counts as not loadable until the next `release()`, and after an error its stored
   * files are discarded and the kept `prepare()` is cleared; with other workers alive the pool only stops growing.
   */
  private fail(worker: LiveWorker, reason: string, cause: FailureCause): void {
    const index = this.workers.indexOf(worker)
    if (index < 0) return
    this.workers.splice(index, 1)
    const state = worker.state
    switch (state.kind) {
      case 'loading':
        clearTimeout(state.loadTimer)
        if (this.workers.length > 0) {
          this.growthFailed = true
          break
        }
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
      this.stops.delete(stopping)
      this.dispatch()
    })
    this.stops.add(stopping)
  }
}
