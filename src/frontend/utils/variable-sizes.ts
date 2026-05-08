import type { PLCVariable } from '../../middleware/shared/ports/types'

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

function formatTimeValue(seconds: number, nanoseconds: number): string {
  let sec = seconds
  let nsec = nanoseconds

  if (nsec >= 1_000_000_000 || nsec <= -1_000_000_000) {
    sec += Math.trunc(nsec / 1_000_000_000)
    nsec = nsec % 1_000_000_000
  }
  if (sec > 0 && nsec < 0) {
    sec -= 1
    nsec += 1_000_000_000
  } else if (sec < 0 && nsec > 0) {
    sec += 1
    nsec -= 1_000_000_000
  }

  const isNegative = sec < 0 || (sec === 0 && nsec < 0)
  const totalNsBigInt = BigInt(sec) * 1_000_000_000n + BigInt(nsec)
  const absTotalNs = isNegative ? -totalNsBigInt : totalNsBigInt

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

export function getVariableSize(variable: PLCVariable): number {
  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toLowerCase()

    switch (baseType) {
      case 'bool':
      case 'sint':
      case 'usint':
      case 'byte':
        return 1

      case 'int':
      case 'uint':
      case 'word':
        return 2

      case 'dint':
      case 'udint':
      case 'dword':
      case 'real':
        return 4

      case 'time':
      case 'date':
      case 'tod':
        return 8

      case 'lint':
      case 'ulint':
      case 'lword':
      case 'lreal':
      case 'dt':
        return 8

      case 'string':
        return 127

      case 'wstring':
        // 1 length byte + 126 UTF-16 code units of 2 bytes each.
        return 1 + 126 * 2

      default:
        console.warn(`Unknown base type: ${baseType}, defaulting to 4 bytes`)
        return 4
    }
  }

  console.warn(`Non-base type variable: ${variable.name}, defaulting to 4 bytes`)
  return 4
}

/**
 * Get the byte size for a type name string (used when we only have the type name,
 * not a full PLCVariable).
 */
export function getTypeSizeByName(typeName: string): number {
  switch (typeName.toUpperCase()) {
    case 'BOOL':
    case 'SINT':
    case 'USINT':
    case 'BYTE':
      return 1

    case 'INT':
    case 'UINT':
    case 'WORD':
      return 2

    case 'DINT':
    case 'UDINT':
    case 'DWORD':
    case 'REAL':
      return 4

    case 'TIME':
    case 'DATE':
    case 'TOD':
    case 'LINT':
    case 'ULINT':
    case 'LWORD':
    case 'LREAL':
    case 'DT':
      return 8

    case 'STRING':
      return 127

    case 'WSTRING':
      // 1 length byte + 126 UTF-16 code units of 2 bytes each.
      return 1 + 126 * 2

    default:
      return 4
  }
}

export function parseVariableValue(
  data: Uint8Array,
  offset: number,
  variable: PLCVariable,
): { value: string; bytesRead: number } {
  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toLowerCase()

    switch (baseType) {
      case 'bool':
        return { value: readUInt8(data, offset) !== 0 ? 'TRUE' : 'FALSE', bytesRead: 1 }

      case 'sint':
        return { value: readInt8(data, offset).toString(), bytesRead: 1 }

      case 'usint':
      case 'byte':
        return { value: readUInt8(data, offset).toString(), bytesRead: 1 }

      case 'int':
        return { value: readInt16LE(data, offset).toString(), bytesRead: 2 }

      case 'uint':
      case 'word':
        return { value: readUInt16LE(data, offset).toString(), bytesRead: 2 }

      case 'dint':
        return { value: readInt32LE(data, offset).toString(), bytesRead: 4 }

      case 'time': {
        // STruC++ stores TIME as a single int64_t nanoseconds duration
        // (iec_types.hpp: `using TIME_t = int64_t`). Read 8 bytes as a
        // BigInt and split into (seconds, nanoseconds) for formatTimeValue,
        // which already handles duration formatting.
        const totalNs = readBigInt64LE(data, offset)
        const NS_PER_SEC = 1_000_000_000n
        const sec = totalNs / NS_PER_SEC
        const ns = totalNs % NS_PER_SEC
        return { value: formatTimeValue(Number(sec), Number(ns)), bytesRead: 8 }
      }

      case 'dt':
        // DT is int64 nanoseconds since Unix epoch — same wire shape
        // as TIME, different semantics. Format to the IEC literal the
        // user expects to see in the watch panel.
        return { value: formatDtValue(readBigInt64LE(data, offset)), bytesRead: 8 }

      case 'date':
        return { value: formatDateValue(readBigInt64LE(data, offset)), bytesRead: 8 }

      case 'tod':
        // TOD is int64 nanoseconds since midnight (no calendar
        // component). Wrap-around handled inside formatTodValue.
        return { value: formatTodValue(readBigInt64LE(data, offset)), bytesRead: 8 }

      case 'udint':
      case 'dword':
        return { value: readUInt32LE(data, offset).toString(), bytesRead: 4 }

      case 'real':
        return { value: readFloatLE(data, offset).toFixed(6), bytesRead: 4 }

      case 'lint':
        return { value: readBigInt64LE(data, offset).toString(), bytesRead: 8 }

      case 'ulint':
      case 'lword':
        return { value: readBigUInt64LE(data, offset).toString(), bytesRead: 8 }

      case 'lreal':
        return { value: readDoubleLE(data, offset).toFixed(12), bytesRead: 8 }

      case 'string': {
        const length = readUInt8(data, offset)
        const stringData = data.slice(offset + 1, offset + 1 + Math.min(length, 126))
        const decoder = new TextDecoder('utf-8')
        const str = decoder.decode(stringData)
        return { value: `"${str}"`, bytesRead: 127 }
      }

      case 'wstring': {
        // WSTRING uses 16-bit chars; the leading byte is still a UTF-16
        // code-unit count, followed by the units in little-endian order.
        // Cap at 126 units so the wire payload matches strucpp's
        // IECStringVar layout for wide strings.
        const length = readUInt8(data, offset)
        const units = Math.min(length, 126)
        const buf = new Uint16Array(units)
        for (let i = 0; i < units; i++) {
          buf[i] = readUInt16LE(data, offset + 1 + i * 2)
        }
        const str = String.fromCharCode(...buf)
        return { value: `"${str}"`, bytesRead: 1 + 126 * 2 }
      }

      default:
        return { value: '???', bytesRead: 4 }
    }
  }

  return { value: '???', bytesRead: 4 }
}

