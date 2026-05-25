/**
 * Modbus PDU builder/parser — pure helpers for the OpenPLC v4 debug
 * wire protocol.  Builds and parses Modbus PDUs (no TCP header, no
 * CRC) used over every transport (WebSocket on real runtimes,
 * RTU/serial for the simulator, WebRTC data channel on the web edition).
 *
 * Canonical, byte-identical on openplc-editor + openplc-web — the
 * only difference between platforms is the transport that carries
 * the bytes, not the bytes themselves.  Editor's
 * `WebSocketDebugClient` and web's `ModbusDataChannelTransport` both
 * route through these functions.
 *
 * PDU layouts (Phase 4 / strucpp wire — every address is `arr:u8 +
 * elem:u16 BE`, three bytes total.  The runtime uses the same packing
 * editor's `WebSocketDebugClient` has emitted since the strucpp
 * migration; web's older two-byte packing was MatIEC residue and is
 * gone here.  Callers pass `packed = (arr << 16) | elem` and the
 * builders split the bytes themselves):
 *
 *   getMd5 request:   [FC=0x45] [0xDE 0xAD] [0x00 0x00]
 *   getMd5 response:  [FC=0x45] [status] [MD5 UTF-8 chars...] [endian-sentinel: U16 native]
 *
 *   getList request:   [FC=0x44] [numIndexes: U16BE] [arr0:U8 elem0:U16BE] [arr1:U8 elem1:U16BE] ...
 *   getList response:  [FC=0x44] [status] [lastIndex: U16BE] [tick: U32BE] [size: U16BE] [data...]
 *
 *   set request:   [FC=0x42] [arr: U8] [elem: U16BE] [force: U8] [dataLen: U16BE] [value...]
 *   set response:  [FC=0x42] [status]
 *
 * The MD5 response's trailing 2 bytes are an endianness sentinel —
 * the runtime stores the literal value 0xDEAD through a native
 * `uint16_t*`, so the bytes on the wire reveal target byte order:
 *
 *     LE target → trailer = [0xAD, 0xDE]
 *     BE target → trailer = [0xDE, 0xAD]
 *
 * Stripping the trailer before decoding the MD5 string is mandatory:
 * 0xAD / 0xDE are invalid UTF-8 standalone bytes, so a naive
 * `TextDecoder.decode(...)` over the whole tail produces two
 * U+FFFD replacement characters appended to the hex string and the
 * subsequent equality test against the cached MD5 fails.
 */

import { detectTargetEndian, type TargetEndian } from '../../../frontend/utils/endian'
import { ModbusDebugResponse, ModbusFunctionCode } from '../simulator/types'
import type { DebugSetResult, DebugTransportResult, Md5ProbeResult } from './types'

// ---------------------------------------------------------------------------
// Uint8Array helpers — host-endian-agnostic, no typed-array views on wire data.
// ---------------------------------------------------------------------------

function alloc(size: number): Uint8Array {
  return new Uint8Array(size)
}

function writeU8(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value
}

function writeU16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 8) & 0xff
  buf[offset + 1] = value & 0xff
}

function readU8(buf: Uint8Array, offset: number): number {
  return buf[offset]
}

function readU16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1]
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
}

// ---------------------------------------------------------------------------
// Status code helper
// ---------------------------------------------------------------------------

function statusError(code: number): string {
  if (code === ModbusDebugResponse.ERROR_OUT_OF_BOUNDS) return 'ERROR_OUT_OF_BOUNDS'
  if (code === ModbusDebugResponse.ERROR_OUT_OF_MEMORY) return 'ERROR_OUT_OF_MEMORY'
  return `Unknown error code: 0x${code.toString(16)}`
}

// ---------------------------------------------------------------------------
// Build requests
// ---------------------------------------------------------------------------

export function buildGetMd5Request(): Uint8Array {
  const buf = alloc(5)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_MD5)
  writeU16BE(buf, 1, 0xdead) // endianness check (echoed-back-style; the runtime ignores this)
  writeU16BE(buf, 3, 0x0000) // padding
  return buf
}

/**
 * `indexes` carry packed DebugAddr (`(arr << 16) | elem`) — what
 * `frontend/utils/debug-parser.ts:packDebugAddr` produces from the
 * strucpp debug-map.  Wire layout is 3 bytes per address.
 */
