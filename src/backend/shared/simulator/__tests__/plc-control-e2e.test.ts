/**
 * End-to-end validation of the baremetal run/stop state machine over avr8js.
 *
 * Boots simulator firmware in avr8js and exercises the run/stop wire protocol against it:
 * query, stop, output de-energisation, program re-initialisation, restart, and
 * that the debug channel survives a stop.
 *
 * The firmware must be built first, by the editor's own compile pipeline. Same
 * gating style as debug-e2e.test.ts: the test skips unless the artefacts are
 * pointed at, so CI without an AVR toolchain stays green.
 *
 *   PLC_CONTROL_HEX=/path/to/Baremetal.ino.hex \
 *   PLC_CONTROL_DEBUG_MAP=/path/to/debug-map.json \
 *   npx jest src/backend/shared/simulator/__tests__/plc-control-e2e.test.ts
 *
 * The firmware must be built from a program with a `counter : INT := 0`
 * variable incremented every scan and a `pulse AT %QX0.0 : BOOL` driven
 * unconditionally TRUE -- `counter` proves execution and re-init, `pulse`
 * proves the stop clamp.
 */

import fs from 'node:fs'
import path from 'node:path'

import { ModbusRtuClient } from '../modbus-rtu-client'
import { SimulatorModule } from '../simulator-module'
import { PlcRuntimeState, PlcSwitchPosition } from '../types'
import { VirtualSerialPort } from '../virtual-serial-port'

// jsdom polyfill -- matches modbus-rtu-client.test.ts.
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder
}

const HEX_PATH = process.env.PLC_CONTROL_HEX ?? ''
const MAP_PATH = process.env.PLC_CONTROL_DEBUG_MAP ?? ''
const ENABLED = HEX_PATH !== '' && MAP_PATH !== '' && fs.existsSync(HEX_PATH) && fs.existsSync(MAP_PATH)
const describeIfEnabled: typeof describe = ENABLED ? describe : describe.skip

// Second firmware, built from the same program but with a HAL that overrides
// `hardwareStateSwitch()` to read STOP for the first 3 seconds of uptime and
// RUN afterwards. Exercises the paths a switchless board can't reach.
const SWITCH_HEX_PATH = process.env.PLC_CONTROL_SWITCH_HEX ?? ''
const SWITCH_ENABLED = SWITCH_HEX_PATH !== '' && fs.existsSync(SWITCH_HEX_PATH)
const describeIfSwitch: typeof describe = SWITCH_ENABLED ? describe : describe.skip

/** Resolve a variable path from debug-map.json into the packed
 *  `(arr << 16) | elem` address the debug FCs take. */
function resolveDebugAddr(debugMapJson: string, pathSuffix: string): number {
  const map = JSON.parse(debugMapJson) as {
    leaves: Array<{ arrayIdx: number; elemIdx: number; path: string }>
  }
  const leaf = map.leaves.find((l) => l.path.toUpperCase().endsWith(pathSuffix.toUpperCase()))
  if (!leaf) {
    throw new Error(`No debug leaf matching "${pathSuffix}". Available: ${map.leaves.map((l) => l.path).join(', ')}`)
  }
  return (leaf.arrayIdx << 16) | leaf.elemIdx
}