/**
 * Parse a variable value from binary data using just the type name string.
 * Useful when we don't have a full PLCVariable object.
 */
export function parseValueByTypeName(
  data: Uint8Array,
  offset: number,
  typeName: string,
): { value: string; bytesRead: number } {
  const fakeVariable = {
    name: '',
    class: 'local' as const,
    type: { definition: 'base-type' as const, value: typeName.toLowerCase() },
    location: '',
    documentation: '',
    debug: false,
  }
  return parseVariableValue(data, offset, fakeVariable)
}

/**
 * Encode a user-entered force value into the wire-format byte buffer the
 * runtime expects. Throws an Error with a human-readable message when the
 * input doesn't parse — callers should surface that to the user.
 *
 * For enum-typed leaves, pass `enumValues`. The function matches the input
 * against member names (case-insensitive) first, falls back to integer
 * parsing so power users can still type a number, and emits the underlying
 * INT bytes either way.
 */
export function encodeForceValue(
  input: string,
  typeName: string,
  enumValues?: string[],
): Uint8Array {
  const trimmed = input.trim()

  // Enum: name → index, with numeric fallback.
  let numericInput = trimmed
  if (enumValues && enumValues.length > 0) {
    const idx = enumValues.findIndex((name) => name.toLowerCase() === trimmed.toLowerCase())
    if (idx >= 0) {
      numericInput = String(idx)
    } else if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(
        `Unknown enum member: "${trimmed}". Expected one of: ${enumValues.join(', ')}`,
      )
    }
  }

  const t = typeName.toUpperCase()
  switch (t) {
    case 'BOOL': {
      const v = trimmed.toLowerCase()
      const bool = v === 'true' || v === '1' ? 1 : v === 'false' || v === '0' ? 0 : -1
      if (bool < 0) throw new Error(`Invalid BOOL value: "${trimmed}"`)
      return new Uint8Array([bool])
    }
    case 'SINT':
    case 'USINT':
    case 'BYTE': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${t} value: "${trimmed}"`)
      return new Uint8Array([n & 0xff])
    }
    case 'INT':
    case 'UINT':
    case 'WORD': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${t} value: "${trimmed}"`)
      return new Uint8Array([n & 0xff, (n >> 8) & 0xff])
    }
    case 'DINT':
    case 'UDINT':
    case 'DWORD': {
      const n = Number(numericInput)
      if (!Number.isInteger(n)) throw new Error(`Invalid ${t} value: "${trimmed}"`)
      return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff])
    }
    case 'REAL': {
      const n = Number(numericInput)
      if (!Number.isFinite(n)) throw new Error(`Invalid REAL value: "${trimmed}"`)
      const buf = new Uint8Array(4)
      new DataView(buf.buffer).setFloat32(0, n, true)
      return buf
    }
    case 'LREAL': {
      const n = Number(numericInput)
      if (!Number.isFinite(n)) throw new Error(`Invalid LREAL value: "${trimmed}"`)
      const buf = new Uint8Array(8)
      new DataView(buf.buffer).setFloat64(0, n, true)
      return buf
    }
    case 'LINT':
    case 'ULINT':
    case 'LWORD': {
      let bi: bigint
      try {
        bi = BigInt(numericInput)
      } catch {
        throw new Error(`Invalid ${t} value: "${trimmed}"`)
      }
      const buf = new Uint8Array(8)
      new DataView(buf.buffer).setBigInt64(0, bi, true)
      return buf
    }
    default:
      // TIME / DATE / TOD / DT / STRING force is not yet supported via this
      // helper — those need IEC literal parsing (T#…, D#…) and string framing.
      throw new Error(`Forcing ${t} values is not supported yet`)
  }
}
