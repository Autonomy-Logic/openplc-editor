// jsdom (editor's Jest environment) doesn't ship TextEncoder /
// TextDecoder by default — polyfill from Node's util before
// the module under test imports.
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'

if (typeof globalThis.TextEncoder === 'undefined') {
  ;(globalThis as { TextEncoder: typeof TextEncoder }).TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  ;(globalThis as { TextDecoder: typeof TextDecoder }).TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
}

import { ModbusDebugResponse, ModbusFunctionCode } from '../../simulator/types'
import {
  buildGetBoardIdRequest,
  buildGetListRequest,
  buildGetMd5Request,
  buildGetStatusRequest,
  buildGetVersionRequest,
  buildReadLicenseRequest,
  buildSetVariableRequest,
  buildWriteLicenseRequest,
  parseGetBoardIdResponse,
  parseGetListResponse,
  parseGetMd5Response,
  parseGetStatusResponse,
  parseGetVersionResponse,
  parseReadLicenseResponse,
  parseSetVariableResponse,
  parseWriteLicenseResponse,
  responseFunctionCode,
} from '../modbus-pdu'

const TextEnc = globalThis.TextEncoder

describe('buildGetMd5Request', () => {
  it('emits a 5-byte frame with FC + 0xDEAD probe + zero padding', () => {
    const buf = buildGetMd5Request()
    expect(buf).toHaveLength(5)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_GET_MD5)
    expect(buf[1]).toBe(0xde)
    expect(buf[2]).toBe(0xad)
    expect(buf[3]).toBe(0)
    expect(buf[4]).toBe(0)
  })
})

describe('parseGetMd5Response', () => {
  function makeFrame(md5: string, trailer: [number, number]): Uint8Array {
    const md5Bytes = new TextEnc().encode(md5)
    const buf = new Uint8Array(2 + md5Bytes.length + 2)
    buf[0] = ModbusFunctionCode.DEBUG_GET_MD5
    buf[1] = ModbusDebugResponse.SUCCESS
    buf.set(md5Bytes, 2)
    buf[buf.length - 2] = trailer[0]
    buf[buf.length - 1] = trailer[1]
    return buf
  }

  it('strips the 0xAD/0xDE LE sentinel and returns the clean MD5', () => {
    // Regression for the spurious "Program Mismatch" — without
    // stripping, the sentinel bytes decoded into two trailing
    // U+FFFD replacement characters.
    const md5 = 'bf771788ff8ce5d1fd61053b079c5830'
    const result = parseGetMd5Response(makeFrame(md5, [0xad, 0xde]))
    expect(result.md5).toBe(md5)
    expect(result.md5).not.toMatch(/�/)
    expect(result.targetEndian).toBe('le')
  })

  it('returns targetEndian "be" for the 0xDE/0xAD BE sentinel', () => {
    const md5 = 'abcdef1234567890abcdef1234567890'
    const result = parseGetMd5Response(makeFrame(md5, [0xde, 0xad]))
    expect(result.md5).toBe(md5)
    expect(result.targetEndian).toBe('be')
  })

  it('strips any trailing null terminator before returning the MD5', () => {
    const buf = new Uint8Array(2 + 32 + 1 + 2)
    buf[0] = ModbusFunctionCode.DEBUG_GET_MD5
    buf[1] = ModbusDebugResponse.SUCCESS
    const md5 = 'abcdef1234567890abcdef1234567890'
    buf.set(new TextEnc().encode(md5), 2)
    buf[2 + 32] = 0x00 // null terminator the runtime sometimes appends
    buf[buf.length - 2] = 0xad
    buf[buf.length - 1] = 0xde
    expect(parseGetMd5Response(buf).md5).toBe(md5)
  })

  it('throws when the buffer is too short', () => {
    expect(() => parseGetMd5Response(new Uint8Array([0x45]))).toThrow('too short')
  })

  it('throws on function code mismatch', () => {
    expect(() => parseGetMd5Response(new Uint8Array([0x00, ModbusDebugResponse.SUCCESS, 0xad, 0xde]))).toThrow(
      'Function code mismatch',
    )
  })

  it('throws on error status OUT_OF_BOUNDS', () => {
    expect(() =>
      parseGetMd5Response(
        new Uint8Array([ModbusFunctionCode.DEBUG_GET_MD5, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS, 0xad, 0xde]),
      ),
    ).toThrow('ERROR_OUT_OF_BOUNDS')
  })
})

