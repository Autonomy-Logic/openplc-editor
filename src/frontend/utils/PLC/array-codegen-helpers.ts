import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { parseStringLength } from '../iec-types-registry'
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
  wstring: 'IEC_WSTRING',

  // Duration and calendar types. Absent until DOPE-584's type sweep: a C++
  // block declaring `TIME` emitted `strucpp::TIME`, which names nothing, and the
  // build failed on generated code the user never wrote. The aliases these map
  // to are the ones strucpp declares (`IEC_TIME = IECVar<TIME_t>`, and so on).
  time: 'IEC_TIME',
  date: 'IEC_DATE',
  tod: 'IEC_TOD',
  dt: 'IEC_DT',

  // The long spellings IEC 61131-3 also allows for the same two types.
  time_of_day: 'IEC_TOD',
  date_and_time: 'IEC_DT',
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
/**
 * Spell a user-defined type the way strucpp declares it.
 *
 * The compiler emits two different shapes and there is no single rule that
 * covers both, so the caller has to say which names are data types:
 *
 *   - A data type gets an `IEC_`-prefixed alias — `struct MOTOR { … };
 *     using IEC_MOTOR = MOTOR;` for a structure, and
 *     `enum class MODE { … }; using IEC_MODE = IEC_ENUM<MODE>;` for an
 *     enumeration. The alias is the one to use: for an enumeration the bare
 *     name is the raw C++ `enum class`, while `IEC_MODE` is the force-aware
 *     wrapper, and a pin must be the wrapper like every other pin.
 *   - A function block instance is a plain `class HELPER;` with no alias, so
 *     the bare name is the only spelling that exists.
 *
 * Without `userTypeNames` the bare name is returned, which is the correct
 * answer for a function block and the historical behaviour for everything else.
 */
/**
 * The generic type names a native block may declare on a VAR_INPUT, and the one
 * runtime type they all resolve to.
 *
 * All seven share a representation — the `IEC_ANY` descriptor
 * `{ typeclass, pvalue, diSize }`. The family constrains what the caller may
 * pass, which the compiler checks at the call site, not what the block receives.
 */
const GENERIC_TYPE_TO_IEC: Record<string, string> = {
  // Not a generic: the descriptor a generic carries, declarable in its own
  // right so a block can keep what it was handed. Same runtime type.
  '__SYSTEM.ANYTYPE': 'IEC_ANY',

  ANY: 'IEC_ANY',
  ANY_BIT: 'IEC_ANY',
  ANY_DATE: 'IEC_ANY',
  ANY_NUM: 'IEC_ANY',
  ANY_REAL: 'IEC_ANY',
  ANY_INT: 'IEC_ANY',
  ANY_STRING: 'IEC_ANY',
}

/**
 * Whether a pin's declared type is a generic (or the descriptor it carries),
 * and so resolves to the runtime's `IEC_ANY` rather than to a project type.
 */
const isDescriptorPinType = (typeName: string): boolean =>
  GENERIC_TYPE_TO_IEC[typeName.toUpperCase()] !== undefined

const mapUserTypeToIEC = (typeName: string, userTypeNames?: ReadonlySet<string>): string => {
  const upper = typeName.toUpperCase()
  const generic = GENERIC_TYPE_TO_IEC[upper]
  if (generic) return generic
  return userTypeNames?.has(upper) ? `IEC_${upper}` : upper
}

/**
 * strucpp wrapper for a length-qualified string, or `null` for anything else.
 *
 * `IEC_STRING` / `IEC_WSTRING` are fixed aliases for the 254-character
 * wrappers, so a declared length names the template directly. Must match what
 * STruC++ emits for the same declaration (`IECStringVar<23>`): `<POU>_VARS`
 * points at the member the function block declares, so a mismatch is an ABI
 * bug, not a compile error.
 */
const sizedStringIECType = (baseType: string): string | null => {
  const { base, length, valid } = parseStringLength(baseType)
  if (length === undefined || !valid) return null
  return base === 'WSTRING' ? `IECWStringVar<${length}>` : `IECStringVar<${length}>`
}

const mapBaseTypeToIEC = (baseType: string, userTypeNames?: ReadonlySet<string>): string => {
  const sized = sizedStringIECType(baseType)
  if (sized) return sized
  const elementary = BASE_TYPE_TO_IEC[baseType.toLowerCase()]
  if (elementary) return elementary
  // Not elementary: an array of a user-defined type, or a type the map does not
  // know. Both go through the same spelling rule as a scalar of that type.
  return mapUserTypeToIEC(baseType, userTypeNames)
}

