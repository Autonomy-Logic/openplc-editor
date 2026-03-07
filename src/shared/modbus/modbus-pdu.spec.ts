import {
  allocBytes,
  buildGetListPdu,
  buildGetMd5Pdu,
  buildSetVariablePdu,
  bytesToHexString,
  hexStringToBytes,
  ModbusDebugResponse,
  ModbusFunctionCode,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
  readUint8,
  readUint16BE,
  readUint32BE,
  writeUint8,
  writeUint16BE,
} from './modbus-pdu'

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

describe('byte helpers', () => {
  test('allocBytes returns zeroed Uint8Array of given size', () => {
    const buf = allocBytes(4)
    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBe(4)
    expect(Array.from(buf)).toEqual([0, 0, 0, 0])
  })

  test('writeUint8 / readUint8 round-trip', () => {
    const buf = allocBytes(1)
    writeUint8(buf, 0, 0xab)
    expect(readUint8(buf, 0)).toBe(0xab)
  })

  test('writeUint16BE / readUint16BE round-trip', () => {
    const buf = allocBytes(2)
    writeUint16BE(buf, 0, 0xdead)
    expect(readUint16BE(buf, 0)).toBe(0xdead)
    expect(buf[0]).toBe(0xde)
    expect(buf[1]).toBe(0xad)
  })

  test('readUint32BE reads big-endian 32-bit unsigned', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x0a])
    expect(readUint32BE(buf, 0)).toBe(10)

    const buf2 = new Uint8Array([0x80, 0x00, 0x00, 0x01])
    expect(readUint32BE(buf2, 0)).toBe(0x80000001)
  })
})

// ---------------------------------------------------------------------------
// Hex encoding
// ---------------------------------------------------------------------------

describe('hex encoding', () => {
  test('bytesToHexString produces space-separated uppercase hex', () => {
    expect(bytesToHexString(new Uint8Array([0x44, 0x00, 0x03]))).toBe('44 00 03')
    expect(bytesToHexString(new Uint8Array([0xde, 0xad]))).toBe('DE AD')
  })

  test('hexStringToBytes parses space-separated hex', () => {
    const bytes = hexStringToBytes('44 00 03')
    expect(Array.from(bytes)).toEqual([0x44, 0x00, 0x03])
  })

  test('round-trip: bytesToHexString -> hexStringToBytes', () => {
    const original = new Uint8Array([0x45, 0xde, 0xad, 0x00, 0x00])
    const hex = bytesToHexString(original)
    const restored = hexStringToBytes(hex)
    expect(Array.from(restored)).toEqual(Array.from(original))
  })
})

// ---------------------------------------------------------------------------
// PDU builders
// ---------------------------------------------------------------------------

describe('buildGetMd5Pdu', () => {
  test('produces correct PDU bytes', () => {
    const pdu = buildGetMd5Pdu()
    expect(Array.from(pdu)).toEqual([0x45, 0xde, 0xad, 0x00, 0x00])
  })

  test('hex-encoded matches expected string', () => {
    expect(bytesToHexString(buildGetMd5Pdu())).toBe('45 DE AD 00 00')
  })
})

describe('buildGetListPdu', () => {
  test('produces correct PDU for [3, 7, 12]', () => {
    const pdu = buildGetListPdu([3, 7, 12])
    expect(Array.from(pdu)).toEqual([0x44, 0x00, 0x03, 0x00, 0x03, 0x00, 0x07, 0x00, 0x0c])
  })

  test('hex-encoded matches expected string', () => {
    expect(bytesToHexString(buildGetListPdu([3, 7, 12]))).toBe('44 00 03 00 03 00 07 00 0C')
  })

  test('empty indexes produces just header', () => {
    const pdu = buildGetListPdu([])
    expect(Array.from(pdu)).toEqual([0x44, 0x00, 0x00])
  })

  test('single index', () => {
    const pdu = buildGetListPdu([256])
    expect(Array.from(pdu)).toEqual([0x44, 0x00, 0x01, 0x01, 0x00])
  })
})

