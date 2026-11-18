/**
 * Python blocks on a real simulator module: the module starts a block through `host_python_block`, the host runs it
 * and exchanges its buffers, in this thread and across a thread boundary.
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import type {
  SimulatorThreadChannel,
  SimulatorThreadMechanism,
} from '../../../../middleware/shared/ports/simulator-mechanisms'
import { NAME, pythonModule, SCRIPT } from '../../simulator/__tests__/fixtures/python-module'
import { virtualTimers } from '../../simulator/__tests__/fixtures/simulator-fixture'
import { serveSimulatorThread, ThreadedSimulator } from '../../simulator/simulator-thread'
import { type SimulatorPythonBlock, WasmSimulatorModule } from '../../simulator/wasm-simulator-module'
import { PythonBlockHost, toHex } from '../python-block-host'
import { PythonSimulator } from '../python-simulator'
import type { PythonExit, PythonProcess } from '../wasmer-python-runtime'

const until = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function inMemoryThreads(): SimulatorThreadMechanism & { terminated: boolean[] } {
  const terminated: boolean[] = []
  return {
    terminated,
    spawn: () => {
      const index = terminated.push(false) - 1
      const toMain: Array<(message: unknown) => void> = []
      const toThread: Array<(message: unknown) => void> = []
      const deliver = (listeners: Array<(message: unknown) => void>, message: unknown): void => {
        setImmediate(() => {
          if (!terminated[index]) for (const listener of listeners) listener(message)
        })
      }
      const channel: SimulatorThreadChannel = {
        post: (message) => deliver(toMain, message),
        onMessage: (listener) => toThread.push(listener),
      }
      serveSimulatorThread(channel, () => new WasmSimulatorModule(virtualTimers()))
      return {
        post: (message) => deliver(toThread, message),
        onMessage: (listener) => toMain.push(listener),
        onFailure: () => undefined,
        terminate: () => {
          terminated[index] = true
        },
      }
    },
  }
}

describe('WasmSimulatorModule and Python blocks', () => {
  it('announces a block after the scan that started it, with the outputs that scan seeded', async () => {
    const simulator = new WasmSimulatorModule(virtualTimers())
    const blocks: SimulatorPythonBlock[] = []
    simulator.onPythonBlock = (block) => blocks.push(block)
    await simulator.loadAndRun(pythonModule())

    expect(blocks).toEqual([{ id: 1, name: NAME, script: SCRIPT, outputSeed: new Uint8Array([0x2a, 0]) }])
    simulator.stop()
  })

  it('hands the block its inputs as the program changes them, and the program its outputs', async () => {
    const simulator = new WasmSimulatorModule(virtualTimers())
    const serial: number[] = []
    simulator.onUartByte = (byte) => serial.push(byte)
    await simulator.loadAndRun(pythonModule())

    await until(() => serial.length >= 4, 'two scans')
    const first = await simulator.readPythonInput(1)
    await until(() => serial.length >= 8, 'two more scans')
    const later = await simulator.readPythonInput(1)
    expect(first?.length).toBe(2)
    expect(later?.[0]).toBeGreaterThan(first?.[0] ?? 255)

    simulator.writePythonOutput(1, new Uint8Array([7, 8, 9]))
    const seen = serial.length
    await until(() => serial.length >= seen + 2, 'a scan after the write')
    expect(serial.slice(-2)).toEqual([7, 8])

    await expect(simulator.readPythonInput(99)).resolves.toBeNull()
    simulator.writePythonOutput(99, new Uint8Array([1]))
    simulator.stop()
    await expect(simulator.readPythonInput(1)).resolves.toBeNull()
    simulator.writePythonOutput(1, new Uint8Array([1]))
  })
})

describe('ThreadedSimulator and Python blocks', () => {
  it('carries the block, its inputs and its outputs across the thread boundary', async () => {
    const simulator = new ThreadedSimulator(inMemoryThreads())
    const blocks: SimulatorPythonBlock[] = []
    const serial: number[] = []
    simulator.onPythonBlock = (block) => blocks.push(block)
    simulator.onUartByte = (byte) => serial.push(byte)
    await simulator.loadAndRun(pythonModule())

    await until(() => blocks.length === 1, 'the block')
    expect(blocks[0]).toEqual({ id: 1, name: NAME, script: SCRIPT, outputSeed: new Uint8Array([0x2a, 0]) })
    const inputs = await simulator.readPythonInput(1)
    expect(inputs?.length).toBe(2)

    simulator.writePythonOutput(1, new Uint8Array([5, 6]))
    await until(() => serial.slice(-2).join() === '5,6', 'the outputs on the serial line')

    const pending = simulator.readPythonInput(1)
    simulator.stop()
    await expect(pending).resolves.toBeNull()
    await expect(simulator.readPythonInput(1)).resolves.toBeNull()
    simulator.writePythonOutput(1, new Uint8Array([1]))
  })
})

class ScriptedProcess implements PythonProcess {
  onStdout: ((line: string) => void) | null = null
  onStderr: ((line: string) => void) | null = null
  onExit: ((exit: PythonExit) => void) | null = null
  readonly written: string[] = []
  killed = false
  private marker = ''

  /** Answers every inputs line with the first input byte doubled, as the Doubler block would. */
  write(text: string): void {
    this.written.push(text)
    if (this.written.length === 2) {
      this.marker = text.split('\n')[0]
      return
    }
    if (this.written.length < 3) return
    const input = parseInt(text.slice(0, 2), 16)
    this.onStdout?.(`doubling ${input}`)
    setImmediate(() => this.onStdout?.(`@@${this.marker} ${toHex(new Uint8Array([(input * 2) & 0xff, 0]))}`))
  }

  kill(): void {
    this.killed = true
    this.onExit?.({ kind: 'killed' })
  }
}

