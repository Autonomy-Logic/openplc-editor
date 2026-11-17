/**
 * The simulator split across a thread boundary: `ThreadedSimulator` on the main side, `serveSimulatorThread` on the
 * thread side, joined by an in-memory channel that delivers messages asynchronously, as a real thread does.
 * @jest-environment node
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from '@jest/globals'

import type {
  SimulatorThreadChannel,
  SimulatorThreadHandle,
  SimulatorThreadMechanism,
} from '../../../../middleware/shared/ports/simulator-mechanisms'
import { ModbusRtuClient } from '../modbus-rtu-client'
import { SimulatorDebugSession } from '../simulator-debug-session'
import {
  parseSimulatorThreadReply,
  parseSimulatorThreadRequest,
  serveSimulatorThread,
  ThreadedSimulator,
} from '../simulator-thread'
import { VirtualSerialPort } from '../virtual-serial-port'
import { WasmSimulatorModule } from '../wasm-simulator-module'
import { hostModule } from './fixtures/host-module'
import { FIXTURE_MD5, fixtureModule, virtualTimers } from './fixtures/simulator-fixture'
import { OP } from './fixtures/tiny-wasm'

interface FakeThread extends SimulatorThreadHandle {
  /** Ends the thread as if it crashed. */
  crash(reason: string): void
  terminated: boolean
  /** Sends a raw message from the thread side. */
  fromThread(message: unknown): void
}

/** Threads that run `serveSimulatorThread` in this process, unless `serve` is false. */
function inMemoryThreads(serve = true): SimulatorThreadMechanism & { threads: FakeThread[] } {
  const threads: FakeThread[] = []
  return {
    threads,
    spawn: () => {
      const toMain: Array<(message: unknown) => void> = []
      const toThread: Array<(message: unknown) => void> = []
      const failures: Array<(reason: string) => void> = []
      const deliver = (listeners: Array<(message: unknown) => void>, message: unknown): void => {
        setImmediate(() => {
          if (!thread.terminated) for (const listener of listeners) listener(message)
        })
      }
      const channel: SimulatorThreadChannel = {
        post: (message) => deliver(toMain, message),
        onMessage: (listener) => toThread.push(listener),
      }
      const thread: FakeThread = {
        terminated: false,
        post: (message) => deliver(toThread, message),
        onMessage: (listener) => toMain.push(listener),
        onFailure: (listener) => failures.push(listener),
        terminate: () => {
          thread.terminated = true
        },
        crash: (reason) => {
          for (const listener of failures) listener(reason)
        },
        fromThread: (message) => deliver(toMain, message),
      }
      if (serve) serveSimulatorThread(channel, () => new WasmSimulatorModule(virtualTimers()))
      threads.push(thread)
      return thread
    },
  }
}

const running: ThreadedSimulator[] = []
const threaded = (mechanism: SimulatorThreadMechanism): ThreadedSimulator => {
  const simulator = new ThreadedSimulator(mechanism)
  running.push(simulator)
  return simulator
}

afterEach(() => {
  for (const simulator of running.splice(0)) simulator.stop()
})

