import type { PLCVariable } from '../../../middleware/shared/ports/types'
import {
  encodeForceValue,
  getTypeSizeByName,
  getVariableSize,
  parseValueByTypeName,
  parseVariableValue,
} from '../variable-sizes'

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

  it('returns 253 bytes for WSTRING (1 length + 126 UTF-16 units)', () => {
    expect(getVariableSize(makeBaseVar('v', 'WSTRING'))).toBe(1 + 126 * 2)
  })

  it('defaults to 4 for unknown base type', () => {
    expect(getVariableSize(makeBaseVar('v', 'TOTALLY_FAKE_TYPE'))).toBe(4)
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
    ['WSTRING', 1 + 126 * 2],
  ])('returns correct size for %s', (typeName, expected) => {
    expect(getTypeSizeByName(typeName)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(getTypeSizeByName('bool')).toBe(1)
    expect(getTypeSizeByName('Sint')).toBe(1)
  })

  it('defaults to 4 for unknown type', () => {
    expect(getTypeSizeByName('TOTALLY_FAKE_TYPE')).toBe(4)
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

  it('parses DT as an IEC date-time literal in UTC', () => {
    // 70_960_000_000 ns since the Unix epoch = 70.960 s past 1970-01-01.
    // Mirrors the value the user reported when the previous version
    // showed the raw nanosecond integer instead of a formatted date.
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 70_960_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('d', 'DT'))
    expect(result.bytesRead).toBe(8)
    expect(result.value).toMatch(/^DT#1970-01-01-00:01:10\.960/)
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

  it('parses WSTRING — leading length byte + UTF-16 LE code units', () => {
    // Build a 5-character "Hello" wire payload: length byte + 5 LE
    // UTF-16 code units. Trailing bytes (out of declared length) are
    // ignored by the parser.
    const totalSize = 1 + 126 * 2
    const buf = new Uint8Array(totalSize)
    buf[0] = 5
    const view = new DataView(buf.buffer)
    'Hello'.split('').forEach((ch, i) => view.setUint16(1 + i * 2, ch.charCodeAt(0), true))
    const result = parseVariableValue(buf, 0, makeBaseVar('w', 'WSTRING'))
    expect(result).toEqual({ value: '"Hello"', bytesRead: totalSize })
  })

  it('returns ??? for non-base-type unknown', () => {
    const result = parseVariableValue(u8(0, 0, 0, 0), 0, makeBaseVar('x', 'TOTALLY_FAKE_TYPE'))
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

  // DATE and TOD share the int64 nanoseconds wire format with TIME but
  // represent absolute timestamps (epoch / midnight reference). The
  // formatters render them as IEC literals matching the watch-panel
  // convention TIME established (`T#3s800ms`).

  it('parses DATE as an IEC date literal in UTC, dropping time-of-day', () => {
    // 1970-01-02 00:00:00 UTC = 86_400_000_000_000 ns since epoch.
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 86_400_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('d', 'DATE'))
    expect(result).toEqual({ value: 'D#1970-01-02', bytesRead: 8 })
  })

  it('parses TOD as nanoseconds-since-midnight, formatted HH:MM:SS.mmm', () => {
    // 1 hour = 3_600 s = 3_600_000_000_000 ns
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 3_600n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TOD'))
    expect(result).toEqual({ value: 'TOD#01:00:00.000', bytesRead: 8 })
  })

  it('TOD wraps around at 24h', () => {
    // 25 hours into the wire value should display as 01:00:00 the next day.
    const buf = new Uint8Array(8)
    writeTimeNs(buf, 25n * 3_600n * 1_000_000_000n)
    const result = parseVariableValue(buf, 0, makeBaseVar('t', 'TOD'))
    expect(result.value).toBe('TOD#01:00:00.000')
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

// ---------------------------------------------------------------------------
// encodeForceValue
// ---------------------------------------------------------------------------

describe('encodeForceValue', () => {
  it('encodes BOOL TRUE/FALSE keywords', () => {
    expect(Array.from(encodeForceValue('TRUE', 'BOOL'))).toEqual([1])
    expect(Array.from(encodeForceValue('false', 'BOOL'))).toEqual([0])
    expect(Array.from(encodeForceValue('1', 'BOOL'))).toEqual([1])
    expect(Array.from(encodeForceValue('0', 'BOOL'))).toEqual([0])
  })

  it('encodes INT as 2-byte little-endian', () => {
    expect(Array.from(encodeForceValue('256', 'INT'))).toEqual([0x00, 0x01])
    expect(Array.from(encodeForceValue('-1', 'INT'))).toEqual([0xff, 0xff])
  })

  it('maps an enum member name to its underlying integer', () => {
    const enumValues = ['Stopped', 'Running', 'Manual']
    expect(Array.from(encodeForceValue('Manual', 'INT', enumValues))).toEqual([2, 0])
    // Case-insensitive match.
    expect(Array.from(encodeForceValue('running', 'INT', enumValues))).toEqual([1, 0])
    // Numeric input still works as a power-user fallback.
    expect(Array.from(encodeForceValue('0', 'INT', enumValues))).toEqual([0, 0])
  })

  it('rejects an unknown enum member name with a helpful error', () => {
    expect(() => encodeForceValue('Frobnicate', 'INT', ['On', 'Off'])).toThrow(
      /Unknown enum member.*Expected one of: On, Off/,
    )
  })

  it('rejects unsupported types cleanly', () => {
    expect(() => encodeForceValue('5s', 'TIME')).toThrow(/not supported/)
    expect(() => encodeForceValue('"hello"', 'STRING')).toThrow(/not supported/)
  })

  describe('out-of-range truncation', () => {
    it('SINT/USINT/BYTE: values outside [0, 255] truncate to low byte', () => {
      // 257 → 0x101 → keeps low byte (0x01).
      expect(Array.from(encodeForceValue('257', 'SINT'))).toEqual([0x01])
      expect(Array.from(encodeForceValue('256', 'BYTE'))).toEqual([0x00])
      expect(Array.from(encodeForceValue('-1', 'SINT'))).toEqual([0xff])
    })

    it('INT/UINT/WORD: values outside 16-bit range truncate to low 2 bytes', () => {
      // 65537 → 0x10001 → keeps low 2 bytes (0x01, 0x00).
      expect(Array.from(encodeForceValue('65537', 'INT'))).toEqual([0x01, 0x00])
      expect(Array.from(encodeForceValue('-1', 'UINT'))).toEqual([0xff, 0xff])
    })

    it('DINT/UDINT/DWORD: values outside 32-bit range truncate to low 4 bytes', () => {
      // 2^32 + 5 → 0x100000005 → keeps low 4 bytes.
      expect(Array.from(encodeForceValue(String(2 ** 32 + 5), 'DINT'))).toEqual([0x05, 0x00, 0x00, 0x00])
    })
  })

  describe('LINT/ULINT/LWORD BigInt encoding', () => {
    it('encodes a positive 64-bit value LE', () => {
      // 0x0102030405060708 → bytes 08 07 06 05 04 03 02 01
      expect(Array.from(encodeForceValue('72623859790382856', 'LINT'))).toEqual([
        0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
      ])
    })

    it('encodes -1 as all-ones (two-complement 64-bit)', () => {
      expect(Array.from(encodeForceValue('-1', 'LINT'))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
    })

    it('rejects non-integer strings before BigInt() throws an obscure parse error', () => {
      expect(() => encodeForceValue('not-a-number', 'LINT')).toThrow(/Invalid LINT value/)
      expect(() => encodeForceValue('3.14', 'LINT')).toThrow(/Invalid LINT value/)
    })

    it('silently wraps values that overflow 64 bits (DataView.setBigInt64 wraps modulo 2^64)', () => {
      // BigInt("18446744073709551616") = 2^64 parses fine and setBigInt64 wraps
      // it modulo 2^64 → all zeros. This is a known wart worth pinning.
      expect(Array.from(encodeForceValue('18446744073709551616', 'LINT'))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
      // 2^64 + 1 wraps to 1 in the low byte (little-endian).
      expect(Array.from(encodeForceValue('18446744073709551617', 'LINT'))).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    })
  })

  describe('REAL/LREAL Infinity rejection', () => {
    it('LREAL: Infinity rejected as non-finite', () => {
      expect(() => encodeForceValue('Infinity', 'LREAL')).toThrow(/Invalid LREAL value/)
      expect(() => encodeForceValue('-Infinity', 'LREAL')).toThrow(/Invalid LREAL value/)
    })

    it('LREAL: NaN rejected as non-finite', () => {
      expect(() => encodeForceValue('NaN', 'LREAL')).toThrow(/Invalid LREAL value/)
    })

    it('REAL: Infinity rejected as non-finite', () => {
      expect(() => encodeForceValue('Infinity', 'REAL')).toThrow(/Invalid REAL value/)
    })

    it('REAL: a finite-but-too-large value silently underflows/rounds (Float32 conversion)', () => {
      // 1e40 is finite as Number but doesn't fit in Float32; it becomes
      // Float32 Infinity inside DataView.setFloat32. We don't reject
      // this — it's a known limitation of the writer. Pin the behavior.
      const buf = encodeForceValue('1e40', 'REAL')
      expect(buf).toHaveLength(4)
    })

    it('LREAL: encodes a finite value LE (8 bytes)', () => {
      const buf = encodeForceValue('1.5', 'LREAL')
      expect(buf).toHaveLength(8)
      // Round-trip via DataView.getFloat64 to confirm the LE encoding stuck.
      const view = new DataView(buf.buffer, buf.byteOffset, 8)
      expect(view.getFloat64(0, true)).toBe(1.5)
    })
  })

  describe('TIME / DATE / TOD / DT fall-through', () => {
    it('rejects DT (date-and-time) with a clear message', () => {
      expect(() => encodeForceValue('DT#2026-01-01-00:00:00', 'DT')).toThrow(/not supported/)
    })

    it('rejects TOD (time-of-day) with a clear message', () => {
      expect(() => encodeForceValue('TOD#12:00:00', 'TOD')).toThrow(/not supported/)
    })

    it('rejects DATE with a clear message', () => {
      expect(() => encodeForceValue('D#2026-01-01', 'DATE')).toThrow(/not supported/)
    })

    it('rejects unknown type names by name (the registry has no entry to dispatch to)', () => {
      expect(() => encodeForceValue('1', 'NOT_A_REAL_TYPE')).toThrow(/Unknown base type/)
    })
  })

  describe('integer parsing rejections + pinned warts', () => {
    it('SINT: non-integer string rejected', () => {
      expect(() => encodeForceValue('1.5', 'SINT')).toThrow(/Invalid SINT value/)
      expect(() => encodeForceValue('abc', 'SINT')).toThrow(/Invalid SINT value/)
    })

    it('INT: hex literals ARE accepted because Number("0x10") yields an integer', () => {
      // Pin this — if the rule changes (e.g. requiring decimal-only),
      // the test needs updating.
      expect(Array.from(encodeForceValue('0x10', 'INT'))).toEqual([0x10, 0x00])
    })

    it('DINT: empty string is treated as zero (Number("") === 0)', () => {
      // Pin the behaviour. The empty-string case is a known wart but
      // it's stable; rejecting it would be a separate behavioural
      // decision not in the scope of this PR.
      expect(Array.from(encodeForceValue('', 'DINT'))).toEqual([0x00, 0x00, 0x00, 0x00])
    })
  })
})
