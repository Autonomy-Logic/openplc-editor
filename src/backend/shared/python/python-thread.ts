import type {
  PythonThreadChannel,
  PythonThreadHandle,
  PythonThreadMechanism,
} from '../../../middleware/shared/ports/python-mechanisms'
import type { PythonExit, PythonProcess } from './wasmer-python-runtime'

/** What starts interpreters: the loaded runtime, in the thread or (in tests) anywhere. */
export interface PythonInterpreters {
  spawn(): Promise<PythonProcess>
}

/** What the main side asks of the Python thread. */
export type PythonThreadRequest =
  | { type: 'spawn'; id: number }
  | { type: 'write'; id: number; text: string }
  | { type: 'kill'; id: number }

/** What the Python thread reports. */
export type PythonThreadReply =
  | { type: 'ready' }
  | { type: 'load-failed'; message: string }
  | { type: 'spawned'; id: number }
  | { type: 'spawn-failed'; id: number; message: string }
  | { type: 'stdout'; id: number; line: string }
  | { type: 'stderr'; id: number; line: string }
  | { type: 'exit'; id: number; exit: PythonExit }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

function parseExit(value: unknown): PythonExit | null {
  if (!isRecord(value)) return null
  if (value.kind === 'killed') return { kind: 'killed' }
  if (value.kind === 'exited' && typeof value.code === 'number') return { kind: 'exited', code: value.code }
  if (value.kind === 'failed' && typeof value.reason === 'string') return { kind: 'failed', reason: value.reason }
  return null
}

/** Checks a message that reached the Python thread; anything else is `null`. */
export function parsePythonThreadRequest(value: unknown): PythonThreadRequest | null {
  if (!isRecord(value) || !isId(value.id)) return null
  if (value.type === 'spawn' || value.type === 'kill') return { type: value.type, id: value.id }
  if (value.type === 'write' && typeof value.text === 'string') return { type: 'write', id: value.id, text: value.text }
  return null
}

/** Checks a message from the Python thread; anything else is `null`. */
export function parsePythonThreadReply(value: unknown): PythonThreadReply | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'ready':
      return { type: 'ready' }
    case 'load-failed':
      return typeof value.message === 'string' ? { type: 'load-failed', message: value.message } : null
    case 'spawned':
      return isId(value.id) ? { type: 'spawned', id: value.id } : null
    case 'spawn-failed':
      return isId(value.id) && typeof value.message === 'string'
        ? { type: 'spawn-failed', id: value.id, message: value.message }
        : null
    case 'stdout':
    case 'stderr':
      return isId(value.id) && typeof value.line === 'string'
        ? { type: value.type, id: value.id, line: value.line }
        : null
    case 'exit': {
      const exit = parseExit(value.exit)
      return isId(value.id) && exit ? { type: 'exit', id: value.id, exit } : null
    }
    default:
      return null
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The thread's side: loads the runtime once, reports `ready` or why it could not load, then starts and serves
 * interpreters by id.
 */
export function servePythonThread(channel: PythonThreadChannel, load: () => Promise<PythonInterpreters>): void {
  const reply = (message: PythonThreadReply): void => channel.post(message)
  const processes = new Map<number, PythonProcess>()
  const killed = new Set<number>()
  const loading = load()

  loading.then(
    () => reply({ type: 'ready' }),
    (error: unknown) => reply({ type: 'load-failed', message: describe(error) }),
  )

  const start = async (id: number): Promise<void> => {
    let process: PythonProcess
    try {
      process = await (await loading).spawn()
    } catch (error) {
      reply({ type: 'spawn-failed', id, message: describe(error) })
      return
    }
    if (killed.delete(id)) {
      process.kill()
      reply({ type: 'exit', id, exit: { kind: 'killed' } })
      return
    }
    processes.set(id, process)
    process.onStdout = (line) => reply({ type: 'stdout', id, line })
    process.onStderr = (line) => reply({ type: 'stderr', id, line })
    process.onExit = (exit) => {
      processes.delete(id)
      reply({ type: 'exit', id, exit })
    }
    reply({ type: 'spawned', id })
  }

  channel.onMessage((value) => {
    const request = parsePythonThreadRequest(value)
    if (request === null) return
    switch (request.type) {
      case 'spawn':
        void start(request.id)
        return
      case 'write':
        processes.get(request.id)?.write(request.text)
        return
      case 'kill': {
        const process = processes.get(request.id)
        if (process) process.kill()
        else killed.add(request.id)
        return
      }
    }
  })
}

class ThreadedPythonProcess implements PythonProcess {
  onStdout: ((line: string) => void) | null = null
  onStderr: ((line: string) => void) | null = null
  onExit: ((exit: PythonExit) => void) | null = null
  private ended = false

  constructor(
    private readonly id: number,
    private readonly thread: PythonThreadHandle,
  ) {}

  write(text: string): void {
    if (!this.ended) this.thread.post({ type: 'write', id: this.id, text } satisfies PythonThreadRequest)
  }

