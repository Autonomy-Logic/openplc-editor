/**
 * Runs the OpenPLC Simulator's WebAssembly module: the PLC program and the Baremetal runtime, compiled by the
 * in-editor toolchain (`steps/build-simulator-wasm-request.ts`). The module is a reactor whose host interface is
 * defined by its shim (`wasm-sim/sim_main.cpp`): the host owns the clock and the serial line.
 *
 * Simulated time advances by the scan period on every scan and never runs ahead of the wall clock: a step runs only
 * once the wall clock has reached the simulated time it moves to. When the host falls behind (a throttled tab, a long
 * pause) it does not catch up, so simulated time stays behind. Each period is
 * advanced in steps of at most `MODBUS_STEP_US`, so the runtime's serial service also runs between scans.
 */

/** The longest step of simulated time between two runs of the sketch's loop, so the debugger is served in between. */
export const MODBUS_STEP_US = 10_000

/** WASI errno values the host returns. */
const ERRNO_SUCCESS = 0
const ERRNO_BADF = 8
const ERRNO_NOSYS = 52
const ERRNO_SPIPE = 70

const STDOUT = 1
const STDERR = 2

export type SimulatorLogStream = 'stdout' | 'stderr'

/** The serial side of a simulator, as the virtual serial port drives it. */
export interface UartSimulator {
  /** Called with every byte the firmware sends on its serial port. */
  onUartByte: ((byte: number) => void) | null
  /** Delivers one byte to the firmware's serial port. */
  feedByte(byte: number): void
}

/** A Python function block the program started (`wasm-sim/sim_python.cpp`), with what its first exchange needs. */
export interface SimulatorPythonBlock {
  id: number
  /** The block's POU name. */
  name: string
  /** The generated script, with the simulator's stdio exchange. */
  script: string
  /** The outputs the PLC holds once the starting scan has run, to seed the block with. */
  outputSeed: Uint8Array
}

/** What a Python block host needs of a simulator run: the blocks it starts and their buffers. */
export interface SimulatorPythonBus {
  /** Called once per block, after the scan that started it. */
  onPythonBlock: ((block: SimulatorPythonBlock) => void) | null
  /** The block's current inputs, or `null` once the run or the block is gone. */
  readPythonInput(id: number): Promise<Uint8Array | null>
  /** Stores the block's outputs; the program reads them on its next scan. */
  writePythonOutput(id: number, bytes: Uint8Array): void
}

interface PythonBlockBuffers {
  inPointer: number
  inSize: number
  outPointer: number
  outSize: number
}

/** The wall clock and timers the simulator paces itself with; `schedule` returns a function that cancels. */
export interface SimulatorTimers {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
}

const platformTimers: SimulatorTimers = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    return () => clearTimeout(handle)
  },
}

interface SimulatorExports {
  memory: WebAssembly.Memory
  initialize: () => void
  setup: () => void
  loop: () => void
  uartReceive: (byte: number) => void
  scanPeriodUs: () => number
}

/** Raised by the module's `proc_exit`, which ends the simulation. */
class SimulatorExit extends Error {
  constructor(readonly code: number) {
    super(`The simulator program exited with code ${code}.`)
  }
}

const isCallable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function'

const exportedFunction = (instance: WebAssembly.Instance, name: string): ((...args: number[]) => unknown) => {
  const value = instance.exports[name]
  if (!isCallable(value)) throw new Error(`The simulator module does not export '${name}'.`)
  return value
}

function readExports(instance: WebAssembly.Instance): SimulatorExports {
  const memory = instance.exports.memory
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("The simulator module does not export 'memory'.")
  const initialize = exportedFunction(instance, '_initialize')
  const setup = exportedFunction(instance, 'sim_setup')
  const loop = exportedFunction(instance, 'sim_loop')
  const uartReceive = exportedFunction(instance, 'sim_uart_receive')
  const scanPeriodUs = exportedFunction(instance, 'sim_scan_period_us')
  return {
    memory,
    initialize: () => void initialize(),
    setup: () => void setup(),
    loop: () => void loop(),
    uartReceive: (byte) => void uartReceive(byte),
    scanPeriodUs: () => Number(scanPeriodUs()),
  }
}

