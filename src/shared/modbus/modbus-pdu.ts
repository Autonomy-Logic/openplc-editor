// Shared Modbus PDU module — browser and Node.js compatible.
// No dependencies. Uses Uint8Array (Buffer extends Uint8Array in Node.js).
//
// This module contains:
// - Modbus debug function codes and response status codes
// - PDU builders for debug requests (transport-agnostic)
// - PDU parsers for debug responses (transport-agnostic)
// - Hex string encoding/decoding for WebSocket and WebRTC transports
// - Uint8Array byte helpers

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
}

// ---------------------------------------------------------------------------
// Uint8Array byte helpers
// ---------------------------------------------------------------------------

export function allocBytes(size: number): Uint8Array {
  return new Uint8Array(size)
}

export function readUint8(buf: Uint8Array, offset: number): number {
  return buf[offset]
}

export function writeUint8(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value
}

export function readUint16BE(buf: Uint8Array, offset: number): number {
  return (buf[offset] << 8) | buf[offset + 1]
}

export function writeUint16BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 8) & 0xff
  buf[offset + 1] = value & 0xff
}

export function readUint32BE(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
}

// ---------------------------------------------------------------------------
// Hex string encoding/decoding (for WebSocket and WebRTC transports)
// ---------------------------------------------------------------------------

export function bytesToHexString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

export function hexStringToBytes(hex: string): Uint8Array {
  const parts = hex.split(' ')
  const bytes = new Uint8Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    bytes[i] = parseInt(parts[i], 16)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// PDU builders — return raw PDU bytes (function code + payload).
// Consumers add transport framing:
//   TCP: prepend MBAP header
//   RTU: prepend slave ID, append CRC
//   WebSocket/WebRTC: hex-encode with bytesToHexString()
// ---------------------------------------------------------------------------

export function buildGetMd5Pdu(): Uint8Array {
  const pdu = allocBytes(5)
  writeUint8(pdu, 0, ModbusFunctionCode.DEBUG_GET_MD5)
  writeUint16BE(pdu, 1, 0xdead) // endianness check marker
  writeUint8(pdu, 3, 0)
  writeUint8(pdu, 4, 0)
  return pdu
}

export function buildGetListPdu(indexes: number[]): Uint8Array {
  const numIndexes = indexes.length
  const pdu = allocBytes(3 + 2 * numIndexes)
  writeUint8(pdu, 0, ModbusFunctionCode.DEBUG_GET_LIST)
  writeUint16BE(pdu, 1, numIndexes)
  for (let i = 0; i < numIndexes; i++) {
    writeUint16BE(pdu, 3 + i * 2, indexes[i])
  }
  return pdu
}

export function buildSetVariablePdu(index: number, force: boolean, value?: Uint8Array): Uint8Array {
  const dataLength = force && value ? value.length : 1
  const pdu = allocBytes(6 + dataLength)
  writeUint8(pdu, 0, ModbusFunctionCode.DEBUG_SET)
  writeUint16BE(pdu, 1, index)
  writeUint8(pdu, 3, force ? 1 : 0)
  writeUint16BE(pdu, 4, dataLength)
  if (force && value) {
    pdu.set(value, 6)
  } else {
    writeUint8(pdu, 6, 0)
  }
  return pdu
}

// ---------------------------------------------------------------------------
// PDU response parsers — take raw PDU bytes starting at the function code.
// Consumers strip transport framing before calling:
//   TCP: skip MBAP header (7 bytes) → PDU at offset 7
//   RTU: skip padding (6 bytes) + slave ID (1 byte) → PDU at offset 7
//   WebSocket/WebRTC: hexStringToBytes() → PDU at offset 0
// ---------------------------------------------------------------------------

export interface GetMd5Result {
  md5: string
}

export interface GetListResult {
  lastIndex: number
  tick: number
  data: Uint8Array
}

export interface SetVariableResult {
  success: true
}

export interface PduError {
  error: string
  code: number
}

export function parseGetMd5Response(pdu: Uint8Array): GetMd5Result {
  if (pdu.length < 2) {
    throw new Error('Invalid response: too short')
  }

  const fc = readUint8(pdu, 0)
  const status = readUint8(pdu, 1)

  if (fc !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
    throw new Error('Function code mismatch')
  }

  if (status !== (ModbusDebugResponse.SUCCESS as number)) {
    throw new Error(`Target returned error code: 0x${status.toString(16)}`)
  }

  const md5Bytes = pdu.slice(2)
  const md5String = new TextDecoder().decode(md5Bytes).trim()
  return { md5: md5String }
}

export function parseGetListResponse(pdu: Uint8Array): GetListResult | PduError {
  if (pdu.length < 2) {
    return { error: `Invalid response: too short (${pdu.length} bytes, need at least 2)`, code: 0 }
  }

  const fc = readUint8(pdu, 0)
  const status = readUint8(pdu, 1)

  if (fc !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
    return { error: 'Function code mismatch', code: 0 }
  }

  if (status === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
    return { error: 'ERROR_OUT_OF_BOUNDS', code: status }
  }

  if (status === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
    return { error: 'ERROR_OUT_OF_MEMORY', code: status }
  }

  if (status !== (ModbusDebugResponse.SUCCESS as number)) {
    return { error: `Unknown error code: 0x${status.toString(16)}`, code: status }
  }

  if (pdu.length < 10) {
    return { error: `Incomplete success response (${pdu.length} bytes, expected at least 10)`, code: 0 }
  }

  const lastIndex = readUint16BE(pdu, 2)
  const tick = readUint32BE(pdu, 4)
  const responseSize = readUint16BE(pdu, 8)

  if (pdu.length < 10 + responseSize) {
    return {
      error: `Incomplete variable data (expected ${responseSize} bytes, got ${pdu.length - 10})`,
      code: 0,
    }
  }

  const data = pdu.slice(10, 10 + responseSize)
  return { lastIndex, tick, data }
}

export function parseSetVariableResponse(pdu: Uint8Array): SetVariableResult | PduError {
  if (pdu.length < 2) {
    return { error: `Invalid response: too short (${pdu.length} bytes, need at least 2)`, code: 0 }
  }

  const fc = readUint8(pdu, 0)
  const status = readUint8(pdu, 1)

  if (fc !== (ModbusFunctionCode.DEBUG_SET as number)) {
    return { error: 'Function code mismatch', code: 0 }
  }

  if (status === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
    return { error: 'ERROR_OUT_OF_BOUNDS', code: status }
  }

  if (status === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
    return { error: 'ERROR_OUT_OF_MEMORY', code: status }
  }

  if (status !== (ModbusDebugResponse.SUCCESS as number)) {
    return { error: `Unknown error code: 0x${status.toString(16)}`, code: status }
  }

  return { success: true }
}