describe('buildGetListRequest', () => {
  it('packs each address as arr:U8 + elem:U16BE (3 bytes) after FC + count', () => {
    // Two packed DebugAddrs:
    //   (arr=0x05, elem=0x0102) → packed = (0x05 << 16) | 0x0102 = 0x050102
    //   (arr=0x07, elem=0x0304) → packed = (0x07 << 16) | 0x0304 = 0x070304
    const buf = buildGetListRequest([0x050102, 0x070304])
    expect(buf).toHaveLength(3 + 3 * 2)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_GET_LIST)
    expect(buf[1]).toBe(0x00)
    expect(buf[2]).toBe(0x02) // count = 2 (U16BE)
    // First address: arr=0x05, elem=0x0102
    expect(buf[3]).toBe(0x05)
    expect(buf[4]).toBe(0x01)
    expect(buf[5]).toBe(0x02)
    // Second address: arr=0x07, elem=0x0304
    expect(buf[6]).toBe(0x07)
    expect(buf[7]).toBe(0x03)
    expect(buf[8]).toBe(0x04)
  })
})

describe('parseGetListResponse', () => {
  it('returns tick / lastIndex / data on success', () => {
    const buf = new Uint8Array(12)
    buf[0] = ModbusFunctionCode.DEBUG_GET_LIST
    buf[1] = ModbusDebugResponse.SUCCESS
    buf[2] = 0x00
    buf[3] = 0x07 // lastIndex = 7
    buf[4] = 0x00
    buf[5] = 0x00
    buf[6] = 0x00
    buf[7] = 0x2a // tick = 42
    buf[8] = 0x00
    buf[9] = 0x02 // size = 2
    buf[10] = 0xaa
    buf[11] = 0xbb
    const result = parseGetListResponse(buf)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.lastIndex).toBe(7)
      expect(result.tick).toBe(42)
      expect(Array.from(result.data!)).toEqual([0xaa, 0xbb])
    }
  })

  it('flags truncated responses', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_GET_LIST, ModbusDebugResponse.SUCCESS])
    const result = parseGetListResponse(buf)
    expect(result.success).toBe(false)
  })
})

describe('buildSetVariableRequest / parseSetVariableResponse', () => {
  it('builds force-write as [FC, arr:U8, elem:U16BE, force:U8, len:U16BE, value...]', () => {
    // packed = (arr=0x03 << 16) | elem=0x0102 = 0x030102
    const buf = buildSetVariableRequest(0x030102, true, new Uint8Array([0xff, 0xfe]))
    expect(buf).toHaveLength(7 + 2)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_SET)
    expect(buf[1]).toBe(0x03) // arr
    expect(buf[2]).toBe(0x01) // elem high
    expect(buf[3]).toBe(0x02) // elem low
    expect(buf[4]).toBe(1) // force flag
    expect(buf[5]).toBe(0x00) // dataLen high
    expect(buf[6]).toBe(0x02) // dataLen low
    expect(buf[7]).toBe(0xff)
    expect(buf[8]).toBe(0xfe)
  })

  it('builds release-force (force=false) with single zero-byte payload', () => {
    // packed = (arr=0x00 << 16) | elem=0x0010 = 0x0010
    const buf = buildSetVariableRequest(0x0010, false)
    expect(buf[1]).toBe(0x00) // arr
    expect(buf[2]).toBe(0x00) // elem high
    expect(buf[3]).toBe(0x10) // elem low
    expect(buf[4]).toBe(0) // force flag off
    expect(buf[5]).toBe(0x00)
    expect(buf[6]).toBe(0x01) // dataLen = 1
    expect(buf[7]).toBe(0x00) // payload byte
  })

  it('parses success', () => {
    expect(
      parseSetVariableResponse(new Uint8Array([ModbusFunctionCode.DEBUG_SET, ModbusDebugResponse.SUCCESS])),
    ).toEqual({ success: true })
  })

  it('parses error status', () => {
    const result = parseSetVariableResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_SET, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS]),
    )
    expect(result.success).toBe(false)
  })
})

