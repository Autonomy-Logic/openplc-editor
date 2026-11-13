/**
 * @jest-environment node
 * @vitest-environment node
 */
import { describe, expect, it } from '@jest/globals'

import type { SimulatorPythonBlock, SimulatorPythonBus } from '../../simulator/wasm-simulator-module'
import {
  fromHex,
  PYTHON_EXCHANGE_INTERVAL_MS,
  PythonBlockHost,
  type PythonHostTimers,
  toHex,
} from '../python-block-host'
import type { PythonInterpreters } from '../python-thread'
import type { PythonExit, PythonProcess } from '../wasmer-python-runtime'

class FakeProcess implements PythonProcess {
  onStdout: ((line: string) => void) | null = null
  onStderr: ((line: string) => void) | null = null
  onExit: ((exit: PythonExit) => void) | null = null
  readonly written: string[] = []
  killed = false

  write(text: string): void {
    this.written.push(text)
  }

  kill(): void {
    this.killed = true
    this.onExit?.({ kind: 'killed' })
  }

  /** The marker the host sent, from its second write. */
  get marker(): string {
    return this.written[1].split('\n')[0]
  }

  reply(outputs: Uint8Array): void {
    this.onStdout?.(`@@${this.marker} ${toHex(outputs)}`)
  }
}

function fakeInterpreters(fail = false): PythonInterpreters & { started: FakeProcess[] } {
  const started: FakeProcess[] = []
  return {
    started,
    spawn: () => {
      if (fail) return Promise.reject(new Error('no runtime'))
      const process = new FakeProcess()
      started.push(process)
      return Promise.resolve(process)
    },
  }
}

function manualTimers(): PythonHostTimers & { advance(ms: number): void } {
  let now = 0
  let pending: Array<{ at: number; callback: () => void }> = []
  return {
    schedule: (callback, delayMs) => {
      const entry = { at: now + delayMs, callback }
      pending.push(entry)
      return () => {
        pending = pending.filter((other) => other !== entry)
      }
    },
    advance: (ms) => {
      now += ms
      const due = pending.filter((entry) => entry.at <= now)
      pending = pending.filter((entry) => entry.at > now)
      for (const entry of due) entry.callback()
    },
  }
}

interface FakeBus extends SimulatorPythonBus {
  inputs: Map<number, Uint8Array | null>
  outputs: Array<{ id: number; bytes: Uint8Array }>
  reads: number
  announce(block: SimulatorPythonBlock): void
}

function fakeBus(): FakeBus {
  const bus: FakeBus = {
    onPythonBlock: null,
    inputs: new Map(),
    outputs: [],
    reads: 0,
    readPythonInput: (id) => {
      bus.reads++
      return Promise.resolve(bus.inputs.has(id) ? (bus.inputs.get(id) ?? null) : new Uint8Array([0]))
    },
    writePythonOutput: (id, bytes) => bus.outputs.push({ id, bytes }),
    announce: (block) => bus.onPythonBlock?.(block),
  }
  return bus
}

const block = (id: number, name = 'Doubler', script = 'print("é")'): SimulatorPythonBlock => ({
  id,
  name,
  script,
  outputSeed: new Uint8Array([0x2a, 0]),
})

const settle = async (): Promise<void> => {
  for (let n = 0; n < 5; n++) await Promise.resolve()
}

function setUp(fail = false) {
  const interpreters = fakeInterpreters(fail)
  const timers = manualTimers()
  const host = new PythonBlockHost(interpreters, timers)
  const lines: Array<{ line: string; stream: string }> = []
  host.onLog = (line, stream) => lines.push({ line, stream })
  const bus = fakeBus()
  host.attach(bus)
  return { interpreters, timers, host, lines, bus }
}

