import type { PLCVariable } from '../../middleware/shared/ports/types'
import { type IECTypeMetadata, type IECWireFormat, lookupBaseType } from './iec-types-registry'

/**
 * STRING / WSTRING wire size cap, in characters. Strucpp's
 * IECStringVar / IECWStringVar default to 254 chars in declarations
 * but the debug protocol pre-dates that change and still frames
 * length-prefixed payloads at 1 length byte + 126 code units. Pull
 * this into a constant so the parser/encoder/sizer all share the cap
 * — bump it in one place when the protocol catches up.
 */
const DEBUG_STRING_CAP = 126

function readInt8(data: Uint8Array, offset: number): number {
  const value = data[offset]
  return value > 127 ? value - 256 : value
}

function readUInt8(data: Uint8Array, offset: number): number {
  return data[offset]
}

function readInt16LE(data: Uint8Array, offset: number): number {
  const value = data[offset] | (data[offset + 1] << 8)
  return value > 32767 ? value - 65536 : value
}

function readUInt16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8)
}

function readInt32LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
}

function readUInt32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readFloatLE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4)
  return view.getFloat32(0, true)
}

function readDoubleLE(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8)
  return view.getFloat64(0, true)
}

function readBigInt64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8)
  return view.getBigInt64(0, true)
}

function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8)
  return view.getBigUint64(0, true)
}

/**
 * Pad an integer to a fixed-width zero-padded string. Tiny helper to
 * keep the date/time formatters readable.
 */
function pad(n: number, width = 2): string {
  return Math.trunc(Math.abs(n)).toString().padStart(width, '0')
}

/**
 * Format a strucpp DT (int64 nanoseconds since the Unix epoch) as an
 * IEC 61131-3 DATE_AND_TIME literal: `DT#YYYY-MM-DD-HH:MM:SS.mmm`.
 *
 * UTC is intentional here. The runtime stores DT in absolute time
 * (`std::chrono::system_clock::time_since_epoch()`); rendering in the
 * user's local timezone would silently shift the displayed value by
 * whatever offset the host is in, masking off-by-an-hour bugs in user
 * code. The ".mmm" tail keeps sub-second precision for FBs that read
 * CURRENT_DT() multiple times within a scan.
 */
function formatDtValue(totalNs: bigint): string {
  const NS_PER_MS = 1_000_000n
  const ms = Number(totalNs / NS_PER_MS)
  const subMs = Number((totalNs >= 0n ? totalNs : -totalNs) % NS_PER_MS)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'ERR'
  const subMsTail = subMs > 0 ? `.${pad(Math.trunc(subMs / 1000), 6)}` : ''
  return (
    `DT#${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}${subMsTail}`
  )
}

/**
 * Format a strucpp DATE (int64 nanoseconds since the Unix epoch, but
 * semantically date-only) as `D#YYYY-MM-DD`.
 */
