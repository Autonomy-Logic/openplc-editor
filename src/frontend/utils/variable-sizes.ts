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

      case 'date':
      case 'tod':
        // DATE/TOD are also int64 ns in STruC++ but represent absolute
        // timestamps (epoch / midnight reference) rather than durations.
        // Their formatters need different epoch handling — deferred.
        return { value: '<TIME>', bytesRead: 8 }

      case 'udint':
      case 'dword':
        return { value: readUInt32LE(data, offset).toString(), bytesRead: 4 }

      case 'real':
        return { value: readFloatLE(data, offset).toFixed(6), bytesRead: 4 }

      case 'lint':
        return { value: readBigInt64LE(data, offset).toString(), bytesRead: 8 }

      case 'ulint':
      case 'lword':
      case 'dt':
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
