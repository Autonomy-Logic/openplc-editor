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
    case 'string':
      return { byteSize: 127, signed: false }
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

export const integerToBuffer = (value: bigint, byteSize: number, signed: boolean): Uint8Array => {
  const buffer = new Uint8Array(byteSize)

  let workingValue = value
  if (signed && value < BigInt(0)) {
    const maxUnsigned = BigInt(2) ** BigInt(byteSize * 8)
    workingValue = maxUnsigned + value
  }

  for (let i = byteSize - 1; i >= 0; i--) {
    buffer[i] = Number(workingValue & BigInt(0xff))
    workingValue = workingValue >> BigInt(8)
  }

  return buffer
}

export const parseFloatValue = (value: string, byteSize: number): number | null => {
  try {
    const trimmedValue = value.trim()
    const parsedValue = parseFloat(trimmedValue)

    if (isNaN(parsedValue) || !isFinite(parsedValue)) {
      return null
    }

    if (byteSize === 4) {
      const maxFloat32 = 3.4028235e38
      const minFloat32 = -3.4028235e38
      if (parsedValue > maxFloat32 || parsedValue < minFloat32) {
        return null
      }
    }

    return parsedValue
  } catch {
    return null
  }
}

export const floatToBuffer = (value: number, byteSize: number): Uint8Array => {
  const buffer = new Uint8Array(byteSize)
  const dataView = new DataView(buffer.buffer)

  if (byteSize === 4) {
    dataView.setFloat32(0, value, false)
  } else if (byteSize === 8) {
    dataView.setFloat64(0, value, false)
  }

  return buffer
}

export const parseStringValue = (value: string): string | null => {
  try {
    if (value.length > 126) {
      return null
    }

    for (let i = 0; i < value.length; i++) {
      const charCode = value.charCodeAt(i)
      if (charCode > 127) {
        return null
      }
    }

    return value
  } catch {
    return null
  }
}

export const stringToBuffer = (value: string): Uint8Array => {
  const buffer = new Uint8Array(1 + value.length)

  buffer[0] = value.length

  for (let i = 0; i < value.length; i++) {
    buffer[i + 1] = value.charCodeAt(i)
  }

  return buffer
}