/**
 * Get the IEC C type for a variable — works for both scalars and arrays.
 * For arrays, returns the IEC type of the base element type.
 * For scalars, returns the IEC type of the variable's type.
 */
const getVariableIECType = (variable: PLCVariable, userTypeNames?: ReadonlySet<string>): string => {
  if (variable.type.definition === 'array' && variable.type.data) {
    return mapBaseTypeToIEC(variable.type.data.baseType.value, userTypeNames)
  }
  if (variable.type.definition === 'base-type') {
    return mapBaseTypeToIEC(variable.type.value, userTypeNames)
  }
  return mapUserTypeToIEC(variable.type.value, userTypeNames)
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
 * strucpp container type for an array of rank two or three, or `null` for
 * anything else.
 *
 * A one-dimensional array is passed as a pointer to its first element, offset by
 * the lower bound, so the block writes `arr[i]` with the declared IEC indices
 * and the element type is all the struct has to name. That trick does not extend
 * past rank one: `IEC_ARRAY_2D` deliberately has no `operator[]` — a row
 * subscript would have to return a view — and takes every index in one
 * `operator()` call instead. So a multi-dimensional array is passed as a pointer
 * to the container itself, and the block indexes it as `grid(i, j)`, which is
 * the same accessor the compiler's own generated code uses.
 *
 * `Array2D` / `Array3D` are strucpp's documented public aliases, and the bounds
 * handed to them come from the user's own declaration rather than from any
 * assumption about how the container is laid out.
 *
 * Rank four and beyond returns `null`: strucpp declares no alias for it, so
 * there is no type to name and no array to describe.
 */
const multiDimensionalContainerType = (variable: PLCVariable, userTypeNames?: ReadonlySet<string>): string | null => {
  if (variable.type.definition !== 'array' || !variable.type.data) return null

  const dimensions = variable.type.data.dimensions
  if (dimensions.length < 2 || dimensions.length > 3) return null

  const bounds: number[] = []
  for (const dimension of dimensions) {
    const range = parseDimensionRange(dimension.dimension)
    if (!range) return null
    bounds.push(range.lower, range.upper)
  }

  const elementType = mapBaseTypeToIEC(variable.type.data.baseType.value, userTypeNames)
  return `Array${dimensions.length}D<strucpp::${elementType}, ${bounds.join(', ')}>`
}

/** The bound a variable-length array dimension carries. */
const VARIABLE_LENGTH_BOUND = '*'

/**
 * strucpp view type for a variable-length array, or `null` for anything else.
 *
 * A VLA pin (`ARRAY [*] OF INT`) has no bounds until it is called, so it cannot
 * be a pointer to its first element: nothing would carry the element count or
 * the lower bound. strucpp passes `ArrayView<n>D<T>` — data pointer plus runtime
 * bounds — reached through `lower_bound()` / `upper_bound()` / `at()`, so the
 * struct holds a pointer to the view itself.
 *
 * Rank one and two only: the runtime declares `ArrayView1D` and `ArrayView2D`
 * and nothing beyond. A mixed shape like `ARRAY [*, 0..3]` is not legal and
 * falls to the fixed-array path.
 */
const variableLengthViewType = (variable: PLCVariable, userTypeNames?: ReadonlySet<string>): string | null => {
  if (variable.type.definition !== 'array' || !variable.type.data) return null

  const dimensions = variable.type.data.dimensions
  if (dimensions.length < 1 || dimensions.length > 2) return null
  if (!dimensions.every((dimension) => dimension.dimension.trim() === VARIABLE_LENGTH_BOUND)) return null

  const elementType = mapBaseTypeToIEC(variable.type.data.baseType.value, userTypeNames)
  return `ArrayView${dimensions.length}D<strucpp::${elementType}>`
}

/**
 * Whether a variable is a variable-length array, and so is passed as a view
 * rather than as a pointer to its first element.
 */
const isVariableLengthArray = (variable: PLCVariable): boolean => variableLengthViewType(variable) !== null

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
const generateStructMember = (variable: PLCVariable, userTypeNames?: ReadonlySet<string>): string => {
  const name = variable.name.toUpperCase()
  const variableLength = variableLengthViewType(variable, userTypeNames)
  if (variableLength) return `  strucpp::${variableLength} *${name};\n`

  const multiDimensional = multiDimensionalContainerType(variable, userTypeNames)
  if (multiDimensional) return `  strucpp::${multiDimensional} *${name};\n`

  const iecType = getVariableIECType(variable, userTypeNames)
  return `  strucpp::${iecType} *${name};\n`
}

export {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  isDescriptorPinType,
  isVariableLengthArray,
  mapBaseTypeToIEC,
  mapUserTypeToIEC,
  multiDimensionalContainerType,
}
