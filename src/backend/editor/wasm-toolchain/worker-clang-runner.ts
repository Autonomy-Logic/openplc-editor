import { access } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import type {
  WasmClangJob,
  WasmClangJobResult,
  WasmClangRunner,
  WasmToolchainTree,
} from '@root/middleware/shared/ports/wasm-toolchain-mechanisms'

export interface WorkerClangRunnerPaths {
  /** The worker script (`resources/sources/wasm-toolchain/clang-worker.mjs`). */
  workerScript: string
  /** The root of the `@yowasp/clang` package, holding `gen/bundle.js` and its WebAssembly files. */
  toolchainDir: string
}

type Pending = { resolve: (result: WasmClangJobResult) => void; reject: (error: Error) => void }

interface Slot {
  worker: Worker
  ready: Promise<void>
  pending: Map<number, Pending>
}

type WorkerReply =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: WasmClangJobResult }
  | { type: 'error'; id: number; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isTree = (value: unknown): value is WasmToolchainTree => isRecord(value)

function parseReply(value: unknown): WorkerReply | null {
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

/** Default pool size: leave one core to the editor, and stop at four, where more workers stopped paying off. */
export const defaultClangWorkerCount = (): number => Math.max(1, Math.min(4, availableParallelism() - 1))

/** Runs clang in a pool of worker threads, each with its own copy of the toolchain loaded. */
export class WorkerClangRunner implements WasmClangRunner {
  private slots: Slot[] = []
  private prepared: Promise<void> | null = null
  private nextId = 1

  constructor(
    private readonly paths: WorkerClangRunnerPaths,
    readonly concurrency: number = defaultClangWorkerCount(),
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
    await slot.ready
    const id = this.nextId++
    return new Promise<WasmClangJobResult>((resolve, reject) => {
      slot.pending.set(id, { resolve, reject })
      slot.worker.postMessage({ id, argv: job.argv, tree: job.tree })
    })
  }

  /** Stops every worker; pending jobs fail. */
  async terminate(): Promise<void> {
    const slots = this.slots
    this.slots = []
    this.prepared = null
    await Promise.all(slots.map((slot) => slot.worker.terminate()))
  }

  private async start(): Promise<void> {
    await access(this.bundlePath)
    this.slots = Array.from({ length: this.concurrency }, () => this.spawn())
    await Promise.all(this.slots.map((slot) => slot.ready))
  }

  private get bundlePath(): string {
    return join(this.paths.toolchainDir, 'gen', 'bundle.js')
  }

  private spawn(): Slot {
    const worker = new Worker(this.paths.workerScript, {
      workerData: { bundleUrl: pathToFileURL(this.bundlePath).href },
    })
    // A pool of idle workers must not keep a command-line run alive.
    worker.unref()
    const pending = new Map<number, Pending>()
    let markReady: () => void = () => undefined
    let markFailed: (error: Error) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve
      markFailed = reject
    })
    ready.catch(() => undefined)
    const slot: Slot = { worker, ready, pending }

    const failAll = (error: Error): void => {
      markFailed(error)
      for (const job of pending.values()) job.reject(error)
      pending.clear()
    }
    worker.on('message', (raw: unknown) => {
      const reply = parseReply(raw)
      if (!reply) return
      if (reply.type === 'ready') {
        markReady()
        return
      }
      const job = pending.get(reply.id)
      if (!job) return
      pending.delete(reply.id)
      if (reply.type === 'result') job.resolve(reply.result)
      else job.reject(new Error(reply.message))
    })
    worker.on('error', (error) => failAll(error))
    worker.on('exit', (code) => {
      failAll(new Error(`The compiler worker stopped (exit code ${code}).`))
      this.replace(slot)
    })
    return slot
  }

  /** Swaps a worker that stopped for a fresh one, unless the pool was terminated. */
  private replace(slot: Slot): void {
    const index = this.slots.indexOf(slot)
    if (index < 0) return
    this.slots[index] = this.spawn()
  }
}
