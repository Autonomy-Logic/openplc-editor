import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { parseDimensionRange } from './dimension-range'

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
  if (variable.type.definition !== 'array' || !variable.type.data) return 0

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
  if (variable.type.definition !== 'array' || !variable.type.data) return ''
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
  if (variable.type.definition === 'array' && variable.type.data) {
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
  if (variable.type.definition !== 'array' || !variable.type.data) return 0
  const dimensions = variable.type.data.dimensions
  if (dimensions.length === 0) return 0
  const range = parseDimensionRange(dimensions[0].dimension)
  return range ? range.lower : 0
}

/**
 * Generate a C struct member declaration for a variable.
 * Both scalars and arrays use pointers:
 * - Scalars: pointer to the single value
 * - Arrays: pointer to the first element of the table
 *
 * Every base type — including STRING / WSTRING — resolves to the
 * strucpp IECVar / IECStringVar wrapper (e.g. `strucpp::IEC_INT =
 * IECVar<INT_t>`, `strucpp::IEC_STRING = IECStringVar<254>`).  The
 * single, uniform qualification keeps the c_blocks.h ↔ strucpp
 * runtime ABI byte-identical for every elementary type — no parallel
 * raw POD shape, no copy-in/copy-out stub at scan boundaries.
 *
 * User-syntax consequence for STRING / WSTRING: the historical
 * `name.len` / `name.body[i]` pattern is replaced by `name.length()`
 * / `name[i]` (read-only — returns by value) / `name.c_str()` /
 * `name = "literal";` — exposed by `IECStringVar`.  Byte-level
 * mutation goes through `auto raw = name.get(); raw[i] = '…';
 * name.set(raw);`.  See `generateCBlocksCode.ts` for the file-scope
 * numeric raw typedefs that still cover the user's local-variable
 * declarations inside `setup()` / `loop()`.
 */
const generateStructMember = (variable: PLCVariable): string => {
  const iecType = getVariableIECType(variable)
  const name = variable.name.toUpperCase()
  return `  strucpp::${iecType} *${name};\n`
}

export {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  mapBaseTypeToIEC,
}
