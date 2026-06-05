import type { VariableTypeInfo } from '../variable-types'
import {
  floatToBuffer,
  getVariableTypeInfo,
  integerToBuffer,
  parseFloatValue,
  parseIntegerValue,
  parseStringValue,
  stringToBuffer,
} from '../variable-types'

// ---------------------------------------------------------------------------
// getVariableTypeInfo
// ---------------------------------------------------------------------------

describe('getVariableTypeInfo', () => {
  it.each([
    ['BOOL', { byteSize: 1, signed: false }],
    ['SINT', { byteSize: 1, signed: true }],
    ['USINT', { byteSize: 1, signed: false }],
    ['BYTE', { byteSize: 1, signed: false }],
    ['INT', { byteSize: 2, signed: true }],
    ['UINT', { byteSize: 2, signed: false }],
    ['WORD', { byteSize: 2, signed: false }],
    ['DINT', { byteSize: 4, signed: true }],
    ['UDINT', { byteSize: 4, signed: false }],
    ['DWORD', { byteSize: 4, signed: false }],
    ['LINT', { byteSize: 8, signed: true }],
    ['ULINT', { byteSize: 8, signed: false }],
    ['LWORD', { byteSize: 8, signed: false }],
    ['REAL', { byteSize: 4, signed: true }],
    ['LREAL', { byteSize: 8, signed: true }],
    ['STRING', { byteSize: 127, signed: false }],
  ])('returns correct info for %s', (type, expected) => {
    expect(getVariableTypeInfo(type)).toEqual(expected)
  })

  it('is case-insensitive', () => {
    expect(getVariableTypeInfo('bool')).toEqual({ byteSize: 1, signed: false })
    expect(getVariableTypeInfo('Bool')).toEqual({ byteSize: 1, signed: false })
  })

  it('returns null for unknown type', () => {
    expect(getVariableTypeInfo('WSTRING')).toBeNull()
    expect(getVariableTypeInfo('TIME')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseIntegerValue
// ---------------------------------------------------------------------------

describe('parseIntegerValue', () => {
  const sint: VariableTypeInfo = { byteSize: 1, signed: true }
  const usint: VariableTypeInfo = { byteSize: 1, signed: false }
  const int16: VariableTypeInfo = { byteSize: 2, signed: true }
  const uint16: VariableTypeInfo = { byteSize: 2, signed: false }
  const dint: VariableTypeInfo = { byteSize: 4, signed: true }

  it('parses decimal string', () => {
    expect(parseIntegerValue('42', usint)).toBe(42n)
  })

  it('parses negative decimal for signed type', () => {
    expect(parseIntegerValue('-100', sint)).toBe(-100n)
  })

  it('parses 0x hex prefix', () => {
    expect(parseIntegerValue('0xFF', usint)).toBe(255n)
  })

  it('parses 0X hex prefix (uppercase)', () => {
    expect(parseIntegerValue('0XFF', usint)).toBe(255n)
  })

  it('parses IEC 16# hex prefix', () => {
    expect(parseIntegerValue('16#FF', usint)).toBe(255n)
  })

  it('parses IEC 2# binary prefix', () => {
    expect(parseIntegerValue('2#11111111', usint)).toBe(255n)
  })

  it('parses IEC 8# octal prefix', () => {
    expect(parseIntegerValue('8#377', usint)).toBe(255n)
  })

  it('trims whitespace', () => {
    expect(parseIntegerValue('  42  ', usint)).toBe(42n)
  })

  it('returns null when value exceeds max for signed type', () => {
    // SINT max = 127
    expect(parseIntegerValue('128', sint)).toBeNull()
  })

  it('returns null when value is below min for signed type', () => {
    // SINT min = -128
    expect(parseIntegerValue('-129', sint)).toBeNull()
  })

  it('returns null when unsigned value is negative', () => {
    expect(parseIntegerValue('-1', usint)).toBeNull()
  })

  it('returns null when value exceeds max for unsigned type', () => {
    // USINT max = 255
    expect(parseIntegerValue('256', usint)).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseIntegerValue('abc', sint)).toBeNull()
  })

  it('treats empty string as 0', () => {
    // BigInt('') returns 0n, so empty string parses to 0
    expect(parseIntegerValue('', sint)).toBe(0n)
  })

  it('handles INT range correctly', () => {
    expect(parseIntegerValue('32767', int16)).toBe(32767n)
    expect(parseIntegerValue('-32768', int16)).toBe(-32768n)
    expect(parseIntegerValue('32768', int16)).toBeNull()
  })

  it('handles UINT range correctly', () => {
    expect(parseIntegerValue('65535', uint16)).toBe(65535n)
    expect(parseIntegerValue('65536', uint16)).toBeNull()
  })

  it('handles DINT range', () => {
    expect(parseIntegerValue('2147483647', dint)).toBe(2147483647n)
    expect(parseIntegerValue('-2147483648', dint)).toBe(-2147483648n)
    expect(parseIntegerValue('2147483648', dint)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// integerToBuffer
// ---------------------------------------------------------------------------

describe('integerToBuffer', () => {
  it('converts positive unsigned value to buffer', () => {
    const result = integerToBuffer(255n, 1, false)
    expect(result).toEqual(new Uint8Array([0xff]))
  })

  it('converts positive signed value to buffer', () => {
    const result = integerToBuffer(127n, 1, true)
    expect(result).toEqual(new Uint8Array([0x7f]))
  })

  it('converts negative signed value using twos complement', () => {
    // -1 in 1-byte signed = 0xFF
    const result = integerToBuffer(-1n, 1, true)
    expect(result).toEqual(new Uint8Array([0xff]))
  })

  it('converts negative signed 2-byte value', () => {
    // -1 in 2-byte signed = 0xFF 0xFF
    const result = integerToBuffer(-1n, 2, true)
    expect(result).toEqual(new Uint8Array([0xff, 0xff]))
  })

  it('converts zero', () => {
    const result = integerToBuffer(0n, 2, false)
    expect(result).toEqual(new Uint8Array([0x00, 0x00]))
  })

  it('converts multi-byte unsigned value in little-endian order', () => {
    // 0x0102 → LE bytes [0x02, 0x01].  Wire format the runtime
    // memcpy's straight into IEC ints — every supported target
    // (AVR / ARM Cortex-M / x86_64) is little-endian.
    const result = integerToBuffer(0x0102n, 2, false)
    expect(result).toEqual(new Uint8Array([0x02, 0x01]))
  })

  it('converts 4-byte value in little-endian order', () => {
    const result = integerToBuffer(0xdeadbeefn, 4, false)
    expect(result).toEqual(new Uint8Array([0xef, 0xbe, 0xad, 0xde]))
  })

  it('converts negative 4-byte signed value', () => {
    // -1 in 4-byte signed = 0xFF FF FF FF
    const result = integerToBuffer(-1n, 4, true)
    expect(result).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
  })
})

// ---------------------------------------------------------------------------
// parseFloatValue
// ---------------------------------------------------------------------------

describe('parseFloatValue', () => {
  it('parses valid float string', () => {
    expect(parseFloatValue('3.14', 4)).toBeCloseTo(3.14, 2)
  })

  it('parses integer as float', () => {
    expect(parseFloatValue('42', 8)).toBe(42)
  })

  it('trims whitespace', () => {
    expect(parseFloatValue('  1.5  ', 4)).toBe(1.5)
  })

  it('returns null for NaN', () => {
    expect(parseFloatValue('NaN', 4)).toBeNull()
  })

  it('returns null for Infinity', () => {
    expect(parseFloatValue('Infinity', 4)).toBeNull()
  })

  it('returns null for -Infinity', () => {
    expect(parseFloatValue('-Infinity', 4)).toBeNull()
  })

  it('returns null for non-numeric string', () => {
    expect(parseFloatValue('abc', 4)).toBeNull()
  })

  it('returns null when float32 exceeds max', () => {
    expect(parseFloatValue('3.5e38', 4)).toBeNull()
  })

  it('returns null when float32 exceeds negative max', () => {
    expect(parseFloatValue('-3.5e38', 4)).toBeNull()
  })

  it('allows large values for 8-byte (double) precision', () => {
    expect(parseFloatValue('3.5e38', 8)).toBeCloseTo(3.5e38)
  })

  it('handles negative float', () => {
    expect(parseFloatValue('-2.5', 4)).toBe(-2.5)
  })

  it('handles zero', () => {
    expect(parseFloatValue('0', 4)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// floatToBuffer
// ---------------------------------------------------------------------------

describe('floatToBuffer', () => {
  // Wire format: little-endian IEEE 754, matching what the runtime
  // memcpy's into the IEC `REAL`/`LREAL` variable on every supported
  // target.  The read-side decoder (`variable-sizes.ts:decodeWireValue`)
  // uses `getFloat32(0, true)` — these tests confirm the writer agrees.

  it('writes float32 as 4 little-endian bytes', () => {
    const result = floatToBuffer(1.0, 4)
    expect(result.length).toBe(4)
    const view = new DataView(result.buffer)
    expect(view.getFloat32(0, true)).toBe(1.0)
    // 1.0 IEEE 754 = 0x3F800000 → LE bytes [0x00, 0x00, 0x80, 0x3F]
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x80, 0x3f]))
  })

  it('writes float64 as 8 little-endian bytes', () => {
    const result = floatToBuffer(3.141592653589793, 8)
    expect(result.length).toBe(8)
    const view = new DataView(result.buffer)
    expect(view.getFloat64(0, true)).toBeCloseTo(3.141592653589793, 12)
  })

  it('handles zero', () => {
    const result = floatToBuffer(0, 4)
    expect(result.length).toBe(4)
    const view = new DataView(result.buffer)
    expect(view.getFloat32(0, true)).toBe(0)
  })

  it('writes 123.4 with the byte order the runtime expects', () => {
    // Regression for the byte-swap bug: forcing a REAL to 123.4
    // used to store -429836352 on the runtime side because this
    // helper wrote big-endian (0x42 0xF6 0xCC 0xCD) but the runtime
    // memcpy'd those bytes into a little-endian float, swapping
    // sign / exponent / mantissa.
    const result = floatToBuffer(123.4, 4)
    expect(result).toEqual(new Uint8Array([0xcd, 0xcc, 0xf6, 0x42]))
  })

  it('returns buffer of requested size for other sizes (no write)', () => {
    const result = floatToBuffer(1.0, 2)
    expect(result.length).toBe(2)
    // No float write happens for non-4/non-8, so all zeros
    expect(result).toEqual(new Uint8Array([0, 0]))
  })
})

// ---------------------------------------------------------------------------
// parseStringValue
// ---------------------------------------------------------------------------

describe('parseStringValue', () => {
  it('returns string for valid ASCII input', () => {
    expect(parseStringValue('Hello')).toBe('Hello')
  })

  it('returns empty string for empty input', () => {
    expect(parseStringValue('')).toBe('')
  })

  it('returns string at max length (126 chars)', () => {
    const s = 'a'.repeat(126)
    expect(parseStringValue(s)).toBe(s)
  })

  it('returns null when string exceeds 126 chars', () => {
    const s = 'a'.repeat(127)
    expect(parseStringValue(s)).toBeNull()
  })

  it('returns null for non-ASCII character', () => {
    expect(parseStringValue('caf\u00e9')).toBeNull()
  })

  it('accepts all printable ASCII', () => {
    const s = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'
    expect(parseStringValue(s)).toBe(s)
  })

  it('accepts control characters within ASCII range', () => {
    expect(parseStringValue('\t\n\r')).toBe('\t\n\r')
  })
})

// ---------------------------------------------------------------------------
// stringToBuffer
// ---------------------------------------------------------------------------

describe('stringToBuffer', () => {
  it('creates buffer with length prefix and ASCII bytes', () => {
    const result = stringToBuffer('Hi')
    expect(result).toEqual(new Uint8Array([2, 72, 105])) // 'H'=72, 'i'=105
  })

  it('creates buffer for empty string', () => {
    const result = stringToBuffer('')
    expect(result).toEqual(new Uint8Array([0]))
  })

  it('sets first byte to string length', () => {
    const result = stringToBuffer('ABCDE')
    expect(result[0]).toBe(5)
    expect(result.length).toBe(6)
  })

  it('encodes each character as its char code', () => {
    const result = stringToBuffer('A')
    expect(result[1]).toBe(65)
  })
})
