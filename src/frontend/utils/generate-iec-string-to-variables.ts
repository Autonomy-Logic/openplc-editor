import type { LibraryState } from '../../middleware/shared/ports/library-types'
import { baseTypeSchema } from '../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import { parseStringLength } from './iec-types-registry'
import type { TypeContext } from './PLC/variable-declarations'
import { parseVariableDeclarations } from './PLC/variable-declarations'

/**
 * Classes whose declarations cannot carry a physical location ("AT").
 * IEC 61131-3 only allows located declarations in VAR and VAR_GLOBAL
 * blocks — interface sections describe the call contract, not hardware.
 * STruC++ says the same thing when it sees one: "Variable 'I' in VAR_INPUT
 * cannot have a location ('AT %IX0.0'). Only VAR and VAR_GLOBAL declarations
 * may be located."
 *
 * Enforced by `validateVariableSet`, which both the variables table and the
 * code view call — the rule used to be stated here as well, and the two views
 * refused the same declaration with two different messages.
 */
export const DISALLOWED_LOCATION_CLASSES: ReadonlyArray<PLCVariable['class']> = [
  'input',
  'output',
  'inOut',
  'external',
  'temp',
]

/**
 * Type guard to check if a library object has a 'pous' property
 */
const hasLibraryPous = (lib: unknown): lib is { pous: Array<{ name: string; type: string }> } => {
  return typeof lib === 'object' && lib !== null && 'pous' in lib && Array.isArray((lib as { pous: unknown }).pous)
}

/**
 * Parse an array type string like "ARRAY[1..10] OF INT" or "ARRAY[1..10, 1..5] OF MyStruct"
 * Returns null if not an array type, otherwise returns the parsed array type definition.
 * Also consumed by the global-variable-list text parser.
 */
/**
 * A `STRING(...)` / `WSTRING[...]` declaration, whatever sits between the
 * delimiters. Matching the shape commits the writer to a length, so anything
 * `parseStringLength` will not accept from here — `STRING[]`, `STRING(abc)`,
 * `STRING(0)`, `STRING(999)`, the mismatched `STRING(23]` — is a mistake to
 * report rather than a type name to keep.
 */
const SIZED_STRING_SHAPE = /^(W?STRING)\s*[([]\s*([^)\]]*?)\s*[)\]]$/i

/**
 * The declaration's type name and the length it got wrong, or `null` when the
 * type is not sized-string-shaped or its length is one we can carry.
 */
const badStringLength = (typeStr: string): { typeName: string; got: string } | null => {
  const shape = SIZED_STRING_SHAPE.exec(typeStr)
  if (!shape) return null
  const { length, valid } = parseStringLength(typeStr)
  // `parseStringLength` reports `valid: true` with no length for an
  // unqualified name, so the undefined case must be caught explicitly.
  if (length !== undefined && valid) return null
  return { typeName: shape[1].toUpperCase(), got: shape[2] }
}