/** One simulator run. `stop()` ends it for good; a new run takes a new instance. */
export class WasmSimulatorModule implements UartSimulator, SimulatorPythonBus {
  onUartByte: ((byte: number) => void) | null = null
  onPythonBlock: ((block: SimulatorPythonBlock) => void) | null = null
  /** Text the program wrote to standard output or standard error, one line at a time. */
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null
  /** Called once when the run ends on its own (a trap, an exit), with the reason. Not called by `stop()`. */
  onStopped: ((reason: string) => void) | null = null

  private exports: SimulatorExports | null = null
  private running = false
  private cancelTimer: (() => void) | null = null
  private clockUs = 0n
  private periodUs = 0
  private intoPeriodUs = 0
  private nextStepAt = 0
  private scans = 0
  private readonly pendingText: Record<SimulatorLogStream, string> = { stdout: '', stderr: '' }
  private readonly pythonBlocks = new Map<number, PythonBlockBuffers>()
  private startedBlocks: Array<Omit<SimulatorPythonBlock, 'outputSeed'>> = []
  private pythonBlockCount = 0

  constructor(private readonly timers: SimulatorTimers = platformTimers) {}

  /** Instantiates the module, runs the sketch's `setup()` and starts scanning. Rejects when the module cannot start. */
  async loadAndRun(module: Uint8Array | WebAssembly.Module): Promise<void> {
    if (this.running || this.exports) throw new Error('This simulator run has already started.')
    const compiled = module instanceof WebAssembly.Module ? module : await WebAssembly.compile(module)
    const instance = await WebAssembly.instantiate(compiled, this.imports(compiled))
    const exports = readExports(instance)
    this.exports = exports
    exports.initialize()
    exports.setup()
    this.announcePythonBlocks()
    const period = exports.scanPeriodUs()
    if (!Number.isFinite(period) || period <= 0) throw new Error('The simulator program reports no scan period.')
    this.periodUs = period
    this.running = true
    const now = this.timers.now()
    this.nextStepAt = now + this.nextStepUs() / 1000
    this.schedule(this.nextStepAt - now)
  }

  feedByte(byte: number): void {
    if (!this.running || !this.exports) return
    this.exports.uartReceive(byte & 0xff)
  }

  stop(): void {
    this.running = false
    this.cancelTimer?.()
    this.cancelTimer = null
    this.exports = null
    this.pythonBlocks.clear()
    this.startedBlocks = []
    this.flushText()
  }

  readPythonInput(id: number): Promise<Uint8Array | null> {
    const block = this.pythonBlocks.get(id)
    return Promise.resolve(block && this.exports ? this.bytesAt(block.inPointer, block.inSize) : null)
  }

  writePythonOutput(id: number, bytes: Uint8Array): void {
    const block = this.pythonBlocks.get(id)
    if (!block || !this.exports) return
    new Uint8Array(this.memoryBuffer(), block.outPointer, block.outSize).set(bytes.subarray(0, block.outSize))
  }

  isRunning(): boolean {
    return this.running
  }

  /** Simulated time since `setup()`, in microseconds. */
  get simulatedTimeUs(): number {
    return Number(this.clockUs)
  }

  /** How many scans (full periods) have run. */
  get scanCount(): number {
    return this.scans
  }

  get scanPeriodUs(): number {
    return this.periodUs
  }

  private schedule(delayMs: number): void {
    this.cancelTimer = this.timers.schedule(() => this.step(), Math.max(0, delayMs))
  }

  /**
   * Runs one step of simulated time. Steps keep their schedule while a timer fires late by less than a period;
   * further behind, time restarts from now instead of catching up.
   */
  private step(): void {
    this.cancelTimer = null
    if (!this.running || !this.exports) return
    const stepUs = this.nextStepUs()
    this.clockUs += BigInt(stepUs)
    this.intoPeriodUs += stepUs
    if (this.intoPeriodUs >= this.periodUs) {
      this.intoPeriodUs = 0
      this.scans++
    }
    try {
      this.exports.loop()
    } catch (error) {
      this.fail(error instanceof SimulatorExit ? error.message : `The simulator stopped: ${describe(error)}`)
      return
    }
    this.announcePythonBlocks()
    if (!this.running) return
    const now = this.timers.now()
    const behind = now - this.nextStepAt >= this.periodUs / 1000
    this.nextStepAt = (behind ? now : this.nextStepAt) + this.nextStepUs() / 1000
    this.schedule(this.nextStepAt - now)
  }

