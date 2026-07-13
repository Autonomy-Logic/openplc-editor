/**
 * End-to-end license-storage round-trip over avr8js (OLS T16).
 *
 * Boots a firmware image built with the `license_store_avr` backend active in
 * the simulator, drives it through the real ModbusRtuClient + VirtualSerialPort
 * + SimulatorModule stack, and verifies the on-device license store round-trips
 * the golden blob byte-for-byte (design.md §5.2). See §5.3 for the integrity
 * states this exercises on real hardware.
 *
 * Runs only when LICENSE_STORE_HEX env var points at a compiled .hex file.
 * CI skips it by default because it depends on an AVR toolchain + a firmware
 * image with the license backend compiled in. Local reproduction:
 *
 *   1. Build a Baremetal firmware for arduino:avr:mega (ATmega2560) with the
 *      `license_store_avr` backend enabled (LICENSE_STORE_ENABLED /
 *      LICENSE_BACKEND_AVR defines) so FC 0x49/0x4A are wired to the EEPROM-
 *      backed store. Use arduino-cli with the AVR core, e.g.:
 *        arduino-cli compile -b arduino:avr:mega \
 *          --build-property "build.extra_flags=-DMODBUS_ENABLED -DMBSERIAL -DLICENSE_STORE_ENABLED" \
 *          --output-dir /tmp/lic-fw <sketch>
 *   2. export LICENSE_STORE_HEX=/tmp/lic-fw/Baremetal.ino.hex
 *   3. npx jest src/backend/shared/simulator/__tests__/license-roundtrip-e2e.test.ts
 *
 * NOTE on backend integrity (design.md §5.3): the EMPTY (virgin flash),
 * CORRUPT (tampered crc32) and TOO_LARGE (len > capacity) device states can
 * only be exercised against a real firmware image or this simulator with such
 * a .hex — the AVR/ESP32 backends depend on Arduino EEPROM.h / Preferences.h
 * and do not compile host-side without a mock. The magic/crc → status decision
 * logic they implement is already covered cross-language by the CRC-32 golden
 * fixture (T04) and the TS parser tests (parseReadLicenseResponse handling of
 * LIC_EMPTY / LIC_CORRUPT / error statuses in modbus-pdu.test.ts).
 */

import fs from 'node:fs'
import path from 'node:path'
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'

// jsdom polyfill — matches modbus-rtu-client.test.ts / debug-e2e.test.ts.
if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder: typeof TextEncoder }).TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
}

import { type LicenseBlob, serializeLicenseBlob } from '../../debug/license-blob'
import golden from '../../debug/__tests__/fixtures/license-golden.json'
import { ModbusRtuClient } from '../modbus-rtu-client'
import { SimulatorModule } from '../simulator-module'
import { VirtualSerialPort } from '../virtual-serial-port'

const HEX_PATH = process.env.LICENSE_STORE_HEX ?? ''
const HEX_EXISTS = HEX_PATH !== '' && fs.existsSync(HEX_PATH)
const describeIfHex: typeof describe = HEX_EXISTS ? describe : describe.skip

/** Build the golden LicenseBlob input from the shared cross-language fixture. */
function goldenInput(): LicenseBlob {
  return {
    magic: golden.input.magic,
    fmtVersion: golden.input.fmtVersion,
    flags: golden.input.flags,
    deviceId: Uint8Array.from(golden.input.deviceId),
    productId: Uint8Array.from(golden.input.productId),
    issuedAt: golden.input.issuedAt,
    expiresAt: golden.input.expiresAt,
    signature: Uint8Array.from(golden.input.signature),
    crc32: golden.input.crc32,
  }
}

describeIfHex('OLS license-storage round-trip end-to-end (avr8js + ModbusRtuClient)', () => {
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

  it('FC 0x49 writeLicense(golden) → FC 0x4A readLicense() round-trips byte-for-byte', async () => {
    const goldenBytes = serializeLicenseBlob(goldenInput())

    const write = await client.writeLicense(goldenBytes)
    expect(write.success).toBe(true)

    const read = await client.readLicense()
    expect(read.success).toBe(true)
    expect(read.empty).toBeFalsy()
    expect(read.corrupt).toBeFalsy()
    expect(read.blob).toBeDefined()

    // Byte-for-byte parity with the golden serialization.
    expect(Array.from(read.blob!)).toEqual(Array.from(goldenBytes))

    // Endianness sentinel: the blob's first byte is the magic 'O' (0x4F).
    // The little-endian uint32 magic 0x434C504F serializes to 4F 50 4C 43, so
    // a first byte of 0x4F proves the LE-on-wire / LE-on-device duality held
    // across the write → store → read path (design.md §1, §5.2).
    expect(read.blob![0]).toBe(0x4f)
  }, 30000)
})