describe('PythonSimulator', () => {
  it('starts the PLC once its interpreters are ready, runs its blocks, and ends them with it', async () => {
    const processes: ScriptedProcess[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const host = new PythonBlockHost({
      spawn: async () => {
        await gate
        const process = new ScriptedProcess()
        processes.push(process)
        return process
      },
    })
    const simulator = new PythonSimulator(new ThreadedSimulator(inMemoryThreads()), host)
    const lines: string[] = []
    const serial: number[] = []
    simulator.onLog = (line) => lines.push(line)
    simulator.onUartByte = (byte) => serial.push(byte)
    expect(simulator.onUartByte).not.toBeNull()

    void simulator.preparePython(1)
    let started = false
    const starting = simulator.loadAndRun(pythonModule()).then(() => (started = true))
    await new Promise((resolve) => setImmediate(resolve))
    expect(started).toBe(false)
    release()
    await starting
    expect(simulator.isRunning()).toBe(true)

    await until(() => lines.some((line) => line.startsWith(`[${NAME}] doubling`)), 'the block output')
    await until(
      () => serial.length >= 2 && serial[serial.length - 2] % 2 === 0 && serial[serial.length - 2] > 0,
      'outputs',
    )
    expect(processes[0].written[0]).toBe(`${NAME}\n${SCRIPT.length}\n${SCRIPT}`)

    simulator.feedByte(1)
    simulator.stop()
    expect(processes[0].killed).toBe(true)
    expect(simulator.isRunning()).toBe(false)
  })

  it('ends the blocks when the run stops on its own, and reports why', async () => {
    const processes: ScriptedProcess[] = []
    const host = new PythonBlockHost({
      spawn: () => {
        const process = new ScriptedProcess()
        processes.push(process)
        return Promise.resolve(process)
      },
    })
    const runner = new WasmSimulatorModule(virtualTimers())
    const simulator = new PythonSimulator(runner, host)
    const reasons: string[] = []
    simulator.onStopped = (reason) => reasons.push(reason)
    await simulator.loadAndRun(pythonModule())
    await until(() => processes.length === 1, 'the block')

    const lines: Array<[string, string]> = []
    simulator.onLog = (line, stream) => lines.push([line, stream])
    runner.onStopped?.('The simulator stopped: trap')
    expect(reasons).toEqual(['The simulator stopped: trap'])
    expect(lines).toContainEqual(['The simulator stopped: trap', 'stderr'])
    expect(processes[0].killed).toBe(true)
    runner.stop()
  })

  it('puts the reason Python could not be prepared on the Console, before any run starts', async () => {
    const host = new PythonBlockHost({ spawn: () => Promise.reject(new Error('no runtime')) })
    const simulator = new PythonSimulator(new WasmSimulatorModule(virtualTimers()), host)
    const lines: string[] = []
    simulator.onLog = (line) => lines.push(line)
    await simulator.preparePython(1)
    expect(lines).toEqual(['Python could not be prepared: no runtime'])
  })

  it('ends the blocks when the module cannot start', async () => {
    const host = new PythonBlockHost({ spawn: () => Promise.reject(new Error('unused')) })
    const simulator = new PythonSimulator(new WasmSimulatorModule(virtualTimers()), host)
    await expect(simulator.loadAndRun(new Uint8Array([0, 1, 2]))).rejects.toThrow()
    expect(simulator.isRunning()).toBe(false)
  })
})
