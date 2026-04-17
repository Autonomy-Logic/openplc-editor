import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getTypeSizeByName, getVariableSize, parseValueByTypeName, parseVariableValue } from '../variable-sizes'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseVar(name: string, baseType: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'base-type', value: baseType },
    location: '',
    documentation: '',
    debug: false,
  }
}

function makeDerivedVar(name: string): PLCVariable {
  return {
    name,
    class: 'local',
    type: { definition: 'user-data-type', value: 'MyStruct' },
    location: '',
    documentation: '',
    debug: false,
  }
}

/** Build a Uint8Array from plain numbers (little-endian helpers below). */
function u8(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes)
}

function int16LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(2)
  new DataView(buf).setInt16(0, value, true)
  return new Uint8Array(buf)
}

function uint16LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(2)
  new DataView(buf).setUint16(0, value, true)
  return new Uint8Array(buf)
}

function int32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setInt32(0, value, true)
  return new Uint8Array(buf)
}

function uint32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setUint32(0, value, true)
  return new Uint8Array(buf)
}

function float32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, true)
  return new Uint8Array(buf)
}

function float64LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setFloat64(0, value, true)
  return new Uint8Array(buf)
}

function bigInt64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigInt64(0, value, true)
  return new Uint8Array(buf)
}

function bigUint64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, value, true)
  return new Uint8Array(buf)
}

// ---------------------------------------------------------------------------
// getVariableSize
// ---------------------------------------------------------------------------