function formatDateValue(totalNs: bigint): string {
  const ms = Number(totalNs / 1_000_000n)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'ERR'
  return `D#${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Format a strucpp TOD / TIME_OF_DAY (int64 nanoseconds since
 * midnight) as `TOD#HH:MM:SS.mmm`. Wraps around at 24h, since TOD has
 * no calendar component.
 */
function formatTodValue(totalNs: bigint): string {
  const NS_PER_DAY = 86_400_000_000_000n
  let ns = totalNs % NS_PER_DAY
  if (ns < 0n) ns += NS_PER_DAY
  const NS_PER_HOUR = 3_600_000_000_000n
  const NS_PER_MIN = 60_000_000_000n
  const NS_PER_SEC = 1_000_000_000n
  const NS_PER_MS = 1_000_000n
  const h = Number(ns / NS_PER_HOUR)
  ns = ns % NS_PER_HOUR
  const m = Number(ns / NS_PER_MIN)
  ns = ns % NS_PER_MIN
  const s = Number(ns / NS_PER_SEC)
  const subSecMs = Number((ns % NS_PER_SEC) / NS_PER_MS)
  return `TOD#${pad(h)}:${pad(m)}:${pad(s)}.${pad(subSecMs, 3)}`
}

function formatTimeValue(totalNs: bigint): string {
  const isNegative = totalNs < 0n
  const absTotalNs = isNegative ? -totalNs : totalNs

  const NS_PER_DAY = 86_400_000_000_000n
  const NS_PER_HOUR = 3_600_000_000_000n
  const NS_PER_MINUTE = 60_000_000_000n
  const NS_PER_SECOND = 1_000_000_000n
  const NS_PER_MS = 1_000_000n
  const NS_PER_US = 1_000n

  const days = Number(absTotalNs / NS_PER_DAY)
  const hours = Number((absTotalNs % NS_PER_DAY) / NS_PER_HOUR)
  const minutes = Number((absTotalNs % NS_PER_HOUR) / NS_PER_MINUTE)
  const secs = Number((absTotalNs % NS_PER_MINUTE) / NS_PER_SECOND)
  const ms = Number((absTotalNs % NS_PER_SECOND) / NS_PER_MS)
  const us = Number((absTotalNs % NS_PER_MS) / NS_PER_US)
  const ns = Number(absTotalNs % NS_PER_US)

  const components: string[] = []
  if (days > 0) components.push(`${days}d`)
  if (hours > 0) components.push(`${hours}h`)
  if (minutes > 0) components.push(`${minutes}m`)
  if (secs > 0) components.push(`${secs}s`)
  if (ms > 0) components.push(`${ms}ms`)
  if (us > 0) components.push(`${us}us`)
  if (ns > 0) components.push(`${ns}ns`)

  if (components.length === 0) {
    return '0s'
  }

  const formatted = components.length === 1 ? components[0] : components.slice(0, 2).join('')
  return isNegative ? `-${formatted}` : formatted
}

/**
 * Wire byte width for a base-type metadata entry. Variable-width
 * strings get the debug-protocol cap (`1 + N` for STRING, `1 + 2*N`
 * for WSTRING); everything else uses the fixed `byteSize`.
 */
function wireSizeFor(meta: IECTypeMetadata): number {
  switch (meta.wireFormat) {
    case 'len8-utf8':
      return 1 + DEBUG_STRING_CAP
    case 'len8-utf16le':
      return 1 + DEBUG_STRING_CAP * 2
    default:
      return meta.byteSize
  }
}

export function getVariableSize(variable: PLCVariable): number {
  if (variable.type.definition !== 'base-type') {
    console.warn(`Non-base type variable: ${variable.name}, defaulting to 4 bytes`)
    return 4
  }
  return getTypeSizeByName(variable.type.value)
}

/**
 * Get the byte size for a type name string (used when we only have
 * the type name, not a full PLCVariable).
 */
export function getTypeSizeByName(typeName: string): number {
  const meta = lookupBaseType(typeName)
  if (!meta) {
    console.warn(`Unknown base type: ${typeName}, defaulting to 4 bytes`)
    return 4
  }
  return wireSizeFor(meta)
}

/**
 * Read a `wireFormat`-shaped byte payload at `offset` and produce
 * the formatted display string + the number of bytes consumed.
 *
 * One arm per `IECWireFormat` value — every new format added on the
 * strucpp side must land here too.
 */
function decodeWireValue(
  data: Uint8Array,
  offset: number,
  meta: IECTypeMetadata,
): { value: string; bytesRead: number } {
  switch (meta.wireFormat) {
    case 'bool':
      return { value: readUInt8(data, offset) !== 0 ? 'TRUE' : 'FALSE', bytesRead: 1 }
    case 'int8':
      return { value: readInt8(data, offset).toString(), bytesRead: 1 }
    case 'uint8':
      return { value: readUInt8(data, offset).toString(), bytesRead: 1 }
    case 'int16':
      return { value: readInt16LE(data, offset).toString(), bytesRead: 2 }
    case 'uint16':
      return { value: readUInt16LE(data, offset).toString(), bytesRead: 2 }
    case 'int32':
      return { value: readInt32LE(data, offset).toString(), bytesRead: 4 }
    case 'uint32':
      return { value: readUInt32LE(data, offset).toString(), bytesRead: 4 }
    case 'int64':
      return { value: readBigInt64LE(data, offset).toString(), bytesRead: 8 }
    case 'uint64':
      return { value: readBigUInt64LE(data, offset).toString(), bytesRead: 8 }
    case 'float32':
      return { value: readFloatLE(data, offset).toFixed(6), bytesRead: 4 }
    case 'float64':
      return { value: readDoubleLE(data, offset).toFixed(12), bytesRead: 8 }
    case 'duration-ns-i64':
      return { value: formatTimeValue(readBigInt64LE(data, offset)), bytesRead: 8 }
    case 'datetime-ns-i64':
      return { value: formatDtValue(readBigInt64LE(data, offset)), bytesRead: 8 }
    case 'date-ns-i64':
      return { value: formatDateValue(readBigInt64LE(data, offset)), bytesRead: 8 }
    case 'tod-ns-i64':
      return { value: formatTodValue(readBigInt64LE(data, offset)), bytesRead: 8 }
    case 'len8-utf8': {
      const length = readUInt8(data, offset)
      const stringData = data.slice(offset + 1, offset + 1 + Math.min(length, DEBUG_STRING_CAP))
      const str = new TextDecoder('utf-8').decode(stringData)
      return { value: `"${str}"`, bytesRead: 1 + DEBUG_STRING_CAP }
    }
    case 'len8-utf16le': {
      // WSTRING uses 16-bit chars; the leading byte is a UTF-16
      // code-unit count, followed by the units in little-endian order.
      const length = readUInt8(data, offset)
      const units = Math.min(length, DEBUG_STRING_CAP)
      const buf = new Uint16Array(units)
      for (let i = 0; i < units; i++) {
        buf[i] = readUInt16LE(data, offset + 1 + i * 2)
      }
      const str = String.fromCharCode(...buf)
      return { value: `"${str}"`, bytesRead: 1 + DEBUG_STRING_CAP * 2 }
    }
  }
}

export function parseVariableValue(
  data: Uint8Array,
  offset: number,
  variable: PLCVariable,
): { value: string; bytesRead: number } {
  if (variable.type.definition !== 'base-type') {
    return { value: '???', bytesRead: 4 }
  }
  const meta = lookupBaseType(variable.type.value)
  if (!meta) {
    return { value: '???', bytesRead: 4 }
  }
  return decodeWireValue(data, offset, meta)
}

/**
 * Parse a variable value from binary data using just the type name
 * string. Useful when we don't have a full PLCVariable object.
 */
export function parseValueByTypeName(
  data: Uint8Array,
  offset: number,
  typeName: string,
): { value: string; bytesRead: number } {
  const meta = lookupBaseType(typeName)
  if (!meta) {
    return { value: '???', bytesRead: 4 }
  }
  return decodeWireValue(data, offset, meta)
}

/**
 * Encode a user-entered force value into the wire-format byte buffer
 * the runtime expects. Throws an Error with a human-readable message
 * when the input doesn't parse — callers should surface that to the
 * user.
 *
 * For enum-typed leaves, pass `enumValues`. The function matches the
 * input against member names (case-insensitive) first, falls back to
 * integer parsing so power users can still type a number, and emits
 * the underlying INT bytes either way.
 */
export function encodeForceValue(input: string, typeName: string, enumValues?: string[]): Uint8Array {
  const trimmed = input.trim()

  // Enum: name → index, with numeric fallback.
  let numericInput = trimmed
  if (enumValues && enumValues.length > 0) {
    const idx = enumValues.findIndex((name) => name.toLowerCase() === trimmed.toLowerCase())
    if (idx >= 0) {
      numericInput = String(idx)
    } else if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`Unknown enum member: "${trimmed}". Expected one of: ${enumValues.join(', ')}`)
    }
  }

  const meta = lookupBaseType(typeName)
  if (!meta) {
    throw new Error(`Unknown base type: "${typeName}"`)
  }

  return encodeByWireFormat(trimmed, numericInput, meta)
}

