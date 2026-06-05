/**
 * Tests for the editor-side endianness adaptation layer.
 *
 * See `src/frontend/utils/endian.ts` for the contract — these tests
 * cover the three responsibilities of that module:
 *
 *   1. `reverseBytesInPlace` — byte-level swap that depends on nothing
 *      but `Uint8Array` indexing (host-endian-agnostic).
 *   2. `detectTargetEndian` — classification of the two-byte sentinel
 *      the runtime writes into the MD5 response trailer.
 *   3. `applySwapToVariableBytes` — the per-variable swap that the
 *      read / write boundaries call.  No-op on LE targets, byte-skipping
 *      for single-byte and string types.
 */

import {
  applySwapToVariableBytes,
  detectTargetEndian,
  MD5_ENDIAN_SENTINEL_BE,
  MD5_ENDIAN_SENTINEL_LE,
  reverseBytesInPlace,
} from '../endian'

describe('reverseBytesInPlace', () => {
  it('reverses 4-byte sequences (IEEE 754 float width)', () => {
    const buf = new Uint8Array([0xcd, 0xcc, 0xf6, 0x42])
    reverseBytesInPlace(buf, 0, 4)
    expect(Array.from(buf)).toEqual([0x42, 0xf6, 0xcc, 0xcd])
  })

  it('reverses 8-byte sequences (IEEE 754 double width)', () => {
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    reverseBytesInPlace(buf, 0, 8)
    expect(Array.from(buf)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('reverses only the requested window, leaving surrounding bytes intact', () => {
    const buf = new Uint8Array([0xff, 0xff, 0x01, 0x02, 0x03, 0x04, 0xee, 0xee])
    reverseBytesInPlace(buf, 2, 4)
    expect(Array.from(buf)).toEqual([0xff, 0xff, 0x04, 0x03, 0x02, 0x01, 0xee, 0xee])
  })

  it('handles odd-length windows (no swap of middle byte)', () => {
    const buf = new Uint8Array([1, 2, 3])
    reverseBytesInPlace(buf, 0, 3)
    expect(Array.from(buf)).toEqual([3, 2, 1])
  })

  it('is a no-op for size 0 or 1', () => {
    const a = new Uint8Array([0xab])
    reverseBytesInPlace(a, 0, 1)
    expect(Array.from(a)).toEqual([0xab])
    const b = new Uint8Array([0xab, 0xcd])
    reverseBytesInPlace(b, 0, 0)
    expect(Array.from(b)).toEqual([0xab, 0xcd])
  })
})

describe('detectTargetEndian', () => {
  it('returns `le` for the LE sentinel pattern [0xAD, 0xDE]', () => {
    expect(detectTargetEndian(MD5_ENDIAN_SENTINEL_LE[0], MD5_ENDIAN_SENTINEL_LE[1])).toBe('le')
  })

  it('returns `be` for the BE sentinel pattern [0xDE, 0xAD]', () => {
    expect(detectTargetEndian(MD5_ENDIAN_SENTINEL_BE[0], MD5_ENDIAN_SENTINEL_BE[1])).toBe('be')
  })

  it('falls back to `le` and warns on an unrecognised sentinel', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(detectTargetEndian(0x12, 0x34)).toBe('le')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('treats a half-match as a mismatch', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    // First byte matches LE sentinel but second doesn't — must not be
    // classified as LE.
    expect(detectTargetEndian(0xad, 0x00)).toBe('le') // still LE by fallback, but with a warning
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('applySwapToVariableBytes', () => {
  it('is a no-op on LE targets', () => {
    const buf = new Uint8Array([0xcd, 0xcc, 0xf6, 0x42])
    applySwapToVariableBytes(buf, 0, 4, 'REAL', 'le')
    expect(Array.from(buf)).toEqual([0xcd, 0xcc, 0xf6, 0x42])
  })

  it('reverses the variable bytes on a BE target', () => {
    const buf = new Uint8Array([0xcd, 0xcc, 0xf6, 0x42])
    applySwapToVariableBytes(buf, 0, 4, 'REAL', 'be')
    expect(Array.from(buf)).toEqual([0x42, 0xf6, 0xcc, 0xcd])
  })

  it('respects offset within a packed buffer', () => {
    // Two REAL variables packed contiguously; swap only the second.
    const buf = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 1, 2, 3, 4])
    applySwapToVariableBytes(buf, 4, 4, 'REAL', 'be')
    expect(Array.from(buf)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 4, 3, 2, 1])
  })

  it('skips STRING (length-prefixed byte stream) even on BE', () => {
    const buf = new Uint8Array([0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]) // length 5 + "Hello"
    applySwapToVariableBytes(buf, 0, 6, 'STRING', 'be')
    expect(Array.from(buf)).toEqual([0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f])
  })

  it('skips WSTRING on BE', () => {
    const buf = new Uint8Array([0x02, 0x48, 0x00, 0x69, 0x00])
    applySwapToVariableBytes(buf, 0, 5, 'WSTRING', 'be')
    expect(Array.from(buf)).toEqual([0x02, 0x48, 0x00, 0x69, 0x00])
  })

  it('handles case-insensitive STRING / WSTRING checks', () => {
    const buf = new Uint8Array([0x01, 0x41])
    applySwapToVariableBytes(buf, 0, 2, 'string', 'be')
    expect(Array.from(buf)).toEqual([0x01, 0x41])
  })

  it('swaps multi-byte chrono types (TIME / DATE / TOD / DT)', () => {
    // strucpp emits 8 bytes for these (i64 nanoseconds).
    const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    applySwapToVariableBytes(buf, 0, 8, 'TIME', 'be')
    expect(Array.from(buf)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('is a no-op for single-byte primitives even on BE', () => {
    const buf = new Uint8Array([0xab])
    applySwapToVariableBytes(buf, 0, 1, 'BOOL', 'be')
    expect(Array.from(buf)).toEqual([0xab])
  })
})

describe('round-trip semantics (force → wire → runtime → wire → read)', () => {
  // Editor's internal codec produces little-endian wire bytes; the swap
  // layer flips them to native order before send and back to LE after
  // receive.  These tests verify that the user-visible value survives a
  // full round trip on both target byte orders.
  it('REAL 123.4 round-trips on a LE target', () => {
    const internalLE = new Uint8Array([0xcd, 0xcc, 0xf6, 0x42]) // setFloat32(0, 123.4, true)
    // Write boundary
    applySwapToVariableBytes(internalLE, 0, 4, 'REAL', 'le')
    // Wire bytes = internalLE.  Runtime memcpy → native float.  Read
    // boundary mirrors:
    applySwapToVariableBytes(internalLE, 0, 4, 'REAL', 'le')
    const view = new DataView(internalLE.buffer)
    expect(view.getFloat32(0, true)).toBeCloseTo(123.4, 4)
  })

  it('REAL 123.4 round-trips on a BE target', () => {
    const internalLE = new Uint8Array([0xcd, 0xcc, 0xf6, 0x42])
    applySwapToVariableBytes(internalLE, 0, 4, 'REAL', 'be')
    // Now in target-native (BE) byte order on the wire.
    expect(Array.from(internalLE)).toEqual([0x42, 0xf6, 0xcc, 0xcd])
    // Read boundary swaps back to LE for the internal codec.
    applySwapToVariableBytes(internalLE, 0, 4, 'REAL', 'be')
    const view = new DataView(internalLE.buffer)
    expect(view.getFloat32(0, true)).toBeCloseTo(123.4, 4)
  })
})