describe('buildGetStatusRequest / parseGetStatusResponse', () => {
  it('builds a bare 1-byte FC PDU', () => {
    const buf = buildGetStatusRequest()
    expect(buf).toHaveLength(1)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_GET_STATUS)
  })

  it('parses running / tick / uptime on success', () => {
    const buf = new Uint8Array([
      ModbusFunctionCode.DEBUG_GET_STATUS,
      ModbusDebugResponse.SUCCESS,
      0x01, // running = true
      0x00,
      0x00,
      0x00,
      0x2a, // tick = 42
      0x00,
      0x00,
      0x01,
      0x00, // uptime = 256
    ])
    const result = parseGetStatusResponse(buf)
    expect(result).toEqual({ success: true, running: true, tick: 42, uptimeMs: 256 })
  })

  it('reports running=false when the flag byte is zero', () => {
    const buf = new Uint8Array([
      ModbusFunctionCode.DEBUG_GET_STATUS,
      ModbusDebugResponse.SUCCESS,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ])
    expect(parseGetStatusResponse(buf).running).toBe(false)
  })

  it('flags too-short buffer', () => {
    const result = parseGetStatusResponse(new Uint8Array([ModbusFunctionCode.DEBUG_GET_STATUS]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too short/)
  })

  it('flags function code mismatch', () => {
    const result = parseGetStatusResponse(new Uint8Array([0x00, ModbusDebugResponse.SUCCESS]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/mismatch/)
  })

  it('surfaces error status', () => {
    const result = parseGetStatusResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_GET_STATUS, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS]),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
  })

  it('flags an incomplete success payload', () => {
    const result = parseGetStatusResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_GET_STATUS, ModbusDebugResponse.SUCCESS, 0x01]),
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Incomplete/)
  })
})

describe('buildGetVersionRequest / parseGetVersionResponse', () => {
  it('builds a bare 1-byte FC PDU', () => {
    const buf = buildGetVersionRequest()
    expect(buf).toHaveLength(1)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_GET_VERSION)
  })

  it('parses the ASCII version string on success', () => {
    const ver = new TextEnc().encode('4.2.7')
    const buf = new Uint8Array(2 + ver.length)
    buf[0] = ModbusFunctionCode.DEBUG_GET_VERSION
    buf[1] = ModbusDebugResponse.SUCCESS
    buf.set(ver, 2)
    expect(parseGetVersionResponse(buf)).toEqual({ success: true, version: '4.2.7' })
  })

  it('strips a trailing NUL terminator', () => {
    const buf = new Uint8Array([
      ModbusFunctionCode.DEBUG_GET_VERSION,
      ModbusDebugResponse.SUCCESS,
      0x31,
      0x2e,
      0x30,
      0x00,
    ])
    expect(parseGetVersionResponse(buf).version).toBe('1.0')
  })

  it('flags too-short buffer', () => {
    const result = parseGetVersionResponse(new Uint8Array([ModbusFunctionCode.DEBUG_GET_VERSION]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too short/)
  })

  it('flags function code mismatch', () => {
    const result = parseGetVersionResponse(new Uint8Array([0x00, ModbusDebugResponse.SUCCESS]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/mismatch/)
  })

  it('surfaces error status', () => {
    const result = parseGetVersionResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_GET_VERSION, ModbusDebugResponse.ERROR_OUT_OF_MEMORY]),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
  })
})

