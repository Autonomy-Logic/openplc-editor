import type { PLCVariable } from '@root/types/PLC/open-plc'

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
      case 'time':
      case 'date':
      case 'tod':
        return 4

      case 'lint':
      case 'ulint':
      case 'lword':
      case 'lreal':
      case 'dt':
        return 8

      case 'string':
        return 81

      default:
        console.warn(`Unknown base type: ${baseType}, defaulting to 4 bytes`)
        return 4
    }
  }

  console.warn(`Non-base type variable: ${variable.name}, defaulting to 4 bytes`)
  return 4
}

export function parseVariableValue(
  buffer: Buffer,
  offset: number,
  variable: PLCVariable,
): { value: string; bytesRead: number } {
  if (variable.type.definition === 'base-type') {
    const baseType = variable.type.value.toLowerCase()

    switch (baseType) {
      case 'bool':
        return { value: buffer.readUInt8(offset) !== 0 ? 'TRUE' : 'FALSE', bytesRead: 1 }

      case 'sint':
        return { value: buffer.readInt8(offset).toString(), bytesRead: 1 }

      case 'usint':
      case 'byte':
        return { value: buffer.readUInt8(offset).toString(), bytesRead: 1 }

      case 'int':
        return { value: buffer.readInt16LE(offset).toString(), bytesRead: 2 }

      case 'uint':
      case 'word':
        return { value: buffer.readUInt16LE(offset).toString(), bytesRead: 2 }

      case 'dint':
      case 'time':
        return { value: buffer.readInt32LE(offset).toString(), bytesRead: 4 }

      case 'udint':
      case 'dword':
      case 'date':
      case 'tod':
        return { value: buffer.readUInt32LE(offset).toString(), bytesRead: 4 }

      case 'real':
        return { value: buffer.readFloatLE(offset).toFixed(6), bytesRead: 4 }

      case 'lint':
        return { value: buffer.readBigInt64LE(offset).toString(), bytesRead: 8 }

      case 'ulint':
      case 'lword':
      case 'dt':
        return { value: buffer.readBigUInt64LE(offset).toString(), bytesRead: 8 }

      case 'lreal':
        return { value: buffer.readDoubleLE(offset).toFixed(12), bytesRead: 8 }

      case 'string': {
        const stringData = buffer.slice(offset, offset + 81)
        const nullIndex = stringData.indexOf(0)
        const str = stringData.slice(0, nullIndex !== -1 ? nullIndex : 80).toString('utf-8')
        return { value: `"${str}"`, bytesRead: 81 }
      }

      default:
        return { value: '???', bytesRead: 4 }
    }
  }

  return { value: '???', bytesRead: 4 }
}