export const parseArrayType = (typeStr: string): PLCVariable['type'] | null => {
  // ARRAY[dimensions] OF baseType, where baseType is an identifier (optionally
  // namespaced) that may carry a declared string length —
  // `ARRAY [0..3] OF STRING(23)`.
  const arrayMatch = typeStr.match(/^ARRAY\s*\[([^\]]+)\]\s+OF\s+([A-Za-z_][\w.]*(?:\s*[([]\s*\d+\s*[)\]])?)\s*$/i)
  if (!arrayMatch) return null

  const dimensionsStr = arrayMatch[1]
  const baseTypeStr = arrayMatch[2].trim()

  // An element's length is held to the same rule as a scalar's. Without this
  // the element fails `baseTypeSchema` and is kept as a user data type named
  // `STRING(0)`, which is then persisted and emitted verbatim into generated
  // ST. Refusing the array here lets the caller report it as the syntax error
  // it is.
  if (badStringLength(baseTypeStr)) return null

  // Parse dimensions (can be comma-separated for multi-dimensional arrays)
  const dimensionParts = dimensionsStr.split(',').map((d) => d.trim())

  // A blank bound (`ARRAY[0..1,] OF INT`, `ARRAY[,] OF INT`,
  // `ARRAY[0..1,,0..2] OF INT`) is not an array — reject it rather than
  // recording an empty dimension.  An empty dimension survives every
  // downstream consumer silently: `getTypeAsText` re-emits the trailing comma
  // into the generated ST, `getArrayTotalElements` collapses to 0 elements, and
  // the array modal drops the blank entry on save, quietly turning a 2D array
  // into a 1D one.  The GUI already refuses a blank bound (`arrayValidation`);
  // this brings the text path in line.
  //
  // Only *blank* is rejected: bounds may legitimately be symbolic
  // (`ARRAY[1..MAX] OF INT`), so this is deliberately not a `a..b` range check.
  if (dimensionParts.some((dimensionRange) => dimensionRange === '')) return null

  const dimensions = dimensionParts.map((dimensionRange) => ({ dimension: dimensionRange }))

  // Determine the base type definition
  const baseCheck = baseTypeSchema.safeParse(baseTypeStr.toUpperCase())

  // Build the array type definition
  if (baseCheck.success) {
    // Base type is a valid IEC base type
    return {
      definition: 'array' as const,
      value: typeStr, // Keep the full type string as the value
      data: {
        baseType: { definition: 'base-type' as const, value: baseCheck.data },
        dimensions,
      },
    }
  } else {
    // Base type is a user-defined type (structure, FB, etc.)
    return {
      definition: 'array' as const,
      value: typeStr, // Keep the full type string as the value
      data: {
        baseType: { definition: 'user-data-type' as const, value: baseTypeStr },
        dimensions,
      },
    }
  }
}

/**
 * Build the scanner's type-resolution context from the project's own
 * vocabulary. Kept here rather than in the scanner so the scanner stays free
 * of project types and stays testable on a bare string.
 */
export const buildTypeContext = (
  pous?: PLCPou[],
  _dataTypes?: PLCDataType[], // Reserved: will enable user-defined data type validation
  libraries?: LibraryState['libraries'],
): TypeContext => ({
  resolveBaseType: (typeName) => {
    const check = baseTypeSchema.safeParse(typeName.toUpperCase())
    return check.success ? check.data : undefined
  },
  isFunctionBlockType: (typeName) => {
    const lowered = typeName.toLowerCase()

    const isUserFunctionBlock = pous?.some(
      (pou) => pou.pouType === 'function-block' && pou.name.toLowerCase() === lowered,
    )

    const isSystemFunctionBlock = libraries?.system.some((lib) => {
      if (!hasLibraryPous(lib)) return false
      return lib.pous.some((pou) => pou.type === 'function-block' && pou.name.toLowerCase() === lowered)
    })

    const isUserLibraryFunctionBlock = libraries?.user.some(
      (lib) => lib.type === 'function-block' && lib.name.toLowerCase() === lowered,
    )

    return Boolean(isUserFunctionBlock || isSystemFunctionBlock || isUserLibraryFunctionBlock)
  },
})

/**
 * Parse a `VAR … END_VAR` text into variables, throwing on the first problem.
 *
 * Thin wrapper over {@link scanVariableDeclarations} for the callers that want
 * the model and nothing else. Callers that need to preserve the user's text —
 * which is the source of truth — want the scanner directly, for its spans.
 *
 * Class-versus-location is deliberately NOT judged here any more. It is one of
 * the rules `validateVariableSet` owns, and stating it in two places is how the
 * table and the code view came to refuse the same declaration with two
 * different messages.
 */
export const parseIecStringToVariables = (
  iecString: string,
  pous?: PLCPou[],
  dataTypes?: PLCDataType[],
  libraries?: LibraryState['libraries'],
): PLCVariable[] => {
  const result = parseVariableDeclarations(iecString, buildTypeContext(pous, dataTypes, libraries))
  if (result.errors.length > 0) throw new Error(result.errors[0].message)
  return result.variables
}

export const findDuplicateVariableName = (variables: PLCVariable[]): string | undefined => {
  const seen = new Set<string>()
  for (const variable of variables) {
    const key = variable.name.toLowerCase()
    if (seen.has(key)) return variable.name
    seen.add(key)
  }
  return undefined
}

export const duplicateVariableNameMessage = (name: string): string =>
  `"${name}" is declared more than once. Please make sure that the name is unique.`