describeIfEnabled('Baremetal run/stop state machine end-to-end (FC 0x4b + 0x46 over avr8js)', () => {
  let sim: SimulatorModule
  let client: ModbusRtuClient
  let counterAddr: number
  let pulseAddr: number

  /** Read a single variable's raw bytes via FC 0x44. */
  async function readVar(addr: number): Promise<Uint8Array> {
    const res = await client.getVariablesList([addr])
    if (!res.success || !res.data) throw new Error(`getVariablesList failed: ${res.error ?? 'no data'}`)
    return res.data
  }

  async function readCounter(): Promise<number> {
    // FC 0x44's payload is the requested variables' raw bytes concatenated,
    // with no per-variable size prefix. One INT => 2 bytes, little-endian.
    const data = await readVar(counterAddr)
    expect(data.length).toBe(2)
    return data[0] | (data[1] << 8)
  }

  async function readPulse(): Promise<number> {
    const data = await readVar(pulseAddr)
    expect(data.length).toBe(1)
    return data[0]
  }

  /** Let the target run for a while in real time so scan cycles elapse. */
  async function settle(ms = 400): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  beforeAll(async () => {
    const hex = fs.readFileSync(path.resolve(HEX_PATH), 'utf-8')
    const debugMapJson = fs.readFileSync(path.resolve(MAP_PATH), 'utf-8')
    counterAddr = resolveDebugAddr(debugMapJson, 'counter')
    pulseAddr = resolveDebugAddr(debugMapJson, 'pulse')

    sim = new SimulatorModule()
    sim.loadAndRun(hex)
    client = new ModbusRtuClient({ slaveId: 1, timeout: 5000, serialPort: new VirtualSerialPort(sim) })
    await client.connect()
  }, 600000)

  afterAll(() => {
    client?.disconnect()
    sim?.stop()
  })

  it('boots RUNNING with the virtual switch in RUN', async () => {
    const state = await client.getStatus()
    expect(state.success).toBe(true)
    expect(state.plcState).toBe(PlcRuntimeState.RUNNING)
    // The simulator HAL implements no hardwareStateSwitch() override, so the
    // weak default must report RUN -- this is the "nothing changes for boards
    // that opt out" guarantee.
    expect(state.switchPosition).toBe(PlcSwitchPosition.RUN)
  }, 30000)

  it('executes the program while running', async () => {
    const first = await readCounter()
    await settle()
    const second = await readCounter()
    expect(second).not.toBe(first)
  }, 30000)

  it('drives the located output TRUE while running', async () => {
    expect(await readPulse()).toBe(1)
  }, 30000)

  it('run/stop command STOPs the PLC to STOPPED', async () => {
    const res = await client.setPlcState(PlcRuntimeState.STOPPED)
    expect(res.success).toBe(true)
    await settle()
    const state = await client.getStatus()
    expect(state.plcState).toBe(PlcRuntimeState.STOPPED)
  }, 30000)

  it('freezes the program while stopped', async () => {
    const first = await readCounter()
    await settle()
    expect(await readCounter()).toBe(first)
  }, 30000)

  it('de-energises the located output while stopped', async () => {
    expect(await readPulse()).toBe(0)
  }, 30000)

  it('re-initialised the program on the STOP edge', async () => {
    // counter is declared `INT := 0` and increments every scan, so a value of
    // 0 while stopped can only come from the STOP-edge re-init.
    expect(await readCounter()).toBe(0)
  }, 30000)

  it('run/stop command RUNs it again, from cycle 1', async () => {
    const res = await client.setPlcState(PlcRuntimeState.RUNNING)
    expect(res.success).toBe(true)
    expect(res.refusedBySwitch).toBeFalsy()
    await settle()

    const state = await client.getStatus()
    expect(state.plcState).toBe(PlcRuntimeState.RUNNING)

    // Counting resumed, and the output is driven again.
    const first = await readCounter()
    await settle()
    expect(await readCounter()).not.toBe(first)
    expect(await readPulse()).toBe(1)
  }, 30000)

  it('reading the status never changes state', async () => {
    const before = await client.getStatus()
    const after = await client.getStatus()
    expect(after.plcState).toBe(before.plcState)
    expect(after.switchPosition).toBe(before.switchPosition)
  }, 30000)

  it('keeps the debug channel alive across a stop/start cycle', async () => {
    await client.setPlcState(PlcRuntimeState.STOPPED)
    await settle()
    // FC 0x45 must still answer while stopped -- the control channel IS the
    // Modbus link, so it cannot depend on the PLC running.
    const md5 = await client.getMd5Hash()
    expect(md5.md5).toMatch(/^[0-9a-f]{32}$/)
    await client.setPlcState(PlcRuntimeState.RUNNING)
    await settle()
  }, 60000)
})

describeIfSwitch('Hardware mode switch (HAL override, FC 0x4b + 0x46 over avr8js)', () => {
  let sim: SimulatorModule
  let client: ModbusRtuClient

  beforeAll(async () => {
    sim = new SimulatorModule()
    sim.loadAndRun(fs.readFileSync(path.resolve(SWITCH_HEX_PATH), 'utf-8'))
    client = new ModbusRtuClient({ slaveId: 1, timeout: 5000, serialPort: new VirtualSerialPort(sim) })
    // connect() already waits 2.5s for setup(); the override reads STOP until
    // 3s of firmware uptime, so the first assertions land inside the STOP
    // window.
    await client.connect()
  }, 120000)

  afterAll(() => {
    client?.disconnect()
    sim?.stop()
  })

  it('boots STOPPED when the switch reads STOP, and reports the position', async () => {
    const state = await client.getStatus()
    expect(state.success).toBe(true)
    expect(state.switchPosition).toBe(PlcSwitchPosition.STOP)
    expect(state.plcState).toBe(PlcRuntimeState.STOPPED)
  }, 30000)

  it('refuses a RUN request while the switch reads STOP', async () => {
    const res = await client.setPlcState(PlcRuntimeState.RUNNING)
    // Refused, not queued: success is false and the reason is specific enough
    // for the editor to tell the user to flip the switch.
    expect(res.success).toBe(false)
    expect(res.refusedBySwitch).toBe(true)
    expect(res.state).toBe(PlcRuntimeState.STOPPED)
    expect(res.switchPosition).toBe(PlcSwitchPosition.STOP)

    // Still stopped afterwards -- the refusal did not leave a pending start.
    const after = await client.getStatus()
    expect(after.plcState).toBe(PlcRuntimeState.STOPPED)
  }, 30000)

  it('runs by itself on the STOP -> RUN rising edge, with no command sent', async () => {
    // Wait past the override's 3s flip point. Nothing is sent to the target in
    // between: the transition must come from the switch alone (rule 3).
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const state = await client.getStatus()
    expect(state.switchPosition).toBe(PlcSwitchPosition.RUN)
    expect(state.plcState).toBe(PlcRuntimeState.RUNNING)
  }, 30000)

  it('accepts software stop and start once the switch reads RUN', async () => {
    const stopped = await client.setPlcState(PlcRuntimeState.STOPPED)
    expect(stopped.success).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await client.getStatus()).plcState).toBe(PlcRuntimeState.STOPPED)

    const started = await client.setPlcState(PlcRuntimeState.RUNNING)
    expect(started.success).toBe(true)
    expect(started.refusedBySwitch).toBeFalsy()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await client.getStatus()).plcState).toBe(PlcRuntimeState.RUNNING)
  }, 30000)
})