/**
 * Encode dispatcher keyed on `wireFormat`. TIME / DATE / TOD / DT /
 * STRING / WSTRING force is not yet supported — those need IEC literal
 * parsing (`T#…`, `D#…`) and string framing, which the debugger UI
 * doesn't currently expose.
 */
function encodeByWireFormat(originalInput: string, numericInput: string, meta: IECTypeMetadata): Uint8Array {
  switch (meta.wireFormat) {
    case 'bool': {
      const v = originalInput.toLowerCase()
      const bool = v === 'true' || v === '1' ? 1 : v === 'false' || v === '0' ? 0 : -1
      if (bool < 0) throw new Error(`Invalid BOOL value: "${originalInput}"`)
      return new Uint8Array([bool])
    }
    case 'int8':
    case 'uint8': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      return new Uint8Array([n & 0xff])
    }
    case 'int16':
    case 'uint16': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      return new Uint8Array([n & 0xff, (n >> 8) & 0xff])
    }
    case 'int32':
    case 'uint32': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff])
    }
    case 'int64':
    case 'uint64': {
      let bi: bigint
      try {
        bi = BigInt(numericInput)
      } catch {
        throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      }
      const buf = new Uint8Array(8)
      new DataView(buf.buffer).setBigInt64(0, bi, true)
      return buf
    }
    case 'float32': {
      const n = Number(numericInput)
      if (!Number.isFinite(n)) throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      const buf = new Uint8Array(4)
      new DataView(buf.buffer).setFloat32(0, n, true)
      return buf
    }
    case 'float64': {
      const n = Number(numericInput)
      if (!Number.isFinite(n)) throw new Error(`Invalid ${meta.name} value: "${originalInput}"`)
      const buf = new Uint8Array(8)
      new DataView(buf.buffer).setFloat64(0, n, true)
      return buf
    }
    case 'duration-ns-i64':
    case 'datetime-ns-i64':
    case 'date-ns-i64':
    case 'tod-ns-i64':
    case 'len8-utf8':
    case 'len8-utf16le':
      throw new Error(`Forcing ${meta.name} values is not supported yet`)
    default: {
      // Exhaustiveness gate — a new IECWireFormat that forgets a case
      // here surfaces as a TS error here, not as a silent no-op.
      const _exhaustive: never = meta.wireFormat
      throw new Error(`Unhandled wire format for ${meta.name}: ${String(_exhaustive)}`)
    }
  }
}

// Internal helper exported for the IEC wire-format type:
export type { IECWireFormat }
