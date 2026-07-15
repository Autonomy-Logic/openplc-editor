/**
 * Regression test for size-aware RTU framing (fix(debugger): frame long RTU
 * debug responses by declared length).
 *
 * The RTU client used to detect end-of-frame purely by a 10ms idle timeout.
 * A large variable-length response (the 98-byte license blob) arriving in
 * multiple chunks at 9600 baud — where FTDI/CH340 latency timers push
 * inter-chunk gaps to ~16ms — was cut at the first chunk ("Incomplete license
 * blob, got 25"). readLicense() now passes an expectedTotalLength predictor
 * (SUCCESS → total = 7 + len) so the read completes once the whole frame has
 * arrived, regardless of gaps between chunks.
 *
 * This test injects a fake serial port that emits the response in two chunks
 * with a REAL 20ms gap (> FRAME_COMPLETE_TIMEOUT_MS = 10ms) and asserts the
 * blob is reassembled intact.
 */

import { EventEmitter } from 'node:events'

import { ModbusRtuClient } from '../modbus-rtu-client'
import golden from '../../../shared/debug/__tests__/fixtures/license-golden.json'

const DEBUG_READ_LICENSE = 0x4a
const STATUS_SUCCESS = 0x7e
const SLAVE_ID = 1

// 98-byte golden license blob (lic_blob_t serialization). blob[0] === 0x4f ('O').
function goldenBlob(): Buffer {
  return Buffer.from(golden.expectedBytesHex, 'hex')
}

// Build the raw on-the-wire RTU READ_LICENSE frame:
// [id][FC=0x4a][STATUS=0x7e][len:u16 BE][blob...][crc:2]
function buildReadLicenseFrame(blob: Buffer): Buffer {
  const frame = Buffer.alloc(3 + 2 + blob.length + 2)
  frame.writeUInt8(SLAVE_ID, 0)
  frame.writeUInt8(DEBUG_READ_LICENSE, 1)
  frame.writeUInt8(STATUS_SUCCESS, 2)
  frame.writeUInt16BE(blob.length, 3)
  blob.copy(frame as unknown as Uint8Array, 5)
  // CRC bytes: the debugger treats CRC mismatch as non-fatal, so any 2 bytes
  // work here — the client strips them regardless.
  frame.writeUInt16BE(0x0000, 5 + blob.length)
  return frame
}

// EventEmitter-based fake serial port matching the surface sendRequestImpl uses:
// on('data'/'error'), once, removeListener, write, flush, isOpen.
class FakeSerialPort extends EventEmitter {
  isOpen = true
  emitPlan: (() => void) | null = null

  write(_data: Uint8Array, callback?: (err?: Error | null) => void) {
    callback?.(null)
    // Kick off the chunked response once the request has been written.
    this.emitPlan?.()
  }

  flush(callback?: (err?: Error | null) => void) {
    callback?.(null)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('ModbusRtuClient.readLicense — size-aware multi-chunk framing', () => {
  it('reassembles the full 98-byte blob when the frame arrives in two chunks with a >idle-timeout gap', async () => {
    const blob = goldenBlob()
    expect(blob.length).toBe(98)

    const frame = buildReadLicenseFrame(blob)
    // Split so the first chunk (25 bytes) is well short of the 105-byte frame
    // and the second arrives after a gap larger than FRAME_COMPLETE_TIMEOUT_MS.
    const firstChunk = frame.subarray(0, 25)
    const restChunk = frame.subarray(25)

    const port = new FakeSerialPort()
    port.emitPlan = () => {
      setTimeout(() => port.emit('data', Buffer.from(firstChunk)), 0)
      // Real 20ms gap > 10ms idle timeout: the old code truncated here.
      void sleep(20).then(() => port.emit('data', Buffer.from(restChunk)))
    }

    const client = new ModbusRtuClient({ port: 'x', baudRate: 9600, slaveId: SLAVE_ID, timeout: 500 })
    // Inject the fake port directly, bypassing connect().
    ;(client as unknown as { serialPort: unknown }).serialPort = port

    const result = await client.readLicense()

    expect(result.success).toBe(true)
    expect(result.blob).toBeDefined()
    expect(result.blob!.length).toBe(98)
    expect(result.blob![0]).toBe(0x4f)
    expect(Buffer.from(result.blob!).equals(blob as unknown as Uint8Array)).toBe(true)
  })
})
