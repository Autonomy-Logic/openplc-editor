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

  it('FC 0x45 DEBUG_GET_MD5 returns a 32-char MD5 and the target endianness', async () => {
    // `getMd5Hash` returns an `Md5ProbeResult`, not a bare string — the probe
    // reads the endianness marker off the same frame. Asserting `toMatch` on
    // the whole object silently passed for as long as it returned a string and
    // has failed ever since; nothing caught it because this suite only runs
    // with CHRIS_DEMO_HEX set, which CI never does.
    const probe = await client.getMd5Hash()
    expect(probe.md5).toMatch(/^[0-9a-f]{32}$/)
    expect(probe.targetEndian).toBe('le')
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

  it('FC 0x46 DEBUG_GET_STATUS reports the PLC running with an advancing tick', async () => {
    const first = await client.getStatus()
    expect(first.success).toBe(true)
    expect(first.running).toBe(true)
    expect(typeof first.tick).toBe('number')
    expect(typeof first.uptimeMs).toBe('number')

    // Let a few scan cycles run — the scan counter must advance.
    await new Promise((r) => setTimeout(r, 200))
    const second = await client.getStatus()
    expect(second.success).toBe(true)
    expect(second.tick!).toBeGreaterThan(first.tick!)
  }, 30000)

  it('FC 0x47 DEBUG_GET_VERSION returns the runtime version string', async () => {
    const result = await client.getVersion()
    expect(result.success).toBe(true)
    // OPENPLC_RUNTIME_VERSION is a dotted version like "4.2.7".
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/)
  }, 30000)

  it('FC 0x48 DEBUG_GET_BOARD_ID answers a well-formed reply with no id', async () => {
    const result = await client.getBoardId()
    // ArduinoUniqueID would work on AVR — it reports 9 bytes on an
    // ATmega2560 — but the simulator is not licensable, so the build defines
    // OPENPLC_NO_UNIQUE_ID and the library never enters the firmware. A
    // unique id exists only to bind a paid VPP licence to a board, and a
    // simulated board cannot hold one.
    //
    // What matters is that the FRAME is still valid: SUCCESS status, id_len
    // 0, no trailing bytes. `device-probe` reads the successful reply (not
    // the id bytes) as proof of firmware, so an empty id must not look like
    // a protocol error.
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.boardId).toHaveLength(0)
    expect(result.boardIdHex).toBe('')
  }, 30000)
})
