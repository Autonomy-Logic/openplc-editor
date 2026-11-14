import type { SimulatorRunner } from '../simulator/simulator-debug-session'
import type { SimulatorLogStream, SimulatorPythonBus } from '../simulator/wasm-simulator-module'
import type { PythonBlockHost } from './python-block-host'

/**
 * A simulator run with its Python blocks: the PLC starts once the interpreters prepared for it are ready, and its
 * blocks end with it. The Console gets the program's output, the blocks', and the reason a run stopped on its own.
 */
export class PythonSimulator implements SimulatorRunner {
  onLog: ((line: string, stream: SimulatorLogStream) => void) | null = null
  onStopped: ((reason: string) => void) | null = null

  constructor(
    private readonly runner: SimulatorRunner & SimulatorPythonBus,
    private readonly python: PythonBlockHost,
  ) {
    runner.onLog = (line, stream) => this.onLog?.(line, stream)
    python.onLog = (line, stream) => this.onLog?.(line, stream)
    runner.onStopped = (reason) => {
      python.stop()
      this.onLog?.(reason, 'stderr')
      this.onStopped?.(reason)
    }
  }

  get onUartByte(): ((byte: number) => void) | null {
    return this.runner.onUartByte
  }

  set onUartByte(listener: ((byte: number) => void) | null) {
    this.runner.onUartByte = listener
  }

  async loadAndRun(module: Uint8Array): Promise<void> {
    await this.python.ready()
    this.python.attach(this.runner)
    try {
      await this.runner.loadAndRun(module)
    } catch (error) {
      this.python.stop()
      throw error
    }
  }

  /** Starts interpreters for `count` blocks ahead of the next run; resolves once they are ready. */
  preparePython(count: number): Promise<void> {
    return this.python.prepare(count)
  }

  feedByte(byte: number): void {
    this.runner.feedByte(byte)
  }

  stop(): void {
    this.python.stop()
    this.runner.stop()
  }

  isRunning(): boolean {
    return this.runner.isRunning()
  }
}