describe('PythonBlockHost', () => {
  it('boots the block with its name, script length and script, then the marker and its seeded outputs', async () => {
    const { interpreters, bus } = setUp()
    bus.inputs.set(1, new Uint8Array([5, 0]))
    bus.announce(block(1))
    await settle()

    const [process] = interpreters.started
    expect(process.written[0]).toBe('Doubler\n11\nprint("é")')
    expect(process.written[1]).toMatch(/^[0-9a-f]{16}\n2a00\n$/)
    expect(process.written[2]).toBe('0500\n')
  })

  it('stores each reply and sends the next inputs 100 ms after it, never before', async () => {
    const { interpreters, timers, bus } = setUp()
    bus.announce(block(1))
    await settle()
    const [process] = interpreters.started

    process.reply(new Uint8Array([0x0a, 0]))
    expect(bus.outputs).toEqual([{ id: 1, bytes: new Uint8Array([0x0a, 0]) }])
    timers.advance(PYTHON_EXCHANGE_INTERVAL_MS - 1)
    await settle()
    expect(bus.reads).toBe(1)
    timers.advance(1)
    await settle()
    expect(bus.reads).toBe(2)
    expect(process.written).toHaveLength(4)
  })

  it('waits for a block that has not answered, so one in an endless loop gets no more inputs', async () => {
    const { timers, bus } = setUp()
    bus.announce(block(1))
    await settle()
    timers.advance(10 * PYTHON_EXCHANGE_INTERVAL_MS)
    await settle()
    expect(bus.reads).toBe(1)
  })

  it('puts the block name before its output and its errors', async () => {
    const { interpreters, lines, bus } = setUp()
    bus.announce(block(1))
    await settle()
    interpreters.started[0].onStdout?.('count=3')
    interpreters.started[0].onStderr?.('Traceback (most recent call last):')
    expect(lines).toEqual([
      { line: '[Doubler] count=3', stream: 'stdout' },
      { line: '[Doubler] Traceback (most recent call last):', stream: 'stderr' },
    ])
  })

  it('tells instances of the same block apart', async () => {
    const { interpreters, lines, bus } = setUp()
    bus.announce(block(1))
    bus.announce(block(2))
    await settle()
    interpreters.started[1].onStdout?.('hi')
    expect(lines).toEqual([{ line: '[Doubler #2] hi', stream: 'stdout' }])
  })

  it('reports a block that ends with an error and stops exchanging with it, so its outputs keep their values', async () => {
    const { interpreters, timers, lines, bus } = setUp()
    bus.announce(block(1))
    await settle()
    interpreters.started[0].onExit?.({ kind: 'exited', code: 1 })
    timers.advance(PYTHON_EXCHANGE_INTERVAL_MS)
    await settle()
    expect(lines).toEqual([
      { line: '[Doubler] Python block exited with code 1; its outputs keep their last values.', stream: 'stderr' },
    ])
    interpreters.started[0].onStdout?.(`@@${interpreters.started[0].marker} 0100`)
    expect(bus.outputs).toEqual([])
  })

  it('reports a block whose interpreter failed under it, with the reason', async () => {
    const { interpreters, lines, bus } = setUp()
    bus.announce(block(1))
    await settle()
    interpreters.started[0].onExit?.({
      kind: 'failed',
      reason: 'RuntimeError: call_indirect to a signature that does not match',
    })
    expect(lines).toEqual([
      {
        line: '[Doubler] Python block stopped: RuntimeError: call_indirect to a signature that does not match; its outputs keep their last values.',
        stream: 'stderr',
      },
    ])
  })

  it('ends every block on stop, without reporting them as failures', async () => {
    const { interpreters, host, lines, bus } = setUp()
    bus.announce(block(1))
    bus.announce(block(2, 'Other'))
    await settle()
    host.stop()
    expect(interpreters.started.map((process) => process.killed)).toEqual([true, true])
    expect(lines).toEqual([])
  })

  it('stops a block whose run is gone', async () => {
    const { interpreters, bus } = setUp()
    bus.inputs.set(1, null)
    bus.announce(block(1))
    await settle()
    expect(interpreters.started[0].killed).toBe(true)
  })

  it('stops a block that answers with something that is not hex', async () => {
    const { interpreters, lines, bus } = setUp()
    bus.announce(block(1))
    await settle()
    interpreters.started[0].onStdout?.(`@@${interpreters.started[0].marker} zz`)
    expect(interpreters.started[0].killed).toBe(true)
    expect(lines[0].stream).toBe('stderr')
    expect(bus.outputs).toEqual([])
  })

  it('reports a block whose interpreter cannot start', async () => {
    const { lines, bus } = setUp(true)
    bus.announce(block(1))
    await settle()
    expect(lines).toEqual([{ line: '[Doubler] Python could not start: no runtime', stream: 'stderr' }])
  })
})

