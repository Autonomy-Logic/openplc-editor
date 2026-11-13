/**
 * Runs a simulator run's Python function blocks: one interpreter per block instance, each exchanging its inputs and
 * outputs with the PLC as on the runtime (block_loop, then 100 ms, then the next exchange).
 *
 * The exchange is the wrapper's stdio transport (`injectPythonRuntime`, `transport: 'stdio'`): the host sends the
 * block name, the script's length and the script to the boot script, then the marker and the seeded outputs, then one
 * hex line of inputs per exchange; the block answers each with `@@<marker> <hex outputs>`. Anything else it prints
 * goes to the Console, prefixed with its name.
 */
import type { SimulatorLogStream, SimulatorPythonBlock, SimulatorPythonBus } from '../simulator/wasm-simulator-module'
import type { PythonInterpreters } from './python-thread'
import type { PythonExit, PythonProcess } from './wasmer-python-runtime'

/** The runtime's pause between two exchanges (`time.sleep(0.1)` in its wrapper). */
export const PYTHON_EXCHANGE_INTERVAL_MS = 100

export interface PythonHostTimers {
  schedule(callback: () => void, delayMs: number): () => void
}

const platformTimers: PythonHostTimers = {
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    return () => clearTimeout(handle)
  },
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** The bytes of an even-length hex string, or `null` when it is not one. */
export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let n = 0; n < bytes.length; n++) bytes[n] = parseInt(hex.substring(n * 2, n * 2 + 2), 16)
  return bytes
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const randomMarker = (): string =>
  Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0'),
  ).join('')

/** One block instance of the current run. */
class RunningBlock {
  private cancelExchange: (() => void) | null = null
  private exchanging = false
  private ended = false

  /** Whether the block's interpreter is still running. */
  get alive(): boolean {
    return !this.ended
  }

  constructor(
    private readonly block: SimulatorPythonBlock,
    readonly label: string,
    private readonly process: PythonProcess,
    private readonly bus: SimulatorPythonBus,
    private readonly log: (line: string, stream: SimulatorLogStream) => void,
    private readonly timers: PythonHostTimers,
    private readonly marker: string,
  ) {}

  start(): void {
    const prefix = `@@${this.marker} `
    this.process.onStdout = (line) => {
      if (line.startsWith(prefix)) this.received(line.slice(prefix.length))
      else this.log(`[${this.label}] ${line}`, 'stdout')
    }
    this.process.onStderr = (line) => this.log(`[${this.label}] ${line}`, 'stderr')
    this.process.onExit = (exit) => this.exited(exit)

    const script = this.block.script
    this.process.write(`${this.block.name}\n${new TextEncoder().encode(script).length}\n${script}`)
    this.process.write(`${this.marker}\n${toHex(this.block.outputSeed)}\n`)
    void this.exchange()
  }

  stop(): void {
    this.ended = true
    this.cancelExchange?.()
    this.cancelExchange = null
    this.process.kill()
  }

  /** Sends the block its current inputs; the next exchange waits for its answer. */
  private async exchange(): Promise<void> {
    this.cancelExchange = null
    if (this.ended || this.exchanging) return
    this.exchanging = true
    const inputs = await this.bus.readPythonInput(this.block.id)
    if (this.ended) return
    if (inputs === null) {
      this.stop()
      return
    }
    this.process.write(`${toHex(inputs)}\n`)
  }

  private received(hex: string): void {
    if (this.ended || !this.exchanging) return
    this.exchanging = false
    const outputs = fromHex(hex.trim())
    if (outputs === null) {
      this.log(`[${this.label}] sent outputs the simulator cannot read; the block is stopped.`, 'stderr')
      this.stop()
      return
    }
    this.bus.writePythonOutput(this.block.id, outputs)
    this.cancelExchange = this.timers.schedule(() => void this.exchange(), PYTHON_EXCHANGE_INTERVAL_MS)
  }

  private exited(exit: PythonExit): void {
    const stopped = this.ended
    this.ended = true
    this.cancelExchange?.()
    this.cancelExchange = null
    if (stopped) return
    if (exit.kind === 'exited' && exit.code !== 0) {
      this.log(
        `[${this.label}] Python block exited with code ${exit.code}; its outputs keep their last values.`,
        'stderr',
      )
    } else if (exit.kind === 'failed') {
      this.log(`[${this.label}] Python block stopped: ${exit.reason}; its outputs keep their last values.`, 'stderr')
    }
  }
}

