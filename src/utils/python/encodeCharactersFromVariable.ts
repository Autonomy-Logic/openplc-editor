import { PLCVariable } from '@root/types/PLC/open-plc'
import { getArrayBaseTypeValue, getArrayTotalElements, isArrayVariable } from '@root/utils/PLC/array-codegen-helpers'

const TYPE_ENCODING_MAP: Record<string, string> = {
  bool: 'B',
  sint: 'b',
  int: 'h',
  dint: 'i',
  lint: 'q',
  usint: 'B',
  uint: 'H',
  udint: 'I',
  ulint: 'Q',
  real: 'f',
  lreal: 'd',
  byte: 'B',
  word: 'H',
  dword: 'I',
  lword: 'Q',
  string: 'b126s',
}

/**
 * Converts an array of PLC variables into a format string for Python's struct.pack/unpack.
 * For scalar variables, returns the corresponding format character.
 * For array variables, repeats the base type's format character N times (e.g., ARRAY[0..9] OF INT → '10h').
 * @param variables Array of PLC variables
 * @returns String in the format '=hfb126sib126sH' for use with struct.pack/unpack
 */

const encodeCharactersFromVariable = (variables: PLCVariable[]): string => {
  if (!variables || variables.length === 0) {
    return '='
  }

  const encodedChars = variables
    .map((variable) => {
      if (isArrayVariable(variable)) {
        const baseType = getArrayBaseTypeValue(variable).toLowerCase()
        const encodingChar = TYPE_ENCODING_MAP[baseType]
        if (!encodingChar) {
          console.warn(`Warning: Unknown base type "${baseType}" for array variable "${variable.name}". Skipping.`)
          return ''
        }
        const totalElements = getArrayTotalElements(variable)
        // For multi-char encodings (e.g., 'b126s' for STRING), the repeat count
        // only applies to the first char in Python struct format ('10b126s' ≠ 10×'b126s').
        // Repeat the full encoding string instead.
        if (encodingChar.length > 1) {
          return encodingChar.repeat(totalElements)
        }
        return `${totalElements}${encodingChar}`
      }

      const typeValue = variable.type.value.toLowerCase()
      const encodingChar = TYPE_ENCODING_MAP[typeValue]

      if (!encodingChar) {
        console.warn(`Warning: Unknown type "${typeValue}" for variable "${variable.name}". Skipping.`)
        return ''
      }

      return encodingChar
    })
    .filter((char) => char !== '')

  return '=' + encodedChars.join('')
}

export { encodeCharactersFromVariable, type PLCVariable }
