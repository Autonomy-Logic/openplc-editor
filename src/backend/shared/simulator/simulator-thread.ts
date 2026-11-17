import type {
  SimulatorThreadChannel,
  SimulatorThreadHandle,
  SimulatorThreadMechanism,
} from '../../../middleware/shared/ports/simulator-mechanisms'
import {
  type SimulatorLogStream,
  type SimulatorPythonBlock,
  type SimulatorPythonBus,
  type UartSimulator,
  WasmSimulatorModule,
} from './wasm-simulator-module'

/** What the main side asks of a simulator thread. */
export type SimulatorThreadRequest =
  | { type: 'start'; module: Uint8Array }
  | { type: 'rx'; bytes: Uint8Array }
  | { type: 'stop' }
  | { type: 'python-read'; request: number; id: number }
  | { type: 'python-write'; id: number; bytes: Uint8Array }

/** What a simulator thread reports. */
export type SimulatorThreadReply =
  | { type: 'started' }
  | { type: 'start-failed'; message: string }
  | { type: 'tx'; bytes: Uint8Array }
  | { type: 'log'; line: string; stream: SimulatorLogStream }
  | { type: 'stopped'; reason: string }
  | ({ type: 'python-block' } & SimulatorPythonBlock)
  | { type: 'python-input'; request: number; bytes: Uint8Array | null }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isBytes = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value) && !(value instanceof DataView)

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Checks a message that reached a simulator thread; anything else is `null`. */
export function parseSimulatorThreadRequest(value: unknown): SimulatorThreadRequest | null {
  if (!isRecord(value)) return null
  if (value.type === 'stop') return { type: 'stop' }
  if (value.type === 'start' && isBytes(value.module)) return { type: 'start', module: value.module }
  if (value.type === 'rx' && isBytes(value.bytes)) return { type: 'rx', bytes: value.bytes }
  if (value.type === 'python-read' && isCount(value.request) && isCount(value.id)) {
    return { type: 'python-read', request: value.request, id: value.id }
  }
  if (value.type === 'python-write' && isCount(value.id) && isBytes(value.bytes)) {
    return { type: 'python-write', id: value.id, bytes: value.bytes }
  }
  return null
}

