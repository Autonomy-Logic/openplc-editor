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
 *   plcSetState request:  [FC=0x4b] [state: U8]   (0 = STOP, 1 = RUN)
 *   plcSetState response: [FC=0x4b] [status] [plcState: U8] [switchPosition: U8]
 *
 *   writeLicense request:  [FC=0x49] [len: U16BE] [blob...]
 *   writeLicense response: [FC=0x49] [status]
 *
 *   readLicense request:   [FC=0x4a]
 *   readLicense response:  [FC=0x4a] [status] [len: U16BE] [blob...]   (SUCCESS)
 *                          [FC=0x4a] [status]                          (otherwise)
 *
 * The license `len` is BIG-ENDIAN like every other length on this wire, while
 * the blob it frames is little-endian content (see license-blob.ts). The two
 * conventions coexist by design: the framing is Modbus, the payload is a C
 * struct.
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
import type { RtosServiceStats, RtosStats, RtosTaskStats } from '../../../middleware/shared/ports/types'
import { ModbusDebugResponse, ModbusFunctionCode, PlcRuntimeState } from '../simulator/types'
import type {
  DebugAnchorResult,
  DebugDeviceIdResult,
  DebugLicenseReadResult,
  DebugLicenseWriteResult,
  DebugSetResult,
  DebugStatusResult,
  DebugTaskStatsResult,
  DebugTransportResult,
  DebugVersionResult,
  Md5ProbeResult,
  PlcControlResult,
} from './types'

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

const MODBUS_EXCEPTION_SLAVE_FAILURE = 0x04
const MODBUS_EXCEPTION_SLAVE_BUSY = 0x06

/**
 * A board in RTOS mode refuses a debugger write with "slave device busy" while
 * the task owning the variable is stalled mid-scan (typically a block waiting on
 * the network). Nothing was written, and the request can be repeated.
 */
export const DEBUG_BUSY_ERROR = 'The PLC is busy: a scan is taking longer than its period. Try again.'

export function isBusyException(functionCode: number, exceptionCode: number): boolean {
  return functionCode >= 0x80 && exceptionCode === MODBUS_EXCEPTION_SLAVE_BUSY
}

// Firmware that runs out of frame answers GET_LIST with this exception; callers treat it as out of memory.
export function isGetListOverflowException(functionCode: number, exceptionCode: number): boolean {
  return (
    functionCode === (ModbusFunctionCode.DEBUG_GET_LIST as number) + 0x80 &&
    exceptionCode === MODBUS_EXCEPTION_SLAVE_FAILURE
  )
}

function statusError(code: number): string {
  if (code === ModbusDebugResponse.ERROR_OUT_OF_BOUNDS) return 'ERROR_OUT_OF_BOUNDS'
  if (code === ModbusDebugResponse.ERROR_OUT_OF_MEMORY) return 'ERROR_OUT_OF_MEMORY'
  // A CONSTANT is refused by the target, not by us: it is emitted as a `const`
  // C++ member and the debug table reaches it through a cast that strips the
  // qualifier, so the runtime's own gate is what holds — which is what keeps an
  // OPC-UA client or an older editor from writing through to it. Decoded here
  // so the user reads the reason instead of "Unknown error code: 0x87".
  if (code === ModbusDebugResponse.READ_ONLY) {
    return 'This variable is declared CONSTANT and cannot be written or forced'
  }
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

// Always-on debugger extras. Each is a bare [FC] PDU — no payload — mirroring
// the firmware's `mb_rtu_frame_len` entry of 4 (id + FC + 2 CRC bytes).

export function buildGetStatusRequest(): Uint8Array {
  const buf = alloc(1)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_STATUS)
  return buf
}

export function buildGetVersionRequest(): Uint8Array {
  const buf = alloc(1)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_VERSION)
  return buf
}

export function buildGetDeviceIdRequest(): Uint8Array {
  const buf = alloc(1)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_DEVICE_ID)
  return buf
}

/**
 * Build a write-license request (FC 0x49).
 * PDU: `[FC][len:U16BE][blob...]`.
 *
 * The `len` on the wire is BIG-ENDIAN (matches every other debug FC), even
 * though the blob *content* is little-endian (see license-blob.ts). Do not
 * confuse the two: `writeU16BE` is deliberate here.
 */
export function buildWriteLicenseRequest(blob: Uint8Array): Uint8Array {
  const buf = alloc(3 + blob.length)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_WRITE_LICENSE)
  writeU16BE(buf, 1, blob.length)
  buf.set(blob, 3)
  return buf
}

