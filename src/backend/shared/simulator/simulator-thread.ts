import type {
  SimulatorThreadChannel,
  SimulatorThreadHandle,
  SimulatorThreadMechanism,
} from '../../../middleware/shared/ports/simulator-mechanisms'
import { type SimulatorLogStream, type UartSimulator, WasmSimulatorModule } from './wasm-simulator-module'

/** What the main side asks of a simulator thread. */
export type SimulatorThreadRequest =
  | { type: 'start'; module: Uint8Array }
  | { type: 'rx'; bytes: Uint8Array }
  | { type: 'stop' }

/** What a simulator thread reports. */
export type SimulatorThreadReply =
  | { type: 'started' }
  | { type: 'start-failed'; message: string }
  | { type: 'tx'; bytes: Uint8Array }
  | { type: 'log'; line: string; stream: SimulatorLogStream }
  | { type: 'stopped'; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isBytes = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value) && !(value instanceof DataView)

/** Checks a message that reached a simulator thread; anything else is `null`. */
export function parseSimulatorThreadRequest(value: unknown): SimulatorThreadRequest | null {
  if (!isRecord(value)) return null
  if (value.type === 'stop') return { type: 'stop' }
  if (value.type === 'start' && isBytes(value.module)) return { type: 'start', module: value.module }
  if (value.type === 'rx' && isBytes(value.bytes)) return { type: 'rx', bytes: value.bytes }
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
export class ThreadedSimulator implements UartSimulator {
  onUartByte: ((byte: number) => void) | null = null
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null
  /** Called once when the run ends on its own (a trap, an exit, the thread dying), with the reason. */
  onStopped: ((reason: string) => void) | null = null

  private thread: SimulatorThreadHandle | null = null
  private spawning = false
  private running = false
  /** Counts stops, so a run whose thread was still starting when it was stopped does not go on. */
  private stops = 0

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
      const fail = (reason: string): void => {
        if (this.thread !== thread) return
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
        }
      })
      thread.post({ type: 'start', module } satisfies SimulatorThreadRequest)
    })
  }

  feedByte(byte: number): void {
    if (!this.running || !this.thread) return
    this.thread.post({ type: 'rx', bytes: new Uint8Array([byte & 0xff]) } satisfies SimulatorThreadRequest)
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
    const thread = this.thread
    this.thread = null
    this.running = false
    if (thread) void Promise.resolve(thread.terminate()).catch(() => undefined)
  }
}
