import { PLCVariable } from '@root/types/PLC/open-plc'

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
 * Converts an array of PLC variables into a format string for Python's struct.pack/unpack
 * @param variables Array of PLC variables
 * @returns String in the format '=hfb126sib126sH' for use with struct.pack/unpack
 */

const encodeCharactersFromVariable = (variables: PLCVariable[]): string => {
  if (!variables || variables.length === 0) {
    return '='
  }

  const encodedChars = variables
    .map((variable) => {
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
