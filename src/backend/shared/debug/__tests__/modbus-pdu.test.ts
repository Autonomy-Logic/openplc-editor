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
  buildGetListRequest,
  buildGetMd5Request,
  buildSetVariableRequest,
  parseGetListResponse,
  parseGetMd5Response,
  parseSetVariableResponse,
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

describe('responseFunctionCode', () => {
  it('returns the first byte', () => {
    expect(responseFunctionCode(new Uint8Array([0x45, 0x00]))).toBe(0x45)
  })

  it('returns undefined for an empty buffer', () => {
    expect(responseFunctionCode(new Uint8Array(0))).toBeUndefined()
  })
})
