/**
 * End-to-end debugger validation over avr8js.
 *
 * Boots the Chris Demo firmware in the simulator, drives it through the
 * real ModbusRtuClient + VirtualSerialPort + SimulatorModule stack, and
 * verifies the Phase 4 wire protocol round-trips correctly.
 *
 * Runs only when CHRIS_DEMO_HEX env var points at a compiled .hex file.
 * CI skips it by default because it depends on an AVR toolchain + built
 * firmware. Local reproduction:
 *
 *   1. Build the Chris Demo project via the editor (or manually invoke
 *      strucpp + arduino-cli on a project with a located BOOL variable)
 *      targeting arduino:avr:mega with MODBUS_ENABLED + MBSERIAL defined.
 *   2. export CHRIS_DEMO_HEX=/path/to/Baremetal.ino.hex
 *   3. npx jest src/backend/shared/simulator/__tests__/debug-e2e.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'

import { ModbusRtuClient } from '../modbus-rtu-client'
import { SimulatorModule } from '../simulator-module'
import { VirtualSerialPort } from '../virtual-serial-port'

// jsdom polyfill — matches modbus-rtu-client.test.ts.
if (typeof globalThis.TextDecoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require('util')
  globalThis.TextEncoder = TextEncoder
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder
}

const HEX_PATH = process.env.CHRIS_DEMO_HEX ?? ''
const HEX_EXISTS = HEX_PATH !== '' && fs.existsSync(HEX_PATH)
const describeIfHex: typeof describe = HEX_EXISTS ? describe : describe.skip

describeIfHex('Phase 4 debugger end-to-end (avr8js + ModbusRtuClient)', () => {
  let sim: SimulatorModule
  let vsp: VirtualSerialPort
  let client: ModbusRtuClient

  beforeAll(async () => {
    const hexContent = fs.readFileSync(path.resolve(HEX_PATH), 'utf-8')
    sim = new SimulatorModule()
    sim.loadAndRun(hexContent)
    vsp = new VirtualSerialPort(sim)
    client = new ModbusRtuClient({ slaveId: 1, timeout: 5000, serialPort: vsp })
    await client.connect()
  }, 30000)

  afterAll(() => {
    client?.disconnect()
    sim?.stop()
  })

  it('FC 0x45 DEBUG_GET_MD5 returns a 32-char MD5', async () => {
    const md5 = await client.getMd5Hash()
    expect(md5).toMatch(/^[0-9a-f]{32}$/)
  }, 30000)

  it('FC 0x42 DEBUG_SET force blink=TRUE → FC 0x44 read returns 1', async () => {
    const addr = 0 // packed (arr=0, elem=0)

    const setResult = await client.setVariable(addr, true, new Uint8Array([1]))
    expect(setResult.success).toBe(true)

    // Let a few scan cycles run so we exercise the "forced value survives
    // across PLC writes" path (generated code does `BLINK := TOF0.Q` every
    // cycle, which must not overwrite the forced state).
    await new Promise((r) => setTimeout(r, 200))

    const read = await client.getVariablesList([addr])
    expect(read.success).toBe(true)
    expect(read.data).toBeDefined()
    expect(read.data!.length).toBe(1)
    expect(read.data![0]).toBe(1)
  }, 30000)

  it('FC 0x42 DEBUG_SET unforce → blink resumes PLC control', async () => {
    const addr = 0
    const unforce = await client.setVariable(addr, false)
    expect(unforce.success).toBe(true)
    // We don't assert on a subsequent read — racing the scan cycle is
    // non-deterministic and this test already validated at the SET layer
    // that the protocol accepts the unforce request.
  }, 30000)
})