describe('buildGetBoardIdRequest / parseGetBoardIdResponse', () => {
  it('builds a bare 1-byte FC PDU', () => {
    const buf = buildGetBoardIdRequest()
    expect(buf).toHaveLength(1)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_GET_BOARD_ID)
  })

  it('parses id bytes and hex on success', () => {
    const buf = new Uint8Array([
      ModbusFunctionCode.DEBUG_GET_BOARD_ID,
      ModbusDebugResponse.SUCCESS,
      0x03, // id_len = 3
      0x0a,
      0xbc,
      0x01,
    ])
    const result = parseGetBoardIdResponse(buf)
    expect(result.success).toBe(true)
    expect(Array.from(result.boardId!)).toEqual([0x0a, 0xbc, 0x01])
    expect(result.boardIdHex).toBe('0abc01')
  })

  it('handles id_len = 0 (unsupported core) as success with empty id', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, 0x00])
    const result = parseGetBoardIdResponse(buf)
    expect(result.success).toBe(true)
    expect(result.boardIdHex).toBe('')
    expect(Array.from(result.boardId!)).toEqual([])
  })

  it('flags too-short buffer', () => {
    const result = parseGetBoardIdResponse(new Uint8Array([ModbusFunctionCode.DEBUG_GET_BOARD_ID]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/too short/)
  })

  it('flags function code mismatch', () => {
    const result = parseGetBoardIdResponse(new Uint8Array([0x00, ModbusDebugResponse.SUCCESS]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/mismatch/)
  })

  it('surfaces error status', () => {
    const result = parseGetBoardIdResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS]),
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
  })

  it('flags a missing id_len byte', () => {
    const result = parseGetBoardIdResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS]),
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/at least 3/)
  })

  it('flags truncated id bytes', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, 0x04, 0x0a, 0x0b])
    const result = parseGetBoardIdResponse(buf)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Incomplete board-id data/)
  })
})

describe('responseFunctionCode', () => {
  it('returns the first byte', () => {
    expect(responseFunctionCode(new Uint8Array([0x45, 0x00]))).toBe(0x45)
  })

  it('returns undefined for an empty buffer', () => {
    expect(responseFunctionCode(new Uint8Array(0))).toBeUndefined()
  })
})

describe('buildWriteLicenseRequest', () => {
  it('emits [FC][len:U16BE][blob] with big-endian length', () => {
    // 260-byte blob proves the length is BE (0x01 0x04), not LE.
    const blob = new Uint8Array(260).fill(0xab)
    blob[0] = 0x4f // 'O' — magic first byte, sanity marker
    const buf = buildWriteLicenseRequest(blob)
    expect(buf).toHaveLength(3 + 260)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_WRITE_LICENSE)
    expect(buf[1]).toBe(0x01) // len hi
    expect(buf[2]).toBe(0x04) // len lo (260 = 0x0104)
    expect(buf[3]).toBe(0x4f)
    expect(buf[buf.length - 1]).toBe(0xab)
  })

  it('handles a zero-length blob', () => {
    const buf = buildWriteLicenseRequest(new Uint8Array(0))
    expect(buf).toHaveLength(3)
    expect(buf[1]).toBe(0)
    expect(buf[2]).toBe(0)
  })
})

