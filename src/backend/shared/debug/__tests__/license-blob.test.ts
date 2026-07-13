// jsdom (editor's Jest environment) doesn't ship TextEncoder by default —
// polyfill from Node's util before the CRC test vector uses it.
import { TextEncoder as NodeTextEncoder } from 'node:util'

if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder: typeof TextEncoder }).TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
}

import {
  crc32IsoHdlc,
  deserializeLicenseBlob,
  LIC_BLOB_SIZE,
  LIC_MAGIC_LE,
  LIC_PAYLOAD_SIZE,
  type LicenseBlob,
  serializeLicenseBlob,
} from '../license-blob'
import golden from './fixtures/license-golden.json'

const TextEnc = globalThis.TextEncoder

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Build the LicenseBlob input from the shared golden fixture. */
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

describe('crc32IsoHdlc', () => {
  it('matches the canonical CRC-32/ISO-HDLC test vector for "123456789"', () => {
    const crc = crc32IsoHdlc(new TextEnc().encode('123456789'))
    expect(crc).toBe(0xcbf43926)
  })

  it('returns an unsigned 32-bit value', () => {
    const crc = crc32IsoHdlc(new TextEnc().encode('123456789'))
    expect(crc).toBeGreaterThanOrEqual(0)
    expect(crc).toBeLessThanOrEqual(0xffffffff)
  })

  it('produces 0 for an empty input (init ^ xorout)', () => {
    // CRC of no data: 0xFFFFFFFF ^ 0xFFFFFFFF === 0.
    expect(crc32IsoHdlc(new Uint8Array())).toBe(0)
  })
})

describe('constants', () => {
  it('mirror the C struct sizes and magic', () => {
    expect(LIC_BLOB_SIZE).toBe(106)
    expect(LIC_PAYLOAD_SIZE).toBe(38)
    expect(LIC_MAGIC_LE).toBe(0x434c504f)
  })
})

describe('serializeLicenseBlob', () => {
  it('produces exactly the golden fixture bytes', () => {
    const bytes = serializeLicenseBlob(goldenInput())
    expect(bytes).toHaveLength(LIC_BLOB_SIZE)
    expect(bytesToHex(bytes)).toBe(golden.expectedBytesHex)
  })

  it('writes the magic as the four bytes 4F 50 4C 43', () => {
    const bytes = serializeLicenseBlob(goldenInput())
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x4f, 0x50, 0x4c, 0x43])
  })

  it('recomputes crc32 over [payload||signature] and stores it LE at offset 102', () => {
    const bytes = serializeLicenseBlob(goldenInput())
    const view = new DataView(bytes.buffer)
    const storedCrc = view.getUint32(102, true)
    expect(storedCrc).toBe(golden.expectedCrc32)
    // Independent recomputation over offsets 0..101 must agree.
    expect(crc32IsoHdlc(bytes.subarray(0, 102))).toBe(golden.expectedCrc32)
  })

  it('ignores the crc32 field on the input (always recomputes)', () => {
    const tampered = goldenInput()
    tampered.crc32 = 0xdeadbeef
    const bytes = serializeLicenseBlob(tampered)
    expect(new DataView(bytes.buffer).getUint32(102, true)).toBe(golden.expectedCrc32)
  })
})

describe('deserializeLicenseBlob', () => {
  it('reproduces the golden input from the golden bytes', () => {
    const parsed = deserializeLicenseBlob(hexToBytes(golden.expectedBytesHex))
    expect(parsed.magic).toBe(LIC_MAGIC_LE)
    expect(parsed.fmtVersion).toBe(golden.input.fmtVersion)
    expect(parsed.flags).toBe(golden.input.flags)
    expect(Array.from(parsed.deviceId)).toEqual(golden.input.deviceId)
    expect(Array.from(parsed.productId)).toEqual(golden.input.productId)
    expect(parsed.issuedAt).toBe(golden.input.issuedAt)
    expect(parsed.expiresAt).toBe(golden.input.expiresAt)
    expect(Array.from(parsed.signature)).toEqual(golden.input.signature)
    expect(parsed.crc32).toBe(golden.expectedCrc32)
  })

  it('throws on a truncated buffer', () => {
    expect(() => deserializeLicenseBlob(new Uint8Array(LIC_BLOB_SIZE - 1))).toThrow(/too short/)
  })
})

describe('round-trip serialize -> deserialize', () => {
  it('is identical for all fields (magic and crc32 canonicalized)', () => {
    const input = goldenInput()
    const parsed = deserializeLicenseBlob(serializeLicenseBlob(input))

    // magic is forced to canonical LIC_MAGIC_LE on serialize; input already uses it.
    expect(parsed.magic).toBe(input.magic)
    expect(parsed.fmtVersion).toBe(input.fmtVersion)
    expect(parsed.flags).toBe(input.flags)
    expect(Array.from(parsed.deviceId)).toEqual(Array.from(input.deviceId))
    expect(Array.from(parsed.productId)).toEqual(Array.from(input.productId))
    expect(parsed.issuedAt).toBe(input.issuedAt)
    expect(parsed.expiresAt).toBe(input.expiresAt)
    expect(Array.from(parsed.signature)).toEqual(Array.from(input.signature))
    // crc32 is recomputed on serialize; the round-tripped value is the real crc.
    expect(parsed.crc32).toBe(golden.expectedCrc32)
  })

  it('re-serializes the deserialized blob to the same bytes (byte-stable)', () => {
    const bytes = hexToBytes(golden.expectedBytesHex)
    const reserialized = serializeLicenseBlob(deserializeLicenseBlob(bytes))
    expect(bytesToHex(reserialized)).toBe(golden.expectedBytesHex)
  })
})