  /** The next step of simulated time: up to `MODBUS_STEP_US`, ending at the end of the current period. */
  private nextStepUs(): number {
    return Math.min(MODBUS_STEP_US, this.periodUs - this.intoPeriodUs)
  }

  private fail(reason: string): void {
    this.stop()
    this.onStopped?.(reason)
  }

  private imports(module: WebAssembly.Module): WebAssembly.Imports {
    const wasi: Record<string, (...args: number[]) => number> = {}
    for (const entry of WebAssembly.Module.imports(module)) {
      if (entry.module === 'wasi_snapshot_preview1' && entry.kind === 'function') {
        wasi[entry.name] = this.wasiFunction(entry.name)
      }
    }
    return {
      env: {
        host_clock_us: () => this.clockUs,
        host_uart_write: (pointer: number, length: number) => {
          const bytes = this.bytesAt(pointer, length)
          for (const byte of bytes) this.onUartByte?.(byte)
        },
        host_python_block: (
          namePointer: number,
          nameLength: number,
          scriptPointer: number,
          scriptLength: number,
          inPointer: number,
          inSize: number,
          outPointer: number,
          outSize: number,
        ) =>
          this.startPythonBlock(namePointer, nameLength, scriptPointer, scriptLength, {
            inPointer,
            inSize,
            outPointer,
            outSize,
          }),
      },
      wasi_snapshot_preview1: wasi,
    }
  }

  /** Records a block the program started; it is announced once the scan that started it ends. */
  private startPythonBlock(
    namePointer: number,
    nameLength: number,
    scriptPointer: number,
    scriptLength: number,
    buffers: PythonBlockBuffers,
  ): number {
    const id = ++this.pythonBlockCount
    const decoder = new TextDecoder()
    this.startedBlocks.push({
      id,
      name: decoder.decode(this.bytesAt(namePointer, nameLength)),
      script: decoder.decode(this.bytesAt(scriptPointer, scriptLength)),
    })
    this.pythonBlocks.set(id, buffers)
    return 0
  }

  private announcePythonBlocks(): void {
    const started = this.startedBlocks
    this.startedBlocks = []
    for (const block of started) {
      const buffers = this.pythonBlocks.get(block.id)
      if (!buffers) continue
      this.onPythonBlock?.({ ...block, outputSeed: this.bytesAt(buffers.outPointer, buffers.outSize) })
    }
  }

  private wasiFunction(name: string): (...args: number[]) => number {
    switch (name) {
      case 'fd_write':
        return (fd, iovs, iovsLength, written) => this.fdWrite(fd, iovs, iovsLength, written)
      case 'fd_close':
        return () => ERRNO_SUCCESS
      case 'fd_seek':
        return () => ERRNO_SPIPE
      case 'proc_exit':
        return (code) => {
          throw new SimulatorExit(code)
        }
      default:
        return () => ERRNO_NOSYS
    }
  }

  private fdWrite(fd: number, iovs: number, iovsLength: number, written: number): number {
    const stream: SimulatorLogStream | null = fd === STDOUT ? 'stdout' : fd === STDERR ? 'stderr' : null
    if (stream === null) return ERRNO_BADF
    const view = new DataView(this.memoryBuffer())
    let total = 0
    for (let n = 0; n < iovsLength; n++) {
      const pointer = view.getUint32(iovs + n * 8, true)
      const length = view.getUint32(iovs + n * 8 + 4, true)
      this.appendText(stream, new TextDecoder().decode(this.bytesAt(pointer, length)))
      total += length
    }
    view.setUint32(written, total, true)
    return ERRNO_SUCCESS
  }

  private bytesAt(pointer: number, length: number): Uint8Array {
    return new Uint8Array(this.memoryBuffer(), pointer, length).slice()
  }

  /** The module's memory; the host functions only run while the module does, so it is always there for them. */
  private memoryBuffer(): ArrayBuffer {
    return this.exports?.memory.buffer ?? new ArrayBuffer(0)
  }

  private appendText(stream: SimulatorLogStream, text: string): void {
    const lines = (this.pendingText[stream] + text).split('\n')
    this.pendingText[stream] = lines.pop() ?? ''
    for (const line of lines) this.onLog?.(line, stream)
  }

  private flushText(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.pendingText[stream] !== '') this.onLog?.(this.pendingText[stream], stream)
      this.pendingText[stream] = ''
    }
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