  kill(): void {
    if (!this.ended) this.thread.post({ type: 'kill', id: this.id } satisfies PythonThreadRequest)
  }

  /** The interpreter ended, or its thread did. */
  end(exit: PythonExit): void {
    if (this.ended) return
    this.ended = true
    this.onExit?.(exit)
  }
}

interface PendingSpawn {
  resolve: (process: ThreadedPythonProcess) => void
  reject: (error: Error) => void
}

/** How long the Python thread may take to load its runtime before the load fails. */
export const PYTHON_LOAD_DEADLINE_MS = 120000

/**
 * The main side: the Python thread, started once by `load()` and kept for the session. A thread that dies after
 * loading ends its interpreters, and the next `load()` starts a new one. A runtime that could not load stays failed
 * for the session, so later runs do not wait on it again: their Python blocks report the same reason.
 */
export class ThreadedPythonRuntime implements PythonInterpreters {
  private thread: PythonThreadHandle | null = null
  private loading: Promise<PythonThreadHandle> | null = null
  private loadFailure: Error | null = null
  private ids = 0
  private readonly spawning = new Map<number, PendingSpawn>()
  private readonly processes = new Map<number, ThreadedPythonProcess>()

  constructor(
    private readonly mechanism: PythonThreadMechanism,
    private readonly loadDeadlineMs = PYTHON_LOAD_DEADLINE_MS,
  ) {}

  /** Starts the thread and waits for its runtime; rejects with the reason it could not load. */
  load(): Promise<void> {
    if (this.loadFailure) return Promise.reject(this.loadFailure)
    this.loading ??= this.startThread().catch((error: unknown) => {
      this.loadFailure = error instanceof Error ? error : new Error(String(error))
      throw this.loadFailure
    })
    return this.loading.then(() => undefined)
  }

  async spawn(): Promise<PythonProcess> {
    await this.load()
    const thread = this.thread
    if (!thread) throw new Error('The Python runtime is not running.')
    const id = ++this.ids
    return new Promise<ThreadedPythonProcess>((resolve, reject) => {
      this.spawning.set(id, { resolve, reject })
      thread.post({ type: 'spawn', id } satisfies PythonThreadRequest)
    })
  }

  private async startThread(): Promise<PythonThreadHandle> {
    let thread: PythonThreadHandle
    try {
      thread = await this.mechanism.spawn()
    } catch (error) {
      this.loading = null
      throw error
    }
    return new Promise<PythonThreadHandle>((resolve, reject) => {
      let loaded = false
      const deadline = setTimeout(() => {
        if (loaded) return
        loaded = true
        const reason = `The Python runtime did not load within ${Math.round(this.loadDeadlineMs / 1000)} s.`
        this.lose(thread, reason)
        reject(new Error(reason))
      }, this.loadDeadlineMs)
      thread.onFailure((reason) => {
        clearTimeout(deadline)
        if (this.thread === thread || !loaded) this.lose(thread, `The Python thread stopped: ${reason}`)
        if (!loaded) reject(new Error(`The Python thread stopped: ${reason}`))
        loaded = true
      })
      thread.onMessage((value) => {
        const message = parsePythonThreadReply(value)
        if (message === null) return
        if (message.type === 'ready') {
          if (loaded) return
          clearTimeout(deadline)
          loaded = true
          this.thread = thread
          resolve(thread)
          return
        }
        if (message.type === 'load-failed') {
          if (loaded) return
          clearTimeout(deadline)
          loaded = true
          this.lose(thread, message.message)
          reject(new Error(message.message))
          return
        }
        this.deliver(thread, message)
      })
    })
  }

  private deliver(thread: PythonThreadHandle, message: PythonThreadReply): void {
    switch (message.type) {
      case 'spawned': {
        const pending = this.spawning.get(message.id)
        if (!pending) return
        this.spawning.delete(message.id)
        const process = new ThreadedPythonProcess(message.id, thread)
        this.processes.set(message.id, process)
        pending.resolve(process)
        return
      }
      case 'spawn-failed':
        this.spawning.get(message.id)?.reject(new Error(message.message))
        this.spawning.delete(message.id)
        return
      case 'stdout':
        this.processes.get(message.id)?.onStdout?.(message.line)
        return
      case 'stderr':
        this.processes.get(message.id)?.onStderr?.(message.line)
        return
      case 'exit':
        this.processes.get(message.id)?.end(message.exit)
        this.processes.delete(message.id)
        return
      default:
        return
    }
  }

  /** Ends a thread that died or never loaded, and what ran in it. */
  private lose(thread: PythonThreadHandle, reason: string): void {
    if (this.thread === thread) this.thread = null
    thread.terminate()
    this.loading = null
    for (const pending of this.spawning.values()) pending.reject(new Error(reason))
    this.spawning.clear()
    for (const process of this.processes.values()) process.end({ kind: 'failed', reason })
    this.processes.clear()
  }
}