/** Build a read-license request (FC 0x4A). Bare `[FC]` PDU — no payload. */
export function buildReadLicenseRequest(): Uint8Array {
  const buf = alloc(1)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_READ_LICENSE)
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

  if (isGetListOverflowException(fc, status)) {
    return { success: false, error: 'ERROR_OUT_OF_MEMORY' }
  }

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

  if (isBusyException(fc, status)) {
    return { success: false, error: DEBUG_BUSY_ERROR }
  }

  if (fc !== ModbusFunctionCode.DEBUG_SET) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  return { success: true }
}

/**
 * Parse a status response (FC 0x46).
 * Layout: `[FC][status][running:u8][tick:u32BE][uptime:u32BE][switch:u8]`
 * (12 PDU bytes; 11 on firmware predating the run/stop state machine).
 *
 * This is the ONE read path for run/stop state — `running` was always this
 * frame's first payload byte, so reporting the real state there rather than a
 * hardcoded 1 costs no extra round trip and needs no second function code. The
 * switch position is appended, which older parsers ignore and older firmware
 * simply omits.
 */
export function parseGetStatusResponse(data: Uint8Array): DebugStatusResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_GET_STATUS) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  if (data.length < 11) {
    return { success: false, error: `Incomplete status response (${data.length} bytes, expected 11)` }
  }

  const running = readU8(data, 2)
  return {
    success: true,
    running: running !== 0,
    // Same byte as `running`, as the tri-state the run/stop machine actually
    // has (STOPPED / RUNNING / ERROR).
    plcState: running,
    tick: readU32BE(data, 3),
    uptimeMs: readU32BE(data, 7),
    // Appended by firmware carrying the run/stop state machine; absent on older
    // firmware, which callers read as "no switch gating".
    ...(data.length >= 12 ? { switchPosition: readU8(data, 11) } : {}),
  }
}

/**
 * Parse a version response (FC 0x47).
 * Layout: `[FC][status][version ASCII...]` (no NUL terminator on the wire).
 */
export function parseGetVersionResponse(data: Uint8Array): DebugVersionResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_GET_VERSION) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  const version = new TextDecoder('utf-8').decode(data.subarray(2)).replace(/\0+$/, '').trim()
  return { success: true, version }
}

/**
 * Parse the FC 0x48 identity frame: `[FC][status][id_len:u8][id_bytes...]`.
 *
 * The FRAME is medium-independent, the MEANING is not (DOPE-589): bare metal
 * answers the derived device_id, runtime-v4 answers its raw device-tree anchor.
 * So the byte-level parse lives here once and the two typed wrappers below give
 * the bytes the name they actually have. `id_len === 0` is a valid SUCCESS
 * reply: the board has no identity a licence can be bound to.
 */
function parseIdentityFrame(data: Uint8Array): { bytes: Uint8Array } | { error: string; unsupported?: boolean } {
  if (data.length < 2) {
    return { error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_GET_DEVICE_ID) {
    return { error: 'Function code mismatch' }
  }

  // LIC_UNSUPPORTED: the target says it has no identity to license against
  // (a runtime-v4 host with no device-tree serial). Kept distinguishable so the
  // flow lands on the terminal 'unsupported' outcome instead of a retryable
  // check-failed (review 2026-08-20, R2/E5).
  if (status === ModbusDebugResponse.LIC_UNSUPPORTED) {
    return { error: statusError(status), unsupported: true }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { error: statusError(status) }
  }

  if (data.length < 3) {
    return { error: `Incomplete identity response (${data.length} bytes, expected at least 3)` }
  }

  const idLen = readU8(data, 2)
  if (data.length < 3 + idLen) {
    return { error: `Incomplete identity data (expected ${idLen} bytes, got ${data.length - 3})` }
  }

  return { bytes: data.slice(3, 3 + idLen) }
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * BARE METAL. The bytes are the DERIVED device_id, produced inside the closed
 * license-core (`license_gate_device_id`), so nothing here hashes them again.
 * An empty id means this board cannot hold a licence.
 */
export function parseGetDeviceIdResponse(data: Uint8Array): DebugDeviceIdResult {
  const parsed = parseIdentityFrame(data)
  if ('error' in parsed) {
    return parsed.unsupported
      ? { success: false, unsupported: true, error: parsed.error }
      : { success: false, error: parsed.error }
  }
  return { success: true, deviceId: parsed.bytes, deviceIdHex: toHex(parsed.bytes) }
}

/**
 * RUNTIME-V4. The bytes are the RAW device-tree anchor; the editor still derives
 * the device_id from them (`deriveDeviceId`). The caller re-normalizes the
 * trailing bytes: see websocket-debug-transport.
 */
export function parseGetAnchorResponse(data: Uint8Array): DebugAnchorResult {
  const parsed = parseIdentityFrame(data)
  if ('error' in parsed) {
    return parsed.unsupported
      ? { success: false, unsupported: true, error: parsed.error }
      : { success: false, error: parsed.error }
  }
  return { success: true, anchor: parsed.bytes, anchorHex: toHex(parsed.bytes) }
}

/**
 * Parse a write-license response (FC 0x49).
 * Layout: `[FC][status]`. SUCCESS → `{ success: true, status }`. LIC_UNSUPPORTED
 * (the board has no backend) is a valid device state → `{ success: true,
 * unsupported: true }`, not a transport error. Any other non-SUCCESS status is a
 * device-side failure surfaced as `{ success: false, error }`.
 */
export function parseWriteLicenseResponse(data: Uint8Array): DebugLicenseWriteResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_WRITE_LICENSE) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status === ModbusDebugResponse.LIC_UNSUPPORTED) {
    return { success: true, status, unsupported: true }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, status, error: statusError(status) }
  }

  return { success: true, status }
}

