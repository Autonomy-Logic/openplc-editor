export interface VariableTypeInfo {
  byteSize: number
  signed: boolean
}

export const getVariableTypeInfo = (type: string): VariableTypeInfo | null => {
  const normalizedType = type.toLowerCase()

  switch (normalizedType) {
    case 'bool':
      return { byteSize: 1, signed: false }
    case 'sint':
      return { byteSize: 1, signed: true }
    case 'usint':
    case 'byte':
      return { byteSize: 1, signed: false }
    case 'int':
      return { byteSize: 2, signed: true }
    case 'uint':
    case 'word':
      return { byteSize: 2, signed: false }
    case 'dint':
      return { byteSize: 4, signed: true }
    case 'udint':
    case 'dword':
      return { byteSize: 4, signed: false }
    case 'lint':
      return { byteSize: 8, signed: true }
    case 'ulint':
    case 'lword':
      return { byteSize: 8, signed: false }
    case 'real':
      return { byteSize: 4, signed: true }
    case 'lreal':
      return { byteSize: 8, signed: true }
    default:
      return null
  }
}

export const parseIntegerValue = (value: string, typeInfo: VariableTypeInfo): bigint | null => {
  try {
    let parsedValue: bigint

    const trimmedValue = value.trim()
    if (trimmedValue.startsWith('0x') || trimmedValue.startsWith('0X')) {
      parsedValue = BigInt(trimmedValue)
    } else if (trimmedValue.startsWith('2#')) {
      parsedValue = BigInt('0b' + trimmedValue.substring(2))
    } else if (trimmedValue.startsWith('8#')) {
      parsedValue = BigInt('0o' + trimmedValue.substring(2))
    } else if (trimmedValue.startsWith('16#')) {
      parsedValue = BigInt('0x' + trimmedValue.substring(3))
    } else {
      parsedValue = BigInt(trimmedValue)
    }

    const maxValue = typeInfo.signed
      ? BigInt(2) ** BigInt(typeInfo.byteSize * 8 - 1) - BigInt(1)
      : BigInt(2) ** BigInt(typeInfo.byteSize * 8) - BigInt(1)
    const minValue = typeInfo.signed ? -(BigInt(2) ** BigInt(typeInfo.byteSize * 8 - 1)) : BigInt(0)

    if (parsedValue < minValue || parsedValue > maxValue) {
      return null
    }

    if (!typeInfo.signed && parsedValue < BigInt(0)) {
      return null
    }

    return parsedValue
  } catch {
    return null
  }
}

export const integerToBuffer = (value: bigint, byteSize: number, signed: boolean): Buffer => {
  const buffer = Buffer.alloc(byteSize)

  let workingValue = value
  if (signed && value < BigInt(0)) {
    const maxUnsigned = BigInt(2) ** BigInt(byteSize * 8)
    workingValue = maxUnsigned + value
  }

  for (let i = 0; i < byteSize; i++) {
    buffer.writeUInt8(Number(workingValue & BigInt(0xff)), i)
    workingValue = workingValue >> BigInt(8)
  }

  return buffer
}
