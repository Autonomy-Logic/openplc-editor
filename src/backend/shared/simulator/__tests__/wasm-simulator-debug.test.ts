/**
 * The debugger against the real simulator module: the fixture project, compiled by the in-editor toolchain, driven
 * through the shared ModbusRtuClient and VirtualSerialPort exactly as both platforms drive it.
 * @jest-environment node
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from '@jest/globals'

import { ModbusRtuClient } from '../modbus-rtu-client'
import { PlcRuntimeState } from '../types'
import { VirtualSerialPort } from '../virtual-serial-port'
import { type SimulatorTimers, WasmSimulatorModule } from '../wasm-simulator-module'
import { debugIndex, FIXTURE_MD5, fixtureModule, readInt, virtualTimers } from './fixtures/simulator-fixture'

type TestTimers = SimulatorTimers & { elapsedMs: () => number }

interface Session<T extends TestTimers = TestTimers> {
  simulator: WasmSimulatorModule
  client: ModbusRtuClient
  timers: T
}

const sessions: Session[] = []

async function start(): Promise<Session>
async function start<T extends TestTimers>(timers: T): Promise<Session<T>>
async function start(timers: TestTimers = virtualTimers()): Promise<Session> {
  const simulator = new WasmSimulatorModule(timers)
  await simulator.loadAndRun(fixtureModule())
  const client = new ModbusRtuClient({
    slaveId: 1,
    timeout: 5000,
    readyDelayMs: 0,
    serialPort: new VirtualSerialPort(simulator),
  })
  await client.connect()
  const session = { simulator, client, timers }
  sessions.push(session)
  return session
}

afterEach(() => {
  for (const { client, simulator } of sessions.splice(0)) {
    client.disconnect()
    simulator.stop()
  }
})

async function read(client: ModbusRtuClient, path: string, size: number): Promise<number> {
  const result = await client.getVariablesList([debugIndex(path)])
  if (!result.success || !result.data) throw new Error(result.error ?? 'no data')
  return readInt(result.data, 0, size)
}

async function until(condition: () => Promise<boolean>, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('The condition was never met.')
}

/**
 * Virtual timers whose wall clock also jumps ahead once, after `jumpAfter` callbacks, as a hidden tab's clock does.
 * After every callback they record how far the watched simulated time is ahead of the wall clock.
 */
function jumpingTimers(jumpAfter: number, jumpMs: number) {
  let now = 0
  let callbacks = 0
  let simulatedMs: () => number = () => 0
  let maxLeadMs = Number.NEGATIVE_INFINITY
  let simulatedMsAtJump = Number.NaN
  const timers: TestTimers = {
    now: () => now,
    elapsedMs: () => now,
    schedule: (callback, delayMs) => {
      const handle = setImmediate(() => {
        now += delayMs
        if (++callbacks === jumpAfter) {
          now += jumpMs
          simulatedMsAtJump = simulatedMs()
        }
        callback()
        maxLeadMs = Math.max(maxLeadMs, simulatedMs() - now)
      })
      return () => clearImmediate(handle)
    },
  }
  return {
    ...timers,
    watch: (source: () => number) => {
      simulatedMs = source
    },
    maxLeadMs: () => maxLeadMs,
    simulatedMsAtJump: () => simulatedMsAtJump,
  }
}

async function force(client: ModbusRtuClient, path: string, value: number): Promise<void> {
  const result = await client.setVariable(debugIndex(path), true, new Uint8Array([value]))
  if (!result.success) throw new Error(result.error ?? 'the force was refused')
}

async function setState(
  client: ModbusRtuClient,
  state: PlcRuntimeState.RUNNING | PlcRuntimeState.STOPPED,
): Promise<void> {
  expect((await client.setPlcState(state)).success).toBe(true)
  const running = state === PlcRuntimeState.RUNNING
  await until(async () => (await client.getStatus()).running === running)
}