/**
 * Parse a read-license response (FC 0x4A).
 * Layout (OK):    `[FC][status=SUCCESS][len:U16BE][blob...]`.
 * Layout (other): `[FC][status]` — no len, no blob.
 *
 * `len` is BIG-ENDIAN (readU16BE) — the wire convention — while the blob it
 * frames is little-endian content. LIC_EMPTY / LIC_CORRUPT / LIC_UNSUPPORTED are
 * valid device states (`success: true` with the corresponding flag), not
 * transport errors.
 */
export function parseReadLicenseResponse(data: Uint8Array): DebugLicenseReadResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }

  const fc = readU8(data, 0)
  const status = readU8(data, 1)

  if (fc !== ModbusFunctionCode.DEBUG_READ_LICENSE) {
    return { success: false, error: 'Function code mismatch' }
  }

  if (status === ModbusDebugResponse.LIC_EMPTY) {
    return { success: true, status, empty: true }
  }

  if (status === ModbusDebugResponse.LIC_CORRUPT) {
    return { success: true, status, corrupt: true }
  }

  if (status === ModbusDebugResponse.LIC_UNSUPPORTED) {
    return { success: true, status, unsupported: true }
  }

  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, status, error: statusError(status) }
  }

  if (data.length < 4) {
    return { success: false, status, error: `Incomplete license response (${data.length} bytes, expected at least 4)` }
  }

  const len = readU16BE(data, 2)
  if (data.length < 4 + len) {
    return {
      success: false,
      status,
      error: `Incomplete license blob (expected ${len} bytes, got ${data.length - 4})`,
    }
  }

  return { success: true, status, blob: data.slice(4, 4 + len) }
}

/**
 * Extract the function code from a Modbus PDU response.
 * Returns `undefined` if the buffer is empty.
 */
export function responseFunctionCode(data: Uint8Array): number | undefined {
  return data.length > 0 ? readU8(data, 0) : undefined
}

// ---------------------------------------------------------------------------
// FC 0x4b — run/stop command
//
// Command only. Reading the state is `buildGetStatusRequest` /
// `parseGetStatusResponse` (FC 0x46) above, which already reports it.
// ---------------------------------------------------------------------------

export function buildPlcSetStateRequest(state: PlcRuntimeState.RUNNING | PlcRuntimeState.STOPPED): Uint8Array {
  const pdu = alloc(2)
  writeU8(pdu, 0, ModbusFunctionCode.PLC_SET_STATE)
  writeU8(pdu, 1, state === PlcRuntimeState.RUNNING ? 1 : 0)
  return pdu
}

/**
 * Parse a run/stop command acknowledgement.
 *
 * Three outcomes the caller must tell apart:
 *   - success: the request was accepted; `state` is as of the last scan.
 *   - `refusedBySwitch`: a RUN was rejected because the hardware switch reads
 *     STOP. The editor turns this into the "flip the switch" warning, not an
 *     error.
 *   - `unsupported`: the target answered the Modbus exception form (FC | 0x80),
 *     i.e. firmware built before the run/stop state machine. The editor degrades
 *     to "rebuild and upload" so field devices never look broken.
 */
