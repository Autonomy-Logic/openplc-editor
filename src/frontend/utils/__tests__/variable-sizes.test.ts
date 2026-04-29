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

  // TIME parsing — STruC++ wire format is a single int64_t nanoseconds duration.
  // Helper: write `ns` as a little-endian int64 into `buf` at offset 0.
  const writeTimeNs = (buf: Uint8Array, ns: bigint): void => {
    new DataView(buf.buffer).setBigInt64(0, ns, true)
  }

  it('parses TIME with zero value', () => {
    const buf = new Uint8Array(8) // all-zero is 0 ns
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result).toEqual({ value: '0s', bytesRead: 8 })
  })

  it('parses TIME with seconds only', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 5n * 1_000_000_000n) // 5 s
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result).toEqual({ value: '5s', bytesRead: 8 })
  })

  it('parses TIME with days, hours, minutes, seconds', () => {
    const buf = new Uint8Array(8)
    // 1 day + 2 hours + 3 minutes + 4 seconds = 93,784 s
    writeTimeNs(buf, 93_784n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('1d2h')
    expect(result.bytesRead).toBe(8)
  })

  it('parses TIME with milliseconds', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 5_000_000n) // 5 ms
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('5ms')
  })

  it('parses TIME with microseconds', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 5_000n) // 5 us
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('5us')
  })

  it('parses TIME with nanoseconds only', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 500n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('500ns')
  })

  it('parses negative TIME', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, -5n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('-5s')
  })

  it('combines sec and sub-second components from a single int64', () => {
    const buf = new Uint8Array(8)
    // 2.5 s = 2_500_000_000 ns
    writeTimeNs(buf, 2_500_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('2s500ms')
  })

  it('handles negative durations with sub-second magnitudes', () => {
    const buf = new Uint8Array(8)
    // -2.5 s = -2_500_000_000 ns
    writeTimeNs(buf, -2_500_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('-2s500ms')
  })

  it('formats TIME with exactly two components when more exist', () => {
    const buf = new Uint8Array(8)
    // 1 hour + 1 minute + 1 second = 3661 s
    writeTimeNs(buf, 3_661n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TIME'))
    expect(result.value).toBe('1h1m')
  })

  // DATE / TOD share the int64 ns wire format but represent absolute
  // timestamps (epoch / midnight reference). Their formatters need
  // different epoch handling and are deferred — until then the parser
  // returns a placeholder so consumers don't misread a duration string
  // as a date.
  it('parses DATE as deferred placeholder', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 10n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('d', 'DATE'))
    expect(result).toEqual({ value: '<TIME>', bytesRead: 8 })
  })

  it('parses TOD as deferred placeholder', () => {
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 3_600n * 1_000_000_000n) // 1 hour
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TOD'))
    expect(result).toEqual({ value: '<TIME>', bytesRead: 8 })
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