/**
 * Starts the Python blocks a simulator run announces. Interpreters prepared ahead (`prepare`, while the project
 * builds) are used first; a block beyond them gets one started on demand. No more than `maxInterpreters` are alive at
 * once: a block beyond that limit is not started, and the Console says why.
 */
export class PythonBlockHost {
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null

  private readonly idle: PythonProcess[] = []
  private readonly running: RunningBlock[] = []
  private preparing: Promise<void> = Promise.resolve()
  private pendingPrepares = 0
  private pendingStarts = 0
  private runs = 0
  private limitReported = 0

  constructor(
    private readonly interpreters: PythonInterpreters,
    private readonly timers: PythonHostTimers = platformTimers,
    private readonly maxInterpreters: number = Number.POSITIVE_INFINITY,
  ) {}

  /** Interpreters alive or starting: idle, being prepared, being started for a block, or running one. */
  private live(): number {
    return (
      this.idle.length + this.pendingPrepares + this.pendingStarts + this.running.filter((block) => block.alive).length
    )
  }

  /**
   * Starts interpreters until `count` wait idle and ready, within the interpreter limit. Failures go to the Console;
   * blocks then start on demand.
   */
  prepare(count: number): Promise<void> {
    const inUse = this.live() - this.idle.length - this.pendingPrepares
    const wanted = Math.min(count, this.maxInterpreters - inUse)
    const missing = wanted - this.idle.length - this.pendingPrepares
    if (missing <= 0) return this.preparing
    this.pendingPrepares += missing
    const started = Array.from({ length: missing }, () =>
      this.interpreters.spawn().then(
        (process) => {
          this.pendingPrepares--
          this.keepIdle(process)
        },
        (error: unknown) => {
          this.pendingPrepares--
          this.log(`Python could not be prepared: ${describe(error)}`, 'stderr')
        },
      ),
    )
    this.preparing = Promise.all([this.preparing, ...started]).then(() => undefined)
    return this.preparing
  }

  /** Resolves once every interpreter asked for has started or failed. */
  ready(): Promise<void> {
    return this.preparing
  }

  /** Runs the blocks `bus` announces until `stop()`. */
  attach(bus: SimulatorPythonBus): void {
    const run = ++this.runs
    const labels = new Map<string, number>()
    bus.onPythonBlock = (block) => {
      const seen = (labels.get(block.name) ?? 0) + 1
      labels.set(block.name, seen)
      void this.startBlock(run, bus, block, seen === 1 ? block.name : `${block.name} #${seen}`)
    }
  }

  /** Ends every running block; the idle interpreters stay for the next run. */
  stop(): void {
    this.runs++
    for (const block of this.running.splice(0)) block.stop()
  }

  private async startBlock(run: number, bus: SimulatorPythonBus, block: SimulatorPythonBlock, label: string) {
    let process: PythonProcess
    const prepared = this.idle.shift()
    if (prepared) {
      process = prepared
    } else {
      if (this.live() >= this.maxInterpreters) {
        this.reportLimit(run, label)
        return
      }
      this.pendingStarts++
      try {
        process = await this.interpreters.spawn()
      } catch (error) {
        this.log(`[${label}] Python could not start: ${describe(error)}`, 'stderr')
        return
      } finally {
        this.pendingStarts--
      }
    }
    if (run !== this.runs) {
      this.keepIdle(process)
      return
    }
    const running = new RunningBlock(
      block,
      label,
      process,
      bus,
      (line, stream) => this.log(line, stream),
      this.timers,
      randomMarker(),
    )
    this.running.push(running)
    running.start()
  }

  /** Reports, once per run, the first block left idle by the interpreter limit. */
  private reportLimit(run: number, label: string): void {
    if (this.limitReported === run) return
    this.limitReported = run
    this.log(
      `[${label}] Python block not started: this run already uses ${this.maxInterpreters} Python interpreters, the ` +
        "most this computer's memory allows; it and any further blocks keep their initial outputs.",
      'stderr',
    )
  }

  /** Keeps a fresh interpreter for a later block, forgetting it if it ends first. */
  private keepIdle(process: PythonProcess): void {
    this.idle.push(process)
    process.onStderr = (line) => this.log(`Python: ${line}`, 'stderr')
    process.onExit = () => {
      const index = this.idle.indexOf(process)
      if (index >= 0) this.idle.splice(index, 1)
    }
  }

  private log(line: string, stream: SimulatorLogStream): void {
    this.onLog?.(line, stream)
  }
}