export function parsePlcSetStateResponse(data: Uint8Array): PlcControlResult {
  if (data.length < 1) {
    return { success: false, error: 'Response too short' }
  }

  const fc = readU8(data, 0)
  if (fc === (ModbusFunctionCode.PLC_SET_STATE as number) + 0x80) {
    return { success: false, unsupported: true, error: 'Firmware does not implement run/stop control' }
  }
  if (fc !== (ModbusFunctionCode.PLC_SET_STATE as number)) {
    return { success: false, error: 'Function code mismatch' }
  }
  if (data.length < 4) {
    return { success: false, error: 'Response too short' }
  }

  const status = readU8(data, 1)
  const result: PlcControlResult = {
    success: status === (ModbusDebugResponse.SUCCESS as number),
    state: readU8(data, 2),
    switchPosition: readU8(data, 3),
  }
  if (status === (ModbusDebugResponse.REFUSED_BY_SWITCH as number)) {
    result.refusedBySwitch = true
    result.error = 'Refused: the hardware mode switch is in STOP'
  } else if (!result.success) {
    result.error = statusError(status)
  }
  return result
}

// ---------------------------------------------------------------------------
// FC 0x4e — per-task statistics (RTOS mode)
//
//   request:  [FC=0x4e] [flags: U8] [firstTask: U8]
//             (flags bit 0: start a new window once the last task has been read)
//   response: [FC=0x4e] [status] [version=2: U8]
//             [taskTotal: U8] [firstTask: U8] [taskCount: U8]
//             then per task [nameLen: U8] [name...] [12 x U32BE]
//             [serviceCount: U8] then per service [3 x U32BE]
//             [dispatcherStack, heapFree, heapMinFree, baseTickUs,
//              retainLateMaxUs: 5 x U32BE]
//
// A reply holds as many tasks as fit one frame (three or four); the reader asks
// again from firstTask + taskCount until it has taskTotal.
// ---------------------------------------------------------------------------

const MODBUS_EXCEPTION_ILLEGAL_FUNCTION = 0x01
const TASK_STATS_VERSION = 2
const TASK_STATS_TASK_U32S = 12
const TASK_STATS_TAIL_U32S = 5
/** The most tasks a board has (OPENPLC_RTOS_MAX_WORKERS), so the most pages. */
const TASK_STATS_MAX_PAGES = 32

export function buildGetTaskStatsRequest(firstTask = 0, resetWindow = false): Uint8Array {
  const buf = alloc(3)
  writeU8(buf, 0, ModbusFunctionCode.DEBUG_GET_TASK_STATS)
  writeU8(buf, 1, resetWindow ? 1 : 0)
  writeU8(buf, 2, firstTask)
  return buf
}

/**
 * The length a task-statistics reply PDU will have, from as much of it as has
 * arrived, or null until that can be told. For a transport that has to frame
 * the reply itself (serial), since the length follows only from the task names.
 */
export function taskStatsPduLength(pdu: Uint8Array): number | null {
  if (pdu.length < 2) return null
  if (readU8(pdu, 0) & 0x80 || readU8(pdu, 1) !== (ModbusDebugResponse.SUCCESS as number)) return 2
  if (pdu.length < 6) return null
  let length = 6
  for (let task = 0; task < readU8(pdu, 5); task++) {
    if (pdu.length <= length) return null
    length += 1 + readU8(pdu, length) + TASK_STATS_TASK_U32S * 4
  }
  if (pdu.length <= length) return null
  return length + 1 + readU8(pdu, length) * 12 + TASK_STATS_TAIL_U32S * 4
}

/** One reply: a page of the tasks, and everything else the board reports. */
export interface TaskStatsPage {
  taskTotal: number
  firstTask: number
  stats: RtosStats
}

export type TaskStatsPageResult =
  | { success: true; page: TaskStatsPage }
  | { success: false; unsupported?: boolean; error: string }