describe('parseWriteLicenseResponse', () => {
  it('returns success on SUCCESS status', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.SUCCESS])
    const result = parseWriteLicenseResponse(buf)
    expect(result.success).toBe(true)
    expect(result.status).toBe(ModbusDebugResponse.SUCCESS)
  })

  it('surfaces an out-of-bounds (TOO_LARGE, 0x81) status as failure', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS])
    const result = parseWriteLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.status).toBe(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS)
    expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
  })

  it('surfaces an out-of-memory (0x82) status as failure', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.ERROR_OUT_OF_MEMORY])
    const result = parseWriteLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.status).toBe(ModbusDebugResponse.ERROR_OUT_OF_MEMORY)
    expect(result.error).toBe('ERROR_OUT_OF_MEMORY')
  })

  it('treats LIC_EMPTY / LIC_CORRUPT statuses on a WRITE response as failures (not valid write states)', () => {
    // EMPTY/CORRUPT are read-side device states; a WRITE that echoes them is
    // not SUCCESS, so the write must be reported as failed.
    const empty = parseWriteLicenseResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.LIC_EMPTY]),
    )
    expect(empty.success).toBe(false)
    expect(empty.status).toBe(ModbusDebugResponse.LIC_EMPTY)

    const corrupt = parseWriteLicenseResponse(
      new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.LIC_CORRUPT]),
    )
    expect(corrupt.success).toBe(false)
    expect(corrupt.status).toBe(ModbusDebugResponse.LIC_CORRUPT)
  })

  it('rejects a function-code mismatch', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.SUCCESS])
    expect(parseWriteLicenseResponse(buf).success).toBe(false)
  })

  it('rejects a too-short frame', () => {
    expect(parseWriteLicenseResponse(new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE])).success).toBe(false)
  })
})

describe('buildReadLicenseRequest', () => {
  it('emits a bare [FC] frame', () => {
    const buf = buildReadLicenseRequest()
    expect(buf).toHaveLength(1)
    expect(buf[0]).toBe(ModbusFunctionCode.DEBUG_READ_LICENSE)
  })
})

describe('parseReadLicenseResponse', () => {
  it('extracts the blob on SUCCESS using a BE length', () => {
    const blob = new Uint8Array([0x4f, 0x50, 0x4c, 0x43, 0xde, 0xad])
    const buf = new Uint8Array(4 + blob.length)
    buf[0] = ModbusFunctionCode.DEBUG_READ_LICENSE
    buf[1] = ModbusDebugResponse.SUCCESS
    buf[2] = 0x00 // len hi
    buf[3] = blob.length // len lo
    buf.set(blob, 4)
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(true)
    expect(result.empty).toBeUndefined()
    expect(result.corrupt).toBeUndefined()
    expect(Array.from(result.blob!)).toEqual(Array.from(blob))
    // magic first byte survives the round-trip (endianness sanity)
    expect(result.blob![0]).toBe(0x4f)
  })

  it('classifies LIC_EMPTY as success + empty (no blob)', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.LIC_EMPTY])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(true)
    expect(result.empty).toBe(true)
    expect(result.blob).toBeUndefined()
  })

  it('classifies LIC_CORRUPT as success + corrupt (no blob)', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.LIC_CORRUPT])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(true)
    expect(result.corrupt).toBe(true)
    expect(result.blob).toBeUndefined()
  })

  it('surfaces an out-of-bounds (TOO_LARGE, 0x81) status as failure with no blob', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.ERROR_OUT_OF_BOUNDS])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.status).toBe(ModbusDebugResponse.ERROR_OUT_OF_BOUNDS)
    expect(result.error).toBe('ERROR_OUT_OF_BOUNDS')
    expect(result.blob).toBeUndefined()
  })

  it('surfaces an out-of-memory (0x82) status as failure', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.ERROR_OUT_OF_MEMORY])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.status).toBe(ModbusDebugResponse.ERROR_OUT_OF_MEMORY)
  })

  it('rejects a function-code mismatch', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_WRITE_LICENSE, ModbusDebugResponse.SUCCESS])
    expect(parseReadLicenseResponse(buf).success).toBe(false)
  })

  it('flags a truncated blob', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.SUCCESS, 0x00, 0x08, 0x01])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Incomplete license blob/)
  })

  it('flags a success frame missing the length field', () => {
    const buf = new Uint8Array([ModbusFunctionCode.DEBUG_READ_LICENSE, ModbusDebugResponse.SUCCESS])
    const result = parseReadLicenseResponse(buf)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/at least 4/)
  })
})