/** Checks a message from a simulator thread; anything else is `null`. */
export function parseSimulatorThreadReply(value: unknown): SimulatorThreadReply | null {
  if (!isRecord(value)) return null
  switch (value.type) {
    case 'started':
      return { type: 'started' }
    case 'start-failed':
      return typeof value.message === 'string' ? { type: 'start-failed', message: value.message } : null
    case 'tx':
      return isBytes(value.bytes) ? { type: 'tx', bytes: value.bytes } : null
    case 'log':
      return typeof value.line === 'string' && (value.stream === 'stdout' || value.stream === 'stderr')
        ? { type: 'log', line: value.line, stream: value.stream }
        : null
    case 'stopped':
      return typeof value.reason === 'string' ? { type: 'stopped', reason: value.reason } : null
    case 'python-block':
      return isCount(value.id) &&
        typeof value.name === 'string' &&
        typeof value.script === 'string' &&
        isBytes(value.outputSeed)
        ? { type: 'python-block', id: value.id, name: value.name, script: value.script, outputSeed: value.outputSeed }
        : null
    case 'python-input':
      return isCount(value.request) && (value.bytes === null || isBytes(value.bytes))
        ? { type: 'python-input', request: value.request, bytes: value.bytes }
        : null
    default:
      return null
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The thread's side: runs one simulator module at a time and relays its serial line and output. Serial bytes the
 * firmware sends within one turn of the thread go out as one message.
 */
export function serveSimulatorThread(
  channel: SimulatorThreadChannel,
  createModule: () => WasmSimulatorModule = () => new WasmSimulatorModule(),
): void {
  let simulator: WasmSimulatorModule | null = null
  let outgoing: number[] = []
  const reply = (message: SimulatorThreadReply): void => channel.post(message)
  const flush = (): void => {
    if (outgoing.length === 0) return
    reply({ type: 'tx', bytes: new Uint8Array(outgoing) })
    outgoing = []
  }

  channel.onMessage((value) => {
    const request = parseSimulatorThreadRequest(value)
    if (request === null) return
    if (request.type === 'rx') {
      for (const byte of request.bytes) simulator?.feedByte(byte)
      return
    }
    if (request.type === 'python-read') {
      const reading = simulator?.readPythonInput(request.id) ?? Promise.resolve(null)
      void reading.then((bytes) => reply({ type: 'python-input', request: request.request, bytes }))
      return
    }
    if (request.type === 'python-write') {
      simulator?.writePythonOutput(request.id, request.bytes)
      return
    }
    simulator?.stop()
    simulator = null
    if (request.type === 'stop') return
    const run = createModule()
    simulator = run
    run.onUartByte = (byte) => {
      if (outgoing.length === 0) queueMicrotask(flush)
      outgoing.push(byte)
    }
    run.onLog = (line, stream) => reply({ type: 'log', line, stream })
    run.onPythonBlock = (block) => reply({ type: 'python-block', ...block })
    run.onStopped = (reason) => {
      if (simulator === run) simulator = null
      flush()
      reply({ type: 'stopped', reason })
    }
    run.loadAndRun(request.module).then(
      () => reply({ type: 'started' }),
      (error: unknown) => {
        run.stop()
        if (simulator === run) simulator = null
        reply({ type: 'start-failed', message: describe(error) })
      },
    )
  })
}

/**
 * The main side: a simulator that runs in its own thread, one thread per run. The debugger's virtual serial port
 * talks to it as it would to a simulator in the same thread.
 */
export class ThreadedSimulator implements UartSimulator, SimulatorPythonBus {
  onUartByte: ((byte: number) => void) | null = null
  onPythonBlock: ((block: SimulatorPythonBlock) => void) | null = null
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null
  /** Called once when the run ends on its own (a trap, an exit, the thread dying), with the reason. */
  onStopped: ((reason: string) => void) | null = null

  private thread: SimulatorThreadHandle | null = null
  private spawning = false
  private running = false
  /** Counts stops, so a run whose thread was still starting when it was stopped does not go on. */
  private stops = 0
  /** Fails the start in progress, if any. */
  private abandonStart: (() => void) | null = null
  private reads = 0
  private readonly pendingReads = new Map<number, (bytes: Uint8Array | null) => void>()

  constructor(private readonly mechanism: SimulatorThreadMechanism) {}

  /** Starts `module` in a new thread; resolves once its `setup()` ran, rejects with the reason it could not start. */
  async loadAndRun(module: Uint8Array): Promise<void> {
    if (this.thread || this.spawning) throw new Error('This simulator run has already started.')
    const stops = this.stops
    this.spawning = true
    let thread: SimulatorThreadHandle
    try {
      thread = await this.mechanism.spawn()
    } finally {
      this.spawning = false
    }
    if (this.stops !== stops) {
      void Promise.resolve(thread.terminate()).catch(() => undefined)
      throw new Error('The simulator was stopped before it started.')
    }
    this.thread = thread
    return new Promise<void>((resolve, reject) => {
      let starting = true
      this.abandonStart = () => {
        if (starting) reject(new Error('The simulator was stopped before it started.'))
        starting = false
      }
      const fail = (reason: string): void => {
        if (this.thread !== thread) return
        this.abandonStart = null
        this.end()
        if (starting) reject(new Error(reason))
        else this.onStopped?.(reason)
        starting = false
      }
      thread.onFailure((reason) => fail(`The simulator thread stopped: ${reason}`))
      thread.onMessage((value) => {
        const message = parseSimulatorThreadReply(value)
        if (message === null || this.thread !== thread) return
        switch (message.type) {
          case 'started':
            starting = false
            this.abandonStart = null
            this.running = true
            resolve()
            return
          case 'start-failed':
            fail(message.message)
            return
          case 'tx':
            for (const byte of message.bytes) this.onUartByte?.(byte)
            return
          case 'log':
            this.onLog?.(message.line, message.stream)
            return
          case 'stopped':
            fail(message.reason)
            return
          case 'python-block':
            this.onPythonBlock?.({
              id: message.id,
              name: message.name,
              script: message.script,
              outputSeed: message.outputSeed,
            })
            return
          case 'python-input':
            this.pendingReads.get(message.request)?.(message.bytes)
            this.pendingReads.delete(message.request)
            return
        }
      })
      thread.post({ type: 'start', module } satisfies SimulatorThreadRequest)
    })
  }

  feedByte(byte: number): void {
    if (!this.running || !this.thread) return
    this.thread.post({ type: 'rx', bytes: new Uint8Array([byte & 0xff]) } satisfies SimulatorThreadRequest)
  }

  /** Answered by the thread from the moment it runs, since blocks start during `setup()`, before `started`. */
  readPythonInput(id: number): Promise<Uint8Array | null> {
    const thread = this.thread
    if (!thread) return Promise.resolve(null)
    const request = ++this.reads
    return new Promise((resolve) => {
      this.pendingReads.set(request, resolve)
      thread.post({ type: 'python-read', request, id } satisfies SimulatorThreadRequest)
    })
  }

  writePythonOutput(id: number, bytes: Uint8Array): void {
    if (!this.thread) return
    this.thread.post({ type: 'python-write', id, bytes } satisfies SimulatorThreadRequest)
  }

  stop(): void {
    this.stops++
    this.thread?.post({ type: 'stop' } satisfies SimulatorThreadRequest)
    this.end()
  }

  isRunning(): boolean {
    return this.running
  }

  private end(): void {
    const abandon = this.abandonStart
    this.abandonStart = null
    abandon?.()
    const thread = this.thread
    this.thread = null
    this.running = false
    for (const resolve of this.pendingReads.values()) resolve(null)
    this.pendingReads.clear()
    if (thread) void Promise.resolve(thread.terminate()).catch(() => undefined)
  }
}
