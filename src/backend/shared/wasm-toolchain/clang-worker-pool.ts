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

/** Cores assumed when the platform does not say how many it has. */
const UNKNOWN_CORES = 2

/** Most workers: leave one core to the editor, and stop at four, where more workers stopped paying off. */
export const clangWorkerCount = (cores: number | undefined): number =>
  Math.max(1, Math.min(4, (cores && cores > 0 ? cores : UNKNOWN_CORES) - 1))

/** How long a worker may take to load the toolchain before it counts as failed. */
export const WORKER_LOAD_DEADLINE_MS = 120_000
/** How long one clang job may run before its worker counts as stuck. */
export const JOB_DEADLINE_MS = 120_000

export interface ClangWorkerPoolOptions {
  /** Most workers the pool grows to. */
  maxWorkers: number
  loadDeadlineMs?: number
  jobDeadlineMs?: number
}

type Timer = ReturnType<typeof setTimeout>

/** A job waiting for a worker. */
interface Queued {
  job: WasmClangJob
  resolve: (result: WasmClangJobResult) => void
  reject: (error: Error) => void
}

/** The job a worker is running, with the deadline that started when it was handed over. */
interface Running extends Queued {
  id: number
  timer: Timer
}

interface Slot {
  handle: ClangWorkerHandle
  /** Settles once the worker has loaded, or with the reason it never will. */
  ready: Promise<void>
  markReady: () => void
  markFailed: (error: Error) => void
  loaded: boolean
  failed: boolean
  running: Running | null
  loadTimer: Timer | null
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`

/**
 * Runs clang jobs on a pool of workers, each with its own copy of the toolchain, one job per worker at a time.
 * Jobs wait in the pool's queue for a free worker. It starts with one worker and adds one, up to `maxWorkers`,
 * while jobs are waiting. A worker that fails, takes too long to load, or runs a job past its deadline is
 * terminated and dropped, and its job fails. A job's deadline starts when a worker takes it.
 */
export class ClangWorkerPool implements WasmClangRunner {
  readonly concurrency: number
  private readonly loadDeadlineMs: number
  private readonly jobDeadlineMs: number
  private slots: Slot[] = []
  private queue: Queued[] = []
  private prepared: Promise<void> | null = null
  private nextId = 1

  constructor(
    private readonly mechanism: ClangWorkerMechanism,
    options: ClangWorkerPoolOptions,
  ) {
    this.concurrency = Math.max(1, options.maxWorkers)
    this.loadDeadlineMs = options.loadDeadlineMs ?? WORKER_LOAD_DEADLINE_MS
    this.jobDeadlineMs = options.jobDeadlineMs ?? JOB_DEADLINE_MS
  }

  /**
   * Gets the toolchain's files ready and starts the first worker; resolves once it has loaded. On failure it stops
   * every worker and rejects with the reason loading failed, also when stopping them fails too.
   */
  prepare(): Promise<void> {
    this.prepared ??= this.start().catch(async (error: unknown) => {
      this.prepared = null
      await this.terminate().catch(() => undefined)
      throw error
    })
    return this.prepared
  }

  async run(job: WasmClangJob): Promise<WasmClangJobResult> {
    await this.prepare()
    return new Promise<WasmClangJobResult>((resolve, reject) => {
      this.queue.push({ job, resolve, reject })
      this.dispatch()
    })
  }

  /** Stops every worker; running and waiting jobs fail. */
  async terminate(): Promise<void> {
    const slots = this.slots
    this.slots = []
    this.prepared = null
    const stopped = new Error('The compiler was stopped.')
    for (const slot of slots) this.settle(slot, stopped)
    for (const waiting of this.queue.splice(0)) waiting.reject(stopped)
    await Promise.all(slots.map((slot) => slot.handle.terminate()))
  }

  private async start(): Promise<void> {
    await this.mechanism.load()
    await this.spawn().ready
  }

  /**
   * Hands waiting jobs to free workers, and starts more workers while jobs still wait. When a worker cannot be
   * started and no worker is left in the pool, the waiting jobs fail.
   */
  private dispatch(): void {
    for (const slot of this.slots) {
      if (this.queue.length === 0) return
      if (slot.loaded && !slot.failed && slot.running === null) {
        const next = this.queue.shift()
        if (next) this.hand(slot, next)
      }
    }
    const loading = this.slots.filter((s) => !s.loaded && !s.failed).length
    let missing = Math.min(this.queue.length - loading, this.concurrency - this.slots.length)
    for (; missing > 0; missing--) {
      try {
        this.spawn()
      } catch (error) {
        if (this.slots.length === 0) {
          const reason = error instanceof Error ? error.message : String(error)
          const failure = new Error(`The compiler worker could not be started (${reason}).`)
          for (const waiting of this.queue.splice(0)) waiting.reject(failure)
        }
        return
      }
    }
  }

  /** Gives a job to an idle worker. If the job cannot be posted, only that job fails and the worker stays. */
  private hand(slot: Slot, queued: Queued): void {
    const id = this.nextId++
    const timer = setTimeout(
      () => this.fail(slot, `a job ran longer than ${seconds(this.jobDeadlineMs)}`),
      this.jobDeadlineMs,
    )
    slot.running = { ...queued, id, timer }
    slot.handle.setBusy?.(true)
    try {
      slot.handle.post({ id, argv: queued.job.argv, tree: queued.job.tree })
    } catch (error) {
      clearTimeout(timer)
      slot.running = null
      slot.handle.setBusy?.(false)
      queued.reject(error instanceof Error ? error : new Error(String(error)))
      this.dispatch()
    }
  }

  /** Starts a worker, marked idle so it does not keep the process alive until it is handed a job. */
  private spawn(): Slot {
    const handle = this.mechanism.spawn()
    let markReady: () => void = () => undefined
    let markFailed: (error: Error) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      markFailed = reject
    })
    ready.catch(() => undefined)
    const slot: Slot = {
      handle,
      ready,
      markReady,
      markFailed,
      loaded: false,
      failed: false,
      running: null,
      loadTimer: null,
    }
    this.slots.push(slot)
    slot.loadTimer = setTimeout(
      () => this.fail(slot, `it did not load within ${seconds(this.loadDeadlineMs)}`),
      this.loadDeadlineMs,
    )

    handle.onMessage((raw) => {
      const reply = parseClangWorkerReply(raw)
      if (!reply || slot.failed) return
      if (reply.type === 'ready') {
        if (slot.loadTimer) clearTimeout(slot.loadTimer)
        slot.loadTimer = null
        slot.loaded = true
        slot.markReady()
        this.dispatch()
        return
      }
      const running = slot.running
      if (!running || running.id !== reply.id) return
      clearTimeout(running.timer)
      slot.running = null
      slot.handle.setBusy?.(false)
      if (reply.type === 'result') running.resolve(reply.result)
      else running.reject(new Error(reply.message))
      this.dispatch()
    })
    handle.onFailure((reason) => this.fail(slot, reason))
    handle.setBusy?.(false)
    return slot
  }

  /**
   * Takes a worker out of the pool for good: it is terminated and the job it held fails. When it never loaded and no
   * loaded worker is left, the waiting jobs fail as well instead of starting workers that would fail the same way.
   */
  private fail(slot: Slot, reason: string): void {
    if (slot.failed) return
    const error = new Error(`The compiler worker stopped (${reason}).`)
    const wasLoaded = slot.loaded
    this.settle(slot, error)
    this.slots = this.slots.filter((s) => s !== slot)
    void Promise.resolve(slot.handle.terminate()).catch(() => undefined)
    if (!wasLoaded && !this.slots.some((s) => s.loaded)) {
      for (const waiting of this.queue.splice(0)) waiting.reject(error)
      return
    }
    this.dispatch()
  }

  private settle(slot: Slot, error: Error): void {
    slot.failed = true
    if (slot.loadTimer) clearTimeout(slot.loadTimer)
    slot.loadTimer = null
    slot.markFailed(error)
    if (slot.running) {
      clearTimeout(slot.running.timer)
      slot.running.reject(error)
      slot.running = null
    }
  }
}
