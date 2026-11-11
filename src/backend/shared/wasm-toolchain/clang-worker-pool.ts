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

type Pending = { resolve: (result: WasmClangJobResult) => void; reject: (error: Error) => void }

interface Slot {
  handle: ClangWorkerHandle
  ready: Promise<void>
  isReady: boolean
  pending: Map<number, Pending>
}

/** Cores assumed when the platform does not say how many it has. */
const UNKNOWN_CORES = 2

/** Pool size: leave one core to the editor, and stop at four, where more workers stopped paying off. */
export const clangWorkerCount = (cores: number | undefined): number =>
  Math.max(1, Math.min(4, (cores && cores > 0 ? cores : UNKNOWN_CORES) - 1))

/**
 * Runs clang jobs on a pool of workers, each with its own copy of the toolchain. A job goes to the worker with
 * the fewest pending jobs. A worker that stops after loading fails its jobs and is replaced.
 */
export class ClangWorkerPool implements WasmClangRunner {
  private slots: Slot[] = []
  private prepared: Promise<void> | null = null
  private nextId = 1

  constructor(
    private readonly mechanism: ClangWorkerMechanism,
    readonly concurrency: number,
  ) {}

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
    const slot = this.slots.reduce((a, b) => (b.pending.size < a.pending.size ? b : a))
    const id = this.nextId++
    // Counted as pending right away, so jobs issued together spread over the workers.
    const result = new Promise<WasmClangJobResult>((resolve, reject) => slot.pending.set(id, { resolve, reject }))
    // A replacement may still be loading; if it fails instead, its failure rejects the job.
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
    for (const slot of slots) {
      for (const job of slot.pending.values()) job.reject(new Error('The compiler was stopped.'))
      slot.pending.clear()
    }
    await Promise.all(slots.map((slot) => slot.handle.terminate()))
  }

  private async start(): Promise<void> {
    await this.mechanism.load()
    this.slots = Array.from({ length: this.concurrency }, () => this.spawn())
    await Promise.all(this.slots.map((slot) => slot.ready))
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
    const slot: Slot = { handle, ready, isReady: false, pending: new Map() }
    let failed = false

    handle.onMessage((raw) => {
      const reply = parseClangWorkerReply(raw)
      if (!reply) return
      if (reply.type === 'ready') {
        slot.isReady = true
        markReady()
        return
      }
      const job = slot.pending.get(reply.id)
      if (!job) return
      slot.pending.delete(reply.id)
      if (reply.type === 'result') job.resolve(reply.result)
      else job.reject(new Error(reply.message))
    })
    handle.onFailure((reason) => {
      if (failed) return
      failed = true
      const error = new Error(`The compiler worker stopped (${reason}).`)
      markFailed(error)
      for (const job of slot.pending.values()) job.reject(error)
      slot.pending.clear()
      // A worker that never loaded fails prepare instead; replacing it would only fail again.
      if (slot.isReady) this.replace(slot)
    })
    return slot
  }

  private replace(slot: Slot): void {
    const index = this.slots.indexOf(slot)
    if (index >= 0) this.slots[index] = this.spawn()
  }
}
