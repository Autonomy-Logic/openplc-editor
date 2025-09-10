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
 * Converte um array de variáveis PLC em uma string de formato para struct.pack/unpack do Python
 * @param variables Array de variáveis PLC
 * @returns String no formato '=hfb126sib126sH' para uso em struct.pack/unpack
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