export function parseGetTaskStatsPage(data: Uint8Array): TaskStatsPageResult {
  if (data.length < 2) {
    return { success: false, error: `Invalid response: too short (${data.length} bytes)` }
  }
  const fc = readU8(data, 0)
  if (fc === (ModbusFunctionCode.DEBUG_GET_TASK_STATS as number) + 0x80) {
    const exception = readU8(data, 1)
    return exception === MODBUS_EXCEPTION_ILLEGAL_FUNCTION
      ? { success: false, unsupported: true, error: 'The board is not running in RTOS mode' }
      : { success: false, error: `Exception 0x${exception.toString(16)}` }
  }
  if (fc !== ModbusFunctionCode.DEBUG_GET_TASK_STATS) {
    return { success: false, error: 'Function code mismatch' }
  }
  const status = readU8(data, 1)
  if (status !== ModbusDebugResponse.SUCCESS) {
    return { success: false, error: statusError(status) }
  }

  const truncated = { success: false as const, error: 'Incomplete task statistics' }
  let offset = 2
  if (data.length < offset + 4) return truncated
  const version = readU8(data, offset)
  if (version !== TASK_STATS_VERSION) {
    return {
      success: false,
      error: `Task statistics version ${version} is not supported: upload the project again to update the firmware`,
    }
  }
  const taskTotal = readU8(data, offset + 1)
  const firstTask = readU8(data, offset + 2)
  const taskCount = readU8(data, offset + 3)
  offset += 4

  const u32s = (count: number): number[] | undefined => {
    if (data.length < offset + count * 4) return undefined
    const values = Array.from({ length: count }, (_, i) => readU32BE(data, offset + i * 4))
    offset += count * 4
    return values
  }

  const tasks: RtosTaskStats[] = []
  for (let i = 0; i < taskCount; i++) {
    if (data.length < offset + 1) return truncated
    const nameLength = readU8(data, offset)
    if (data.length < offset + 1 + nameLength) return truncated
    const name = new TextDecoder('utf-8').decode(data.subarray(offset + 1, offset + 1 + nameLength))
    offset += 1 + nameLength
    const values = u32s(TASK_STATS_TASK_U32S)
    if (!values) return truncated
    const [
      releases,
      overruns,
      scanMinUs,
      scanAvgUs,
      scanMaxUs,
      latencyAvgUs,
      latencyMaxUs,
      cycleMinUs,
      cycleMaxUs,
      stackFreeBytes,
      busyUs,
      periodUs,
    ] = values
    tasks.push({
      name,
      releases,
      overruns,
      scanMinUs,
      scanAvgUs,
      scanMaxUs,
      latencyAvgUs,
      latencyMaxUs,
      cycleMinUs,
      cycleMaxUs,
      stackFreeBytes,
      busyUs,
      periodUs,
    })
  }

  if (data.length < offset + 1) return truncated
  const serviceCount = readU8(data, offset)
  offset += 1
  const services: RtosServiceStats[] = []
  for (let i = 0; i < serviceCount; i++) {
    const values = u32s(3)
    if (!values) return truncated
    services.push({ iterationMaxUs: values[0], busyReplies: values[1], stackFreeBytes: values[2] })
  }

  const tail = u32s(TASK_STATS_TAIL_U32S)
  if (!tail) return truncated
  return {
    success: true,
    page: {
      taskTotal,
      firstTask,
      stats: {
        tasks,
        services,
        dispatcherStackFreeBytes: tail[0],
        heapFreeBytes: tail[1],
        heapMinFreeBytes: tail[2],
        baseTickUs: tail[3],
        retainLateMaxUs: tail[4],
      },
    },
  }
}

/**
 * Every task's statistics, a page at a time. `fetchPage` sends one request (from
 * buildGetTaskStatsRequest) and returns the reply PDU. The window reset rides on
 * every request; the board applies it only once the last task has been read.
 * Services, memory and the rest come from the last page.
 */
export async function readTaskStats(
  fetchPage: (request: Uint8Array) => Promise<Uint8Array>,
  resetWindow = false,
): Promise<DebugTaskStatsResult> {
  const tasks: RtosTaskStats[] = []
  let last: TaskStatsPage | undefined
  for (let page = 0; page < TASK_STATS_MAX_PAGES; page++) {
    const result = parseGetTaskStatsPage(await fetchPage(buildGetTaskStatsRequest(tasks.length, resetWindow)))
    if (!result.success) return result
    if (result.page.firstTask !== tasks.length) {
      return { success: false, error: 'Task statistics out of order' }
    }
    tasks.push(...result.page.stats.tasks)
    last = result.page
    if (tasks.length >= result.page.taskTotal) break
    if (result.page.stats.tasks.length === 0) {
      return { success: false, error: 'A task name does not fit the reply frame' }
    }
  }
  if (!last || tasks.length < last.taskTotal) return { success: false, error: 'Incomplete task statistics' }
  return { success: true, stats: { ...last.stats, tasks } }
}
