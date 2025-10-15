import type { PLCVariable } from '@root/types/PLC/open-plc'

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
  const totalNs = seconds * 1_000_000_000 + nanoseconds

  const NS_PER_DAY = 86_400_000_000_000
  const NS_PER_HOUR = 3_600_000_000_000
  const NS_PER_MINUTE = 60_000_000_000
  const NS_PER_SECOND = 1_000_000_000
  const NS_PER_MS = 1_000_000
  const NS_PER_US = 1_000

  const days = Math.floor(totalNs / NS_PER_DAY)
  const hours = Math.floor((totalNs % NS_PER_DAY) / NS_PER_HOUR)
  const minutes = Math.floor((totalNs % NS_PER_HOUR) / NS_PER_MINUTE)
  const secs = Math.floor((totalNs % NS_PER_MINUTE) / NS_PER_SECOND)
  const ms = Math.floor((totalNs % NS_PER_SECOND) / NS_PER_MS)
  const us = Math.floor((totalNs % NS_PER_MS) / NS_PER_US)
  const ns = totalNs % NS_PER_US

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
  } else if (components.length === 1) {
    return components[0]
  } else {
    return components.slice(0, 2).join('')
  }
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

      case 'time':
      case 'date':
      case 'tod': {
        const tv_sec = readInt32LE(data, offset)
        const tv_nsec = readInt32LE(data, offset + 4)
        return { value: formatTimeValue(tv_sec, tv_nsec), bytesRead: 8 }
      }

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