describe('WebAssembly simulator through the debugger', () => {
  it('reports the program MD5 of the build and the target byte order', async () => {
    const { client } = await start()
    await expect(client.getMd5Hash()).resolves.toEqual({ md5: FIXTURE_MD5, targetEndian: 'le' })
  })

  it('reports a running PLC whose tick advances, and the runtime version', async () => {
    const { client } = await start()
    const first = await client.getStatus()
    expect(first.success).toBe(true)
    expect(first.running).toBe(true)
    await until(async () => ((await client.getStatus()).tick ?? 0) > (first.tick ?? 0))
    const version = await client.getVersion()
    expect(version.success).toBe(true)
    expect(version.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('forces a variable, sees the program use it, and releases it', async () => {
    const { client } = await start()
    expect((await client.setVariable(debugIndex('INSTANCE0.FORCE_ME'), true, new Uint8Array([1]))).success).toBe(true)
    await until(async () => (await read(client, 'INSTANCE0.MIRROR', 1)) === 1)
    expect(await read(client, 'INSTANCE0.FORCE_ME', 1)).toBe(1)

    expect((await client.setVariable(debugIndex('INSTANCE0.FORCE_ME'), false)).success).toBe(true)
    expect((await client.setVariable(debugIndex('INSTANCE0.FORCE_ME'), true, new Uint8Array([0]))).success).toBe(true)
    await until(async () => (await read(client, 'INSTANCE0.MIRROR', 1)) === 0)
  })

  it('treats located variables as plain variables: an input keeps what is forced, an output what the program writes', async () => {
    const { client } = await start()
    const value = new Uint8Array([0x34, 0x12])
    expect((await client.setVariable(debugIndex('INSTANCE0.IN_W'), true, value)).success).toBe(true)
    await until(async () => (await read(client, 'INSTANCE0.IN_COPY', 2)) === 0x1234)

    expect((await client.setVariable(debugIndex('INSTANCE0.FORCE_ME'), true, new Uint8Array([1]))).success).toBe(true)
    await until(async () => (await read(client, 'INSTANCE0.OUT_Q', 1)) === 1)
  })

  it('runs a program far beyond the old 8 KB of memory and reads the last element of its 80 KB array', async () => {
    const { client } = await start()
    await until(async () => (await read(client, 'INSTANCE0.COUNTER', 4)) > 20000, 60000)
    expect(await read(client, 'INSTANCE0.BIG[19999]', 4)).toBe(19999)
    expect(await read(client, 'INSTANCE0.BIG[0]', 4)).toBe(20000)
  }, 60000)

  it('fires a TON T#1s on a T#20ms task 50 scans after its input rose, and never runs ahead of the wall clock', async () => {
    const { client, simulator, timers } = await start()
    await until(async () => (await read(client, 'INSTANCE0.FIRED', 1)) === 1)
    expect(await read(client, 'INSTANCE0.FIRED_AT_SCAN', 4)).toBe(51)
    expect(simulator.simulatedTimeUs / 1000).toBeLessThanOrEqual(timers.elapsedMs())
  })

  it('starts every run from initial values, RETAIN variables included', async () => {
    const first = await start()
    await until(async () => (await read(first.client, 'INSTANCE0.KEPT', 4)) > 30)
    first.client.disconnect()
    first.simulator.stop()

    const second = await start()
    const both = await second.client.getVariablesList([debugIndex('INSTANCE0.KEPT'), debugIndex('INSTANCE0.COUNTER')])
    if (!both.success || !both.data) throw new Error(both.error ?? 'no data')
    expect(readInt(both.data, 0, 4)).toBe(readInt(both.data, 4, 4))
  })

  it('stops and restarts the PLC through the run/stop function code', async () => {
    const { client } = await start()
    expect((await client.setPlcState(PlcRuntimeState.STOPPED)).success).toBe(true)
    await until(async () => (await client.getStatus()).running === false)
    const stoppedAt = await read(client, 'INSTANCE0.COUNTER', 4)
    expect(await read(client, 'INSTANCE0.COUNTER', 4)).toBe(stoppedAt)

    expect((await client.setPlcState(PlcRuntimeState.RUNNING)).success).toBe(true)
    await until(async () => (await read(client, 'INSTANCE0.COUNTER', 4)) > stoppedAt)
  })

  it('de-energises the outputs while stopped, re-initialises the program on the STOP edge and drives them again on RUN', async () => {
    const { client } = await start()
    await force(client, 'INSTANCE0.FORCE_ME', 1)
    await until(async () => (await read(client, 'INSTANCE0.OUT_Q', 1)) === 1)
    await until(async () => (await read(client, 'INSTANCE0.COUNTER', 4)) > 10)

    await setState(client, PlcRuntimeState.STOPPED)

    expect(await read(client, 'INSTANCE0.OUT_Q', 1)).toBe(0)
    expect(await read(client, 'INSTANCE0.COUNTER', 4)).toBe(0)
    expect(await read(client, 'INSTANCE0.MIRROR', 1)).toBe(0)
    expect(await read(client, 'INSTANCE0.FIRED', 1)).toBe(0)

    await setState(client, PlcRuntimeState.RUNNING)
    await until(async () => (await read(client, 'INSTANCE0.COUNTER', 4)) > 0)
    await force(client, 'INSTANCE0.FORCE_ME', 1)
    await until(async () => (await read(client, 'INSTANCE0.OUT_Q', 1)) === 1)
  })

  it('keeps the outputs de-energised for as long as the PLC stays stopped', async () => {
    const { client, simulator } = await start()
    await setState(client, PlcRuntimeState.STOPPED)
    await force(client, 'INSTANCE0.FORCE_ME', 1)
    const scans = simulator.scanCount

    await until(async () => simulator.scanCount > scans + 20)

    expect(await read(client, 'INSTANCE0.OUT_Q', 1)).toBe(0)
    expect(await read(client, 'INSTANCE0.MIRROR', 1)).toBe(0)
    expect(await read(client, 'INSTANCE0.COUNTER', 4)).toBe(0)
  })

  it('answers status reads without changing the run/stop state', async () => {
    const { client, simulator } = await start()
    for (let n = 0; n < 3; n++) expect((await client.getStatus()).running).toBe(true)
    const counter = await read(client, 'INSTANCE0.COUNTER', 4)
    await until(async () => (await read(client, 'INSTANCE0.COUNTER', 4)) > counter)

    await setState(client, PlcRuntimeState.STOPPED)
    const scans = simulator.scanCount
    for (let n = 0; n < 3; n++) {
      const status = await client.getStatus()
      expect(status.success).toBe(true)
      expect(status.running).toBe(false)
    }
    await until(async () => simulator.scanCount > scans + 20)

    expect((await client.getStatus()).running).toBe(false)
    expect(await read(client, 'INSTANCE0.COUNTER', 4)).toBe(0)
  })

  it('answers the program MD5 while the PLC is stopped', async () => {
    const { client } = await start()
    await setState(client, PlcRuntimeState.STOPPED)

    await expect(client.getMd5Hash()).resolves.toEqual({ md5: FIXTURE_MD5, targetEndian: 'le' })
    expect((await client.getStatus()).running).toBe(false)
  })

  it('fires a TON T#1s 50 scans after its input rose when the wall clock jumps mid-run, never ahead of the wall clock', async () => {
    const jumpMs = 10_000
    const timers = jumpingTimers(40, jumpMs)
    const { client, simulator } = await start(timers)
    timers.watch(() => simulator.simulatedTimeUs / 1000)

    await until(async () => (await read(client, 'INSTANCE0.FIRED', 1)) === 1)

    expect(await read(client, 'INSTANCE0.FIRED_AT_SCAN', 4)).toBe(51)
    expect(timers.simulatedMsAtJump()).toBeLessThan(1000)
    expect(timers.maxLeadMs()).toBeLessThanOrEqual(0)
    expect(timers.elapsedMs() - simulator.simulatedTimeUs / 1000).toBeGreaterThanOrEqual(jumpMs)
  })
})