describe('buildSetVariablePdu', () => {
  test('force=true with value', () => {
    const value = new Uint8Array([0x01])
    const pdu = buildSetVariablePdu(5, true, value)
    expect(Array.from(pdu)).toEqual([0x42, 0x00, 0x05, 0x01, 0x00, 0x01, 0x01])
  })

  test('force=false produces release PDU', () => {
    const pdu = buildSetVariablePdu(5, false)
    expect(Array.from(pdu)).toEqual([0x42, 0x00, 0x05, 0x00, 0x00, 0x01, 0x00])
  })

  test('force=true with multi-byte value', () => {
    const value = new Uint8Array([0xff, 0x7f, 0x00, 0x00])
    const pdu = buildSetVariablePdu(10, true, value)
    expect(Array.from(pdu)).toEqual([0x42, 0x00, 0x0a, 0x01, 0x00, 0x04, 0xff, 0x7f, 0x00, 0x00])
  })

  test('force=true with no value falls back to release-like', () => {
    const pdu = buildSetVariablePdu(5, true)
    // force=true but no value → dataLength=1, byte=0x00
    expect(Array.from(pdu)).toEqual([0x42, 0x00, 0x05, 0x01, 0x00, 0x01, 0x00])
  })
})

// ---------------------------------------------------------------------------
// PDU response parsers
// ---------------------------------------------------------------------------

describe('parseGetMd5Response', () => {
  test('parses successful MD5 response', () => {
    // FC=0x45, status=SUCCESS, then MD5 string bytes
    const md5 = 'abc123def456'
    const md5Bytes = new TextEncoder().encode(md5)
    const pdu = allocBytes(2 + md5Bytes.length)
    writeUint8(pdu, 0, ModbusFunctionCode.DEBUG_GET_MD5)
    writeUint8(pdu, 1, ModbusDebugResponse.SUCCESS)
    pdu.set(md5Bytes, 2)

    const result = parseGetMd5Response(pdu)
    expect(result.md5).toBe('abc123def456')
  })

  test('throws on function code mismatch', () => {
    const pdu = new Uint8Array([0x44, 0x7e])
    expect(() => parseGetMd5Response(pdu)).toThrow('Function code mismatch')
  })

  test('throws on error status', () => {
    const pdu = new Uint8Array([0x45, 0x81])
    expect(() => parseGetMd5Response(pdu)).toThrow('error code: 0x81')
  })

  test('throws on too-short response', () => {
    const pdu = new Uint8Array([0x45])
    expect(() => parseGetMd5Response(pdu)).toThrow('too short')
  })
})

describe('parseGetListResponse', () => {
  test('parses successful response', () => {
    // FC=0x44, status=SUCCESS, lastIndex=3 (BE16), tick=10 (BE32), responseSize=2 (BE16), data=[0xFF, 0x01]
    const pdu = new Uint8Array([0x44, 0x7e, 0x00, 0x03, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x02, 0xff, 0x01])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.lastIndex).toBe(3)
      expect(result.tick).toBe(10)
      expect(Array.from(result.data)).toEqual([0xff, 0x01])
    }
  })

  test('returns error on ERROR_OUT_OF_MEMORY', () => {
    const pdu = new Uint8Array([0x44, 0x82])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
      expect(result.code).toBe(0x82)
    }
  })

  test('returns error on ERROR_OUT_OF_BOUNDS', () => {
    const pdu = new Uint8Array([0x44, 0x81])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
      expect(result.code).toBe(0x81)
    }
  })

  test('returns error on function code mismatch', () => {
    const pdu = new Uint8Array([0x45, 0x7e])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe('Function code mismatch')
    }
  })

  test('returns error on incomplete success response', () => {
    // SUCCESS status but not enough bytes for header fields
    const pdu = new Uint8Array([0x44, 0x7e, 0x00, 0x03])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('Incomplete success response')
    }
  })

  test('returns error on incomplete variable data', () => {
    // responseSize says 4 bytes but only 2 follow
    const pdu = new Uint8Array([0x44, 0x7e, 0x00, 0x03, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x04, 0xff, 0x01])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('Incomplete variable data')
    }
  })

  test('returns error on too-short response', () => {
    const pdu = new Uint8Array([0x44])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(true)
  })

  test('parses response with zero data', () => {
    // responseSize=0
    const pdu = new Uint8Array([0x44, 0x7e, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00])
    const result = parseGetListResponse(pdu)
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.lastIndex).toBe(0)
      expect(result.tick).toBe(5)
      expect(result.data.length).toBe(0)
    }
  })
})

