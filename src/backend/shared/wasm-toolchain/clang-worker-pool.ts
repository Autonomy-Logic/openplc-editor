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
    isTree(result.tree)
  ) {
    return {
      type: 'result',
      id: value.id,
      result: { exitCode: result.exitCode, stderr: result.stderr, tree: result.tree },
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
type Pending = { resolve: (result: WasmClangJobResult) => void; reject: (error: Error) => void; timer: Timer }

interface Slot {
  handle: ClangWorkerHandle
  /** Settles once the worker has loaded, or with the reason it never will. */
  ready: Promise<void>
  markReady: () => void
  markFailed: (error: Error) => void
  failed: boolean
  pending: Map<number, Pending>
  loadTimer: Timer | null
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`

/**
 * Runs clang jobs on a pool of workers, each with its own copy of the toolchain. It starts with one worker and
 * adds one, up to `maxWorkers`, whenever every worker already has a job. A worker that fails, takes too long to
 * load, or runs a job past its deadline is terminated and dropped, and its jobs fail.
 */
export class ClangWorkerPool implements WasmClangRunner {
  readonly concurrency: number
  private readonly loadDeadlineMs: number
  private readonly jobDeadlineMs: number
  private slots: Slot[] = []
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

  /** Gets the toolchain's files ready and starts the first worker; resolves once it has loaded. */
  prepare(): Promise<void> {
    this.prepared ??= this.start().catch((error: unknown) => {
      this.prepared = null
      void this.terminate()
      throw error
    })
    return this.prepared
  }

  async run(job: WasmClangJob): Promise<WasmClangJobResult> {
    await this.prepare()
    const slot = this.pickSlot()
    const id = this.nextId++
    // Counted as pending right away, so jobs issued together spread over the workers.
    const result = new Promise<WasmClangJobResult>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(slot, `a job ran longer than ${seconds(this.jobDeadlineMs)}`),
        this.jobDeadlineMs,
      )
      slot.pending.set(id, { resolve, reject, timer })
    })
    // A worker still loading posts the job once ready; if it fails instead, its failure rejects the job.
    void slot.ready.then(
      () => {
        if (slot.pending.has(id)) slot.handle.post({ id, argv: job.argv, tree: job.tree })
      },
      () => undefined,
    )
    return result
  }

  /** Stops every worker; pending jobs fail. */
  async terminate(): Promise<void> {
    const slots = this.slots
    this.slots = []
    this.prepared = null
    for (const slot of slots) this.settle(slot, new Error('The compiler was stopped.'))
    await Promise.all(slots.map((slot) => slot.handle.terminate()))
  }

  private async start(): Promise<void> {
    await this.mechanism.load()
    await this.spawn().ready
  }

  /** The least busy worker, or a new one when every worker is busy and the pool can still grow. */
  private pickSlot(): Slot {
    let idlest: Slot | null = null
    for (const slot of this.slots) if (idlest === null || slot.pending.size < idlest.pending.size) idlest = slot
    if (idlest === null || (idlest.pending.size > 0 && this.slots.length < this.concurrency)) return this.spawn()
    return idlest
  }

  private spawn(): Slot {
    const handle = this.mechanism.spawn()
    let markReady: () => void = () => undefined
    let markFailed: (error: Error) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      markFailed = reject
    })
    ready.catch(() => undefined)
    const slot: Slot = { handle, ready, markReady, markFailed, failed: false, pending: new Map(), loadTimer: null }
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
        slot.markReady()
        return
      }
      const job = slot.pending.get(reply.id)
      if (!job) return
      slot.pending.delete(reply.id)
      clearTimeout(job.timer)
      if (reply.type === 'result') job.resolve(reply.result)
      else job.reject(new Error(reply.message))
    })
    handle.onFailure((reason) => this.fail(slot, reason))
    return slot
  }

  /** Takes a worker out of the pool for good: it is terminated and every job it held fails. */
  private fail(slot: Slot, reason: string): void {
    if (slot.failed) return
    this.settle(slot, new Error(`The compiler worker stopped (${reason}).`))
    this.slots = this.slots.filter((s) => s !== slot)
    void Promise.resolve(slot.handle.terminate()).catch(() => undefined)
  }

  private settle(slot: Slot, error: Error): void {
    slot.failed = true
    if (slot.loadTimer) clearTimeout(slot.loadTimer)
    slot.loadTimer = null
    slot.markFailed(error)
    for (const job of slot.pending.values()) {
      clearTimeout(job.timer)
      job.reject(error)
    }
    slot.pending.clear()
  }
}