const nextMessage = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('ThreadedSimulator with serveSimulatorThread', () => {
  it('runs the module in the thread and serves the debugger across the boundary', async () => {
    const mechanism = inMemoryThreads()
    const simulator = threaded(mechanism)
    await simulator.loadAndRun(fixtureModule())
    expect(simulator.isRunning()).toBe(true)

    const client = new ModbusRtuClient({
      slaveId: 1,
      timeout: 5000,
      readyDelayMs: 0,
      serialPort: new VirtualSerialPort(simulator),
    })
    await client.connect()
    await expect(client.getMd5Hash()).resolves.toEqual({ md5: FIXTURE_MD5, targetEndian: 'le' })
    client.disconnect()

    simulator.stop()
    expect(simulator.isRunning()).toBe(false)
    expect(mechanism.threads[0].terminated).toBe(true)
  })

  it('relays the program output, and the debug session runs on it unchanged', async () => {
    const mechanism = inMemoryThreads()
    const session = new SimulatorDebugSession(() => threaded(mechanism))
    const lines: string[] = []
    session.onLog = (line) => lines.push(line)

    await session.start(hostModule({ periodUs: 1000 }))
    await nextMessage()

    expect(lines).toEqual(['hi', 'err'])
    session.stop()
  })

  it('rejects the start with the reason when the module cannot start, and ends the thread', async () => {
    const mechanism = inMemoryThreads()
    const simulator = threaded(mechanism)
    await expect(simulator.loadAndRun(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    expect(mechanism.threads[0].terminated).toBe(true)
    expect(simulator.isRunning()).toBe(false)
  })

  it('reports a run that ends on its own in the thread', async () => {
    const simulator = threaded(inMemoryThreads())
    const stopped = new Promise<string>((resolve) => {
      simulator.onStopped = resolve
    })
    await simulator.loadAndRun(hostModule({ periodUs: 1000, loop: [OP.unreachable] }))

    await expect(stopped).resolves.toMatch(/^The simulator stopped: /)
    expect(simulator.isRunning()).toBe(false)
  })

  it('reports a thread that dies, while starting or while running', async () => {
    const starting = inMemoryThreads(false)
    const first = threaded(starting)
    const start = first.loadAndRun(fixtureModule())
    await Promise.resolve()
    starting.threads[0].crash('out of memory')
    await expect(start).rejects.toThrow('The simulator thread stopped: out of memory')

    const mechanism = inMemoryThreads()
    const second = threaded(mechanism)
    await second.loadAndRun(fixtureModule())
    const reasons: string[] = []
    second.onStopped = (reason) => reasons.push(reason)
    mechanism.threads[0].crash('killed')
    mechanism.threads[0].crash('killed again')
    expect(reasons).toEqual(['The simulator thread stopped: killed'])
  })

  it('ignores what does not belong to the current run, and refuses a second start', async () => {
    const mechanism = inMemoryThreads(false)
    const simulator = threaded(mechanism)
    const start = simulator.loadAndRun(fixtureModule())
    const thread = mechanism.threads[0]
    simulator.feedByte(1)
    thread.fromThread({ type: 'unknown' })
    thread.fromThread({ type: 'started' })
    await start
    await expect(simulator.loadAndRun(fixtureModule())).rejects.toThrow('This simulator run has already started.')

    const bytes: number[] = []
    simulator.onUartByte = (byte) => bytes.push(byte)
    thread.fromThread({ type: 'tx', bytes: new Uint8Array([7]) })
    await nextMessage()
    expect(bytes).toEqual([7])

    simulator.stop()
    thread.terminated = false
    thread.fromThread({ type: 'tx', bytes: new Uint8Array([8]) })
    await nextMessage()
    expect(bytes).toEqual([7])
  })

  it('lets a thread start again after a stop, and ignores bytes and requests it cannot use', async () => {
    const channel: { listener: ((message: unknown) => void) | null; posted: unknown[] } = { listener: null, posted: [] }
    serveSimulatorThread(
      {
        post: (message) => channel.posted.push(message),
        onMessage: (listener) => {
          channel.listener = listener
        },
      },
      () => new WasmSimulatorModule(virtualTimers()),
    )
    const send = (message: unknown): void => channel.listener?.(message)
    send({ type: 'rx', bytes: new Uint8Array([1]) })
    send({ type: 'python-read', request: 1, id: 1 })
    send({ type: 'python-write', id: 1, bytes: new Uint8Array([1]) })
    send('nonsense')
    send({ type: 'start', module: fixtureModule() })
    send({ type: 'start', module: fixtureModule() })
    send({ type: 'stop' })
    const started = (): number =>
      channel.posted.filter((message) => parseSimulatorThreadReply(message)?.type === 'started').length
    const deadline = Date.now() + 10000
    while (started() < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started()).toBe(2)
    expect(channel.posted).toContainEqual({ type: 'python-input', request: 1, bytes: null })
  })
})

describe('ThreadedSimulator with a thread that starts later', () => {
  it('waits for the thread, and gives up on it when stopped before it was there', async () => {
    const mechanism = inMemoryThreads()
    let release: () => void = () => undefined
    const late: SimulatorThreadMechanism = {
      spawn: () =>
        new Promise((resolve) => {
          release = () => resolve(mechanism.spawn())
        }),
    }
    const simulator = threaded(late)
    const start = simulator.loadAndRun(fixtureModule())
    await expect(simulator.loadAndRun(fixtureModule())).rejects.toThrow('This simulator run has already started.')
    simulator.stop()
    release()
    await expect(start).rejects.toThrow('The simulator was stopped before it started.')
    expect(mechanism.threads[0].terminated).toBe(true)

    const again = simulator.loadAndRun(fixtureModule())
    release()
    await again
    expect(simulator.isRunning()).toBe(true)
  })

  it('rejects a start that is stopped after the thread exists but before the module started', async () => {
    const mechanism = inMemoryThreads(false)
    const simulator = threaded(mechanism)
    const start = simulator.loadAndRun(fixtureModule())
    await nextMessage()
    expect(mechanism.threads).toHaveLength(1)

    simulator.stop()

    await expect(start).rejects.toThrow('The simulator was stopped before it started.')
    expect(mechanism.threads[0].terminated).toBe(true)
    expect(simulator.isRunning()).toBe(false)
  })

  it('rejects the start when the thread cannot be started at all', async () => {
    const simulator = threaded({ spawn: () => Promise.reject(new Error('no workers here')) })
    await expect(simulator.loadAndRun(fixtureModule())).rejects.toThrow('no workers here')
    await expect(simulator.loadAndRun(fixtureModule())).rejects.toThrow('no workers here')
  })
})

describe('simulator thread messages', () => {
  it('accepts only well-formed requests', () => {
    const module = new Uint8Array([0])
    expect(parseSimulatorThreadRequest({ type: 'start', module })).toEqual({ type: 'start', module })
    expect(parseSimulatorThreadRequest({ type: 'rx', bytes: module })).toEqual({ type: 'rx', bytes: module })
    expect(parseSimulatorThreadRequest({ type: 'stop' })).toEqual({ type: 'stop' })
    expect(parseSimulatorThreadRequest({ type: 'start', module: 'x' })).toBeNull()
    expect(parseSimulatorThreadRequest({ type: 'rx', bytes: new DataView(new ArrayBuffer(1)) })).toBeNull()
    expect(parseSimulatorThreadRequest(null)).toBeNull()
    expect(parseSimulatorThreadRequest({ type: 'python-read', request: 3, id: 1 })).toEqual({
      type: 'python-read',
      request: 3,
      id: 1,
    })
    expect(parseSimulatorThreadRequest({ type: 'python-write', id: 1, bytes: module })).toEqual({
      type: 'python-write',
      id: 1,
      bytes: module,
    })
    expect(parseSimulatorThreadRequest({ type: 'python-read', request: -1, id: 1 })).toBeNull()
    expect(parseSimulatorThreadRequest({ type: 'python-write', id: 1.5, bytes: module })).toBeNull()
  })

  it('accepts only well-formed replies', () => {
    const bytes = new Uint8Array([1])
    expect(parseSimulatorThreadReply({ type: 'started' })).toEqual({ type: 'started' })
    expect(parseSimulatorThreadReply({ type: 'start-failed', message: 'x' })).toEqual({
      type: 'start-failed',
      message: 'x',
    })
    expect(parseSimulatorThreadReply({ type: 'tx', bytes })).toEqual({ type: 'tx', bytes })
    expect(parseSimulatorThreadReply({ type: 'log', line: 'a', stream: 'stderr' })).toEqual({
      type: 'log',
      line: 'a',
      stream: 'stderr',
    })
    expect(parseSimulatorThreadReply({ type: 'stopped', reason: 'r' })).toEqual({ type: 'stopped', reason: 'r' })
    const block = { id: 1, name: 'B', script: 's', outputSeed: bytes }
    expect(parseSimulatorThreadReply({ type: 'python-block', ...block })).toEqual({ type: 'python-block', ...block })
    expect(parseSimulatorThreadReply({ type: 'python-input', request: 2, bytes })).toEqual({
      type: 'python-input',
      request: 2,
      bytes,
    })
    expect(parseSimulatorThreadReply({ type: 'python-input', request: 2, bytes: null })).toEqual({
      type: 'python-input',
      request: 2,
      bytes: null,
    })
    for (const bad of [
      { type: 'python-block', ...block, script: 1 },
      { type: 'python-input', request: 2, bytes: 'x' },
      { type: 'start-failed' },
      { type: 'tx', bytes: [1] },
      { type: 'log', line: 'a', stream: 'other' },
      { type: 'stopped' },
      { type: 'other' },
      7,
    ]) {
      expect(parseSimulatorThreadReply(bad)).toBeNull()
    }
  })
})