describe('parseSetVariableResponse', () => {
  test('parses successful response', () => {
    const pdu = new Uint8Array([0x42, 0x7e])
    const result = parseSetVariableResponse(pdu)
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.success).toBe(true)
    }
  })

  test('returns error on ERROR_OUT_OF_BOUNDS', () => {
    const pdu = new Uint8Array([0x42, 0x81])
    const result = parseSetVariableResponse(pdu)
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.code).toBe(0x81)
    }
  })

  test('returns error on function code mismatch', () => {
    const pdu = new Uint8Array([0x44, 0x7e])
    const result = parseSetVariableResponse(pdu)
    expect('error' in result).toBe(true)
  })

  test('returns error on too-short response', () => {
    const pdu = new Uint8Array([0x42])
    const result = parseSetVariableResponse(pdu)
    expect('error' in result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Cross-validation: PDU bytes match editor's WebSocketDebugClient output
// ---------------------------------------------------------------------------

describe('byte-for-byte compatibility with editor', () => {
  test('getMd5 request matches WebSocketDebugClient', () => {
    // Editor: Buffer.alloc(5), writeUInt8(0x45, 0), writeUInt16BE(0xDEAD, 1), writeUInt8(0, 3), writeUInt8(0, 4)
    const pdu = buildGetMd5Pdu()
    expect(pdu[0]).toBe(0x45) // function code
    expect((pdu[1] << 8) | pdu[2]).toBe(0xdead) // endianness check
    expect(pdu[3]).toBe(0x00)
    expect(pdu[4]).toBe(0x00)
  })

  test('getVariablesList request matches WebSocketDebugClient', () => {
    // Editor: writeUInt8(0x44, 0), writeUInt16BE(numIndexes, 1), writeUInt16BE(each, 3+i*2)
    const indexes = [0, 1, 255, 1000]
    const pdu = buildGetListPdu(indexes)
    expect(pdu[0]).toBe(0x44)
    expect(readUint16BE(pdu, 1)).toBe(4) // numIndexes
    expect(readUint16BE(pdu, 3)).toBe(0)
    expect(readUint16BE(pdu, 5)).toBe(1)
    expect(readUint16BE(pdu, 7)).toBe(255)
    expect(readUint16BE(pdu, 9)).toBe(1000)
  })

  test('setVariable request matches WebSocketDebugClient', () => {
    // Editor: writeUInt8(0x42, 0), writeUInt16BE(idx, 1), writeUInt8(force, 3), writeUInt16BE(dataLen, 4), data at 6
    const value = new Uint8Array([0xab, 0xcd])
    const pdu = buildSetVariablePdu(42, true, value)
    expect(pdu[0]).toBe(0x42) // function code
    expect(readUint16BE(pdu, 1)).toBe(42) // variable index
    expect(pdu[3]).toBe(1) // force flag
    expect(readUint16BE(pdu, 4)).toBe(2) // data length
    expect(pdu[6]).toBe(0xab) // value byte 0
    expect(pdu[7]).toBe(0xcd) // value byte 1
  })
})
