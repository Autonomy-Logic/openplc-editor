import { PLCVariable } from '@root/types/PLC/open-plc'

import { parseDimensionRange } from './array-variable-utils'

const BASE_TYPE_TO_IEC: Record<string, string> = {
  bool: 'IEC_BOOL',
  sint: 'IEC_SINT',
  int: 'IEC_INT',
  dint: 'IEC_DINT',
  lint: 'IEC_LINT',
  usint: 'IEC_USINT',
  uint: 'IEC_UINT',
  udint: 'IEC_UDINT',
  ulint: 'IEC_ULINT',
  byte: 'IEC_BYTE',
  word: 'IEC_WORD',
  dword: 'IEC_DWORD',
  lword: 'IEC_LWORD',
  real: 'IEC_REAL',
  lreal: 'IEC_LREAL',
  string: 'IEC_STRING',
}

/**
 * Check if a PLCVariable has an array type definition.
 */
const isArrayVariable = (variable: PLCVariable): boolean => {
  return variable.type.definition === 'array'
}

/**
 * Get the total number of elements in an array variable (product of all dimension sizes).
 * Returns 0 if the variable is not an array or has invalid dimensions.
 */
const getArrayTotalElements = (variable: PLCVariable): number => {
  if (variable.type.definition !== 'array') return 0

  const dimensions = variable.type.data.dimensions
  return dimensions.reduce((total, dim) => {
    const range = parseDimensionRange(dim.dimension)
    if (!range) return 0
    return total * (range.upper - range.lower + 1)
  }, 1)
}

/**
 * Get the base type string (lowercase) of an array variable.
 * Returns an empty string if the variable is not an array.
 */
const getArrayBaseTypeValue = (variable: PLCVariable): string => {
  if (variable.type.definition !== 'array') return ''
  return variable.type.data.baseType.value
}

/**
 * Map a base type string to its IEC C type name.
 * Falls back to uppercasing the type value if not found.
 */
const mapBaseTypeToIEC = (baseType: string): string => {
  return BASE_TYPE_TO_IEC[baseType.toLowerCase()] || baseType.toUpperCase()
}

/**
 * Get the IEC C type for a variable — works for both scalars and arrays.
 * For arrays, returns the IEC type of the base element type.
 * For scalars, returns the IEC type of the variable's type.
 */
const getVariableIECType = (variable: PLCVariable): string => {
  if (variable.type.definition === 'array') {
    return mapBaseTypeToIEC(variable.type.data.baseType.value)
  }
  if (variable.type.definition === 'base-type') {
    return mapBaseTypeToIEC(variable.type.value)
  }
  return variable.type.value.toUpperCase()
}

/**
 * Get the start index of the first dimension of an array variable.
 * Returns 0 if the variable is not an array or has invalid dimensions.
 */
const getArrayStartIndex = (variable: PLCVariable): number => {
  if (variable.type.definition !== 'array') return 0
  const dimensions = variable.type.data.dimensions
  if (dimensions.length === 0) return 0
  const range = parseDimensionRange(dimensions[0].dimension)
  return range ? range.lower : 0
}

export {
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  mapBaseTypeToIEC,
}