describe('PythonBlockHost.prepare', () => {
  it('starts interpreters ahead and gives them to the next blocks', async () => {
    const interpreters = fakeInterpreters()
    const host = new PythonBlockHost(interpreters, manualTimers())
    await host.prepare(2)
    await host.prepare(2)
    expect(interpreters.started).toHaveLength(2)

    const bus = fakeBus()
    host.attach(bus)
    bus.announce(block(1))
    bus.announce(block(2))
    bus.announce(block(3))
    await settle()
    expect(interpreters.started).toHaveLength(3)
    expect(interpreters.started[0].written[0]).toMatch(/^Doubler\n/)
  })

  it('keeps idle interpreters across a stop, and forgets one that ends', async () => {
    const interpreters = fakeInterpreters()
    const host = new PythonBlockHost(interpreters, manualTimers())
    await host.prepare(2)
    host.stop()
    interpreters.started[1].onExit?.({ kind: 'exited', code: 0 })
    await host.prepare(2)
    expect(interpreters.started).toHaveLength(3)
  })

  it('reports interpreters that cannot be prepared and still resolves', async () => {
    const host = new PythonBlockHost(fakeInterpreters(true), manualTimers())
    const lines: string[] = []
    host.onLog = (line) => lines.push(line)
    await host.prepare(1)
    await host.ready()
    expect(lines).toEqual(['Python could not be prepared: no runtime'])
  })

  it('keeps an interpreter that arrives after the run it was for ended', async () => {
    let release: (process: FakeProcess) => void = () => undefined
    const late = new FakeProcess()
    const host = new PythonBlockHost(
      { spawn: () => new Promise<PythonProcess>((resolve) => (release = resolve)) },
      manualTimers(),
    )
    const bus = fakeBus()
    host.attach(bus)
    bus.announce(block(1))
    host.stop()
    release(late)
    await settle()
    expect(late.written).toEqual([])

    const next = fakeBus()
    host.attach(next)
    next.announce(block(5))
    await settle()
    expect(late.written[0]).toMatch(/^Doubler\n/)
  })
})

describe('hex', () => {
  it('round-trips bytes and refuses what is not hex', () => {
    expect(fromHex(toHex(new Uint8Array([0, 15, 255])))).toEqual(new Uint8Array([0, 15, 255]))
    expect(fromHex('abc')).toBeNull()
    expect(fromHex('zz')).toBeNull()
    expect(fromHex('')).toEqual(new Uint8Array())
  })
})

describe('PythonBlockHost interpreter limit', () => {
  const LIMIT_LINE =
    "[Doubler #3] Python block not started: this run already uses 2 Python interpreters, the most this computer's memory allows; it and any further blocks keep their initial outputs."

  it('prepares no more interpreters than the limit', async () => {
    const interpreters = fakeInterpreters()
    const host = new PythonBlockHost(interpreters, manualTimers(), 3)
    await host.prepare(5)
    expect(interpreters.started).toHaveLength(3)
  })

  it('leaves the blocks beyond the limit idle, says so once per run, and runs the others', async () => {
    const interpreters = fakeInterpreters()
    const host = new PythonBlockHost(interpreters, manualTimers(), 2)
    const lines: string[] = []
    host.onLog = (line) => lines.push(line)
    await host.prepare(4)
    const bus = fakeBus()
    host.attach(bus)
    for (let id = 1; id <= 4; id++) bus.announce(block(id))
    await settle()

    expect(interpreters.started).toHaveLength(2)
    expect(interpreters.started.every((process) => process.written.length > 0)).toBe(true)
    expect(lines).toEqual([LIMIT_LINE])

    host.stop()
    const next = fakeBus()
    host.attach(next)
    for (let id = 1; id <= 3; id++) next.announce(block(id))
    await settle()
    expect(lines).toEqual([LIMIT_LINE, LIMIT_LINE])
  })

  it('gives the room of a block that ended to the next block', async () => {
    const interpreters = fakeInterpreters()
    const host = new PythonBlockHost(interpreters, manualTimers(), 1)
    host.onLog = () => undefined
    const bus = fakeBus()
    host.attach(bus)
    bus.announce(block(1))
    await settle()
    bus.announce(block(2))
    await settle()
    expect(interpreters.started).toHaveLength(1)

    interpreters.started[0].onExit?.({ kind: 'exited', code: 0 })
    bus.announce(block(3))
    await settle()
    expect(interpreters.started).toHaveLength(2)
  })
})