export function buildGetListRequest(indexes: number[]): Uint8Array {
  const buf = alloc(3 + 3 * indexes.length)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_LIST)
  writeU16BE(buf, 1, indexes.length)
  for (let i = 0; i < indexes.length; i++) {
    const arr = (indexes[i] >>> 16) & 0xff
    const elem = indexes[i] & 0xffff
    writeU8(buf, 3 + i * 3, arr)
    writeU16BE(buf, 3 + i * 3 + 1, elem)
  }
  return buf
}

/**
 * `index` is packed DebugAddr (`(arr << 16) | elem`).  Wire layout:
 * [FC=0x42, arr:U8, elem:U16BE, force:U8, len:U16BE, value...].
 */
export function buildSetVariableRequest(index: number, force: boolean, valueBuffer?: Uint8Array): Uint8Array {
  const dataLength = force && valueBuffer ? valueBuffer.length : 1
  const buf = alloc(7 + dataLength)
  const arr = (index >>> 16) & 0xff
  const elem = index & 0xffff
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_SET)
  writeU8(buf, 1, arr)
  writeU16BE(buf, 2, elem)
  writeU8(buf, 4, force ? 1 : 0)
  writeU16BE(buf, 5, dataLength)
  if (force && valueBuffer) {
    buf.set(valueBuffer, 7)
  } else {
    writeU8(buf, 7, 0)
  }
  return buf
}

// ---------------------------------------------------------------------------
// Parse responses
// ---------------------------------------------------------------------------

/**
 * Parse a `getMd5` response into `{ md5, targetEndian }`.
 *
 * Layout: `[FC][status][md5 chars...][sentinel hi][sentinel lo]`.
 * The two trailing sentinel bytes MUST be stripped before the
 * middle is UTF-8 decoded — see the module docblock.  The same
 * bytes drive the target-endian classification via `detectTargetEndian`.
 *
 * Returns the MD5 lowercased and null-trimmed; trailing whitespace
 * is also stripped defensively (some pre-rc builds padded the string
 * with spaces).
 */
export function parseGetMd5Response(data: Uint8Array): Md5ProbeResult {
  if (data.length < 2) {
    throw new Error(`Invalid MD5 response: too short (${data.length} bytes)`)
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_GET_MD5) {
    throw new Error('Function code mismatch in MD5 response')
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    // The runtime's `respond_short` emits a 2-byte error frame (FC
    // + status) — no MD5 chars, no trailer.  Surface the status
    // verbatim without enforcing the success-path length floor.
    throw new Error(`MD5 request failed: ${statusError(status)}`)
  }

  // Success path: the runtime appends a 2-byte endianness sentinel
  // (0xDEAD via native `uint16_t*` store) after the MD5 chars.  Must
  // be present in any well-formed SUCCESS response.
  if (data.length < 4) {
    throw new Error(`Invalid MD5 response: success payload too short (${data.length} bytes)`)
  }

  // Endian sentinel: last 2 bytes.  Strip before decoding the MD5
  // text — see module docblock for why TextDecoder otherwise produces
  // two U+FFFD replacement chars and the equality test fails.
  const trailerHi = readU8(data, data.length - 2)
  const trailerLo = readU8(data, data.length - 1)
  const targetEndian: TargetEndian = detectTargetEndian(trailerHi, trailerLo)

  const md5Bytes = data.subarray(2, data.length - 2)
  const md5 = new TextDecoder('utf-8').decode(md5Bytes).replace(/\0+$/, '').trim()

  return { md5, targetEndian }
}

export function parseGetListResponse(data: Uint8Array): DebugTransportResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_GET_LIST) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  if (data.length < 10) {
    return { success: false, error: `Incomplete success response (${data.length} bytes, expected at least 10)` }
  }

  const lastIndex = readU16BE(data, 2)
  const tick = readU32BE(data, 4)
  const responseSize = readU16BE(data, 8)

  if (data.length < 10 + responseSize) {
    return {
      success: false,
      error: `Incomplete variable data (expected ${responseSize} bytes, got ${data.length - 10})`,
    }
  }

  return {
    success: true,
    tick,
    lastIndex,
    data: data.slice(10, 10 + responseSize),
  }
}

export function parseSetVariableResponse(data: Uint8Array): DebugSetResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_SET) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  return { success: true }
}

/**
 * Extract the function code from a Modbus PDU response.
 * Returns `undefined` if the buffer is empty.
 */
export function responseFunctionCode(data: Uint8Array): number | undefined {
  return data.length > 0 ? readU8(data, 0) : undefined
}
