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
import { WasmSimulatorModule } from '../wasm-simulator-module'
import { debugIndex, FIXTURE_MD5, fixtureModule, readInt, virtualTimers } from './fixtures/simulator-fixture'

interface Session {
  simulator: WasmSimulatorModule
  client: ModbusRtuClient
  timers: ReturnType<typeof virtualTimers>
}

const sessions: Session[] = []

async function start(): Promise<Session> {
  const timers = virtualTimers()
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
})