describe('getVariableSize', () => {
  it.each([
    ['BOOL', 1],
    ['SINT', 1],
    ['USINT', 1],
    ['BYTE', 1],
    ['INT', 2],
    ['UINT', 2],
    ['WORD', 2],
    ['DINT', 4],
    ['UDINT', 4],
    ['DWORD', 4],
    ['REAL', 4],
    ['TIME', 8],
    ['DATE', 8],
    ['TOD', 8],
    ['LINT', 8],
    ['ULINT', 8],
    ['LWORD', 8],
    ['LREAL', 8],
    ['DT', 8],
    ['STRING', 127],
  ])('returns %i bytes for %s', (typeName, expected) => {
    expect(getVariableSize(makeBaseVar('v', typeName))).toBe(expected)
  })

  it('defaults to 4 for unknown base type', () => {
    expect(getVariableSize(makeBaseVar('v', 'WSTRING'))).toBe(4)
  })

  it('defaults to 4 for non-base-type variable', () => {
    expect(getVariableSize(makeDerivedVar('v'))).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// getTypeSizeByName
// ---------------------------------------------------------------------------

describe('getTypeSizeByName', () => {
  it.each([
    ['BOOL', 1],
    ['SINT', 1],
    ['USINT', 1],
    ['BYTE', 1],
    ['INT', 2],
    ['UINT', 2],
    ['WORD', 2],
    ['DINT', 4],
    ['UDINT', 4],
    ['DWORD', 4],
    ['REAL', 4],
    ['TIME', 8],
    ['DATE', 8],
    ['TOD', 8],
    ['LINT', 8],
    ['ULINT', 8],
    ['LWORD', 8],
    ['LREAL', 8],
    ['DT', 8],
    ['STRING', 127],
  ])('returns correct size for %s', (typeName, expected) => {
    expect(getTypeSizeByName(typeName)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(getTypeSizeByName('bool')).toBe(1)
    expect(getTypeSizeByName('Sint')).toBe(1)
  })

  it('defaults to 4 for unknown type', () => {
    expect(getTypeSizeByName('WSTRING')).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// parseVariableValue
// ---------------------------------------------------------------------------

describe('parseVariableValue', () => {
  it('parses BOOL true', () => {
    const result = parseVariableValue(u8(1), 0, makeBaseVar('b', 'BOOL'))
    expect(result).toEqual({ value: 'TRUE', bytesRead: 1 })
  })

  it('parses BOOL false', () => {
    const result = parseVariableValue(u8(0), 0, makeBaseVar('b', 'BOOL'))
    expect(result).toEqual({ value: 'FALSE', bytesRead: 1 })
  })

  it('parses SINT (positive)', () => {
    const result = parseVariableValue(u8(42), 0, makeBaseVar('s', 'SINT'))
    expect(result).toEqual({ value: '42', bytesRead: 1 })
  })

  it('parses SINT (negative)', () => {
    // -1 stored as 0xFF
    const result = parseVariableValue(u8(0xff), 0, makeBaseVar('s', 'SINT'))
    expect(result).toEqual({ value: '-1', bytesRead: 1 })
  })

  it('parses USINT', () => {
    const result = parseVariableValue(u8(200), 0, makeBaseVar('u', 'USINT'))
    expect(result).toEqual({ value: '200', bytesRead: 1 })
  })

  it('parses BYTE', () => {
    const result = parseVariableValue(u8(255), 0, makeBaseVar('b', 'BYTE'))
    expect(result).toEqual({ value: '255', bytesRead: 1 })
  })

  it('parses INT (positive)', () => {
    const data = int16LE(1000)
    const result = parseVariableValue(data, 0, makeBaseVar('i', 'INT'))
    expect(result).toEqual({ value: '1000', bytesRead: 2 })
  })

  it('parses INT (negative)', () => {
    const data = int16LE(-500)
    const result = parseVariableValue(data, 0, makeBaseVar('i', 'INT'))
    expect(result).toEqual({ value: '-500', bytesRead: 2 })
  })

  it('parses UINT', () => {
    const data = uint16LE(60000)
    const result = parseVariableValue(data, 0, makeBaseVar('u', 'UINT'))
    expect(result).toEqual({ value: '60000', bytesRead: 2 })
  })

  it('parses WORD', () => {
    const data = uint16LE(0xabcd)
    const result = parseVariableValue(data, 0, makeBaseVar('w', 'WORD'))
    expect(result).toEqual({ value: '43981', bytesRead: 2 })
  })

  it('parses DINT (positive)', () => {
    const data = int32LE(100000)
    const result = parseVariableValue(data, 0, makeBaseVar('d', 'DINT'))
    expect(result).toEqual({ value: '100000', bytesRead: 4 })
  })

  it('parses DINT (negative)', () => {
    const data = int32LE(-100000)
    const result = parseVariableValue(data, 0, makeBaseVar('d', 'DINT'))
    expect(result).toEqual({ value: '-100000', bytesRead: 4 })
  })

  it('parses UDINT', () => {
    const data = uint32LE(3000000000)
    const result = parseVariableValue(data, 0, makeBaseVar('u', 'UDINT'))
    expect(result).toEqual({ value: '3000000000', bytesRead: 4 })
  })

  it('parses DWORD', () => {
    const data = uint32LE(0xdeadbeef)
    const result = parseVariableValue(data, 0, makeBaseVar('w', 'DWORD'))
    expect(result).toEqual({ value: '3735928559', bytesRead: 4 })
  })

  it('parses REAL', () => {
    const data = float32LE(3.14)
    const result = parseVariableValue(data, 0, makeBaseVar('r', 'REAL'))
    expect(result.bytesRead).toBe(4)
    expect(parseFloat(result.value)).toBeCloseTo(3.14, 2)
  })

  it('parses LINT', () => {
    const data = bigInt64LE(-9007199254740991n)
    const result = parseVariableValue(data, 0, makeBaseVar('l', 'LINT'))
    expect(result).toEqual({ value: '-9007199254740991', bytesRead: 8 })
  })

  it('parses ULINT', () => {
    const data = bigUint64LE(18446744073709551615n)
    const result = parseVariableValue(data, 0, makeBaseVar('u', 'ULINT'))
    expect(result).toEqual({ value: '18446744073709551615', bytesRead: 8 })
  })

  it('parses LWORD', () => {
    const data = bigUint64LE(123456789n)
    const result = parseVariableValue(data, 0, makeBaseVar('w', 'LWORD'))
    expect(result).toEqual({ value: '123456789', bytesRead: 8 })
  })

  it('parses DT (as ULINT)', () => {
    const data = bigUint64LE(42n)
    const result = parseVariableValue(data, 0, makeBaseVar('d', 'DT'))
    expect(result).toEqual({ value: '42', bytesRead: 8 })
  })

  it('parses LREAL', () => {
    const data = float64LE(3.141592653589793)
    const result = parseVariableValue(data, 0, makeBaseVar('l', 'LREAL'))
    expect(result.bytesRead).toBe(8)
    expect(parseFloat(result.value)).toBeCloseTo(3.141592653589793, 10)
  })

  it('parses STRING', () => {
    // TextDecoder may not be in jsdom; provide from Node's util if needed
    const OriginalTextDecoder = globalThis.TextDecoder
    if (typeof globalThis.TextDecoder === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      globalThis.TextDecoder = require('util').TextDecoder
    }
    try {
      const str = 'Hello'
      const data = new Uint8Array(127)
      data[0] = str.length
      for (let i = 0; i < str.length; i++) {
        data[i + 1] = str.charCodeAt(i)
      }
      const result = parseVariableValue(data, 0, makeBaseVar('s', 'STRING'))
      expect(result).toEqual({ value: '"Hello"', bytesRead: 127 })
    } finally {
      if (OriginalTextDecoder === undefined) {
        // @ts-expect-error restoring original undefined state
        delete globalThis.TextDecoder
      }
    }
  })

  it('returns ??? for unknown base type', () => {
    const result = parseVariableValue(u8(0, 0, 0, 0), 0, makeBaseVar('x', 'WSTRING'))
    expect(result).toEqual({ value: '???', bytesRead: 4 })
  })

  it('returns ??? for non-base-type variable', () => {
    const result = parseVariableValue(u8(0, 0, 0, 0), 0, makeDerivedVar('x'))
    expect(result).toEqual({ value: '???', bytesRead: 4 })
  })

  it('respects offset parameter', () => {
    const data = u8(0x00, 0x00, 42)
    const result = parseVariableValue(data, 2, makeBaseVar('v', 'USINT'))
    expect(result).toEqual({ value: '42', bytesRead: 1 })
  })

  // TIME / DATE / TOD parsing (via formatTimeValue)
  it('parses TIME with zero value', () => {
    const data = new Uint8Array(8)
    // sec=0, nsec=0
    const result = parseVariableValue(data, 0, makeBaseVar('t', 'TIME'))
    expect(result).toEqual({ value: '0s', bytesRead: 8 })
  })

  it('parses TIME with seconds only', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 5, true) // 5 seconds
    view.setInt32(4, 0, true) // 0 nanoseconds
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result).toEqual({ value: '5s', bytesRead: 8 })
  })

  it('parses TIME with days, hours, minutes, seconds', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    // 1 day + 2 hours + 3 minutes + 4 seconds = 86400 + 7200 + 180 + 4 = 93784
    view.setInt32(0, 93784, true)
    view.setInt32(4, 0, true)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('1d2h')
    expect(result.bytesRead).toBe(8)
  })

  it('parses TIME with milliseconds', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 0, true)
    view.setInt32(4, 5_000_000, true) // 5ms
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('5ms')
  })

  it('parses TIME with microseconds', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 0, true)
    view.setInt32(4, 5_000, true) // 5us
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('5us')
  })

  it('parses TIME with nanoseconds only', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 0, true)
    view.setInt32(4, 500, true) // 500ns
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('500ns')
  })

  it('parses negative TIME', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, -5, true)
    view.setInt32(4, 0, true)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('-5s')
  })

  it('parses DATE (same as TIME)', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 10, true)
    view.setInt32(4, 0, true)
    const result = parseVariableValue(buf, 0, makeBaseVar('d', 'DATE'))
    expect(result).toEqual({ value: '10s', bytesRead: 8 })
  })

  it('parses TOD (same as TIME)', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 3600, true) // 1 hour
    view.setInt32(4, 0, true)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TOD'))
    expect(result).toEqual({ value: '1h', bytesRead: 8 })
  })

  it('handles nsec overflow (>= 1 billion)', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 1, true) // 1 second
    view.setInt32(4, 1_500_000_000, true) // 1.5 billion nsec = 1 extra sec + 500ms
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    // 1 + 1 = 2 seconds, 500ms
    expect(result.value).toBe('2s500ms')
  })

  it('handles positive sec with negative nsec', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 3, true)
    view.setInt32(4, -500_000_000, true) // -0.5s
    // After normalization: sec=2, nsec=500_000_000
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('2s500ms')
  })

  it('handles negative sec with positive nsec', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, -3, true)
    view.setInt32(4, 500_000_000, true) // +0.5s
    // After normalization: sec=-2, nsec=-500_000_000 => negative -2s500ms
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('-2s500ms')
  })

  it('handles nsec overflow below -1 billion', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setInt32(0, -1, true)
    view.setInt32(4, -1_500_000_000, true) // -1.5 billion nsec
    // sec = -1 + trunc(-1_500_000_000/1_000_000_000) = -1 + (-1) = -2
    // nsec = -1_500_000_000 % 1_000_000_000 = -500_000_000
    // Both negative so no further adjustment
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('-2s500ms')
  })

  it('formats TIME with exactly two components when more exist', () => {
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    // 1 hour + 1 minute + 1 second = 3661
    view.setInt32(0, 3661, true)
    view.setInt32(4, 0, true)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    // Should show only first two: "1h1m"
    expect(result.value).toBe('1h1m')
  })
})

// ---------------------------------------------------------------------------
// parseValueByTypeName
// ---------------------------------------------------------------------------

describe('parseValueByTypeName', () => {
  it('parses using type name string (delegates to parseVariableValue)', () => {
    const data = u8(1)
    const result = parseValueByTypeName(data, 0, 'BOOL')
    expect(result).toEqual({ value: 'TRUE', bytesRead: 1 })
  })

  it('is case-insensitive', () => {
    const data = u8(42)
    const result = parseValueByTypeName(data, 0, 'usint')
    expect(result).toEqual({ value: '42', bytesRead: 1 })
  })
})
