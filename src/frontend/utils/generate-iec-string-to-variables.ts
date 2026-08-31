import type { LibraryState } from '../../middleware/shared/ports/library-types'
import { baseTypeSchema } from '../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import { MAX_STRING_LENGTH, parseStringLength } from './iec-types-registry'

const varBlockToClass: Record<string, PLCVariable['class']> = {
  VAR: 'local',
  VAR_INPUT: 'input',
  VAR_OUTPUT: 'output',
  VAR_IN_OUT: 'inOut',
  VAR_EXTERNAL: 'external',
  VAR_TEMP: 'temp',
  VAR_GLOBAL: 'global',
}

/**
 * Classes whose declarations cannot carry a physical location ("AT").
 * IEC 61131-3 only allows located declarations in VAR and VAR_GLOBAL
 * blocks — interface sections describe the call contract, not hardware.
 * Shared with the store-level variable validation so edit time and load
 * time enforce the same rule (GitHub issue #904).
 */
export const DISALLOWED_LOCATION_CLASSES: ReadonlyArray<PLCVariable['class']> = [
  'input',
  'output',
  'inOut',
  'external',
  'temp',
]

// The type group accepts a comma so a multi-dimensional array can be declared
// inline: `m : ARRAY[0..1, 0..2] OF INT;`.  `parseArrayType` below has always
// split multi-dimensional bounds, and the data-type text parser
// (`PLC/data-type-text-parser.ts`) already allows the comma — without it here,
// the only way to declare a 2D/3D array was to name an ARRAY data type first,
// and writing it inline failed the whole POU with "invalid or unsupported
// characters".
//
// The group stays lazy and is bounded by the following `AT` / `:=` / `;`.  Note
// this does NOT enable multi-name declarations (`a, b : INT;`) — `name` is a
// single `\w+` followed by `:`.
//
// Widening the character class is not by itself a guarantee of well-formedness:
// the regex will happily match a comma inside a NON-array type, so
// `parseIecStringToVariables` rejects any type that still contains a comma after
// `parseArrayType` has declined it, and `parseArrayType` declines blank bounds.
// Both guards are below; between them, a comma reaches the store only as part of
// a well-formed multi-dimensional ARRAY.
//
// It also accepts `*`, the bound of a variable-length array
// (`values : ARRAY [*] OF INT;`), and `(` / `)` for a declared string length
// (`name : STRING(23);`). The parentheses cannot swallow a `(*` comment: the
// group is lazy and must be followed by `;`, and anything before that
// semicolon is rejected by `baseTypeSchema` and `identifierRegex`.

// Primary format: name : type AT location := initialValue ; (* documentation *)
const lineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s*:\s*(?<type>[\w\s\[\]\(\),\.\*]+?)(?:\s+AT\s+(?<location>[\w\d\._%]+))?\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

// Alternate format: name AT location : type := initialValue ; (* documentation *)
// This format is used by some IEC 61131-3 tools and older versions of OpenPLC Editor
const alternateLineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s+AT\s+(?<location>[\w\d\._%]+)\s*:\s*(?<type>[\w\s\[\]\(\),\.\*]+?)\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  // Comma is legal — multi-dimensional array bounds and comma-separated initial
  // values both use it — so it must not be reported as an unsupported character.
  // eslint-disable-next-line no-useless-escape
  if (/[^A-Za-z0-9_\s:;=%()/*\-.,\[\]]/.test(line)) return 'invalid or unsupported characters'
  return 'unrecognized declaration format'
}

/**
 * Type guard to check if a library object has a 'pous' property
 */
const hasLibraryPous = (lib: unknown): lib is { pous: Array<{ name: string; type: string }> } => {
  return typeof lib === 'object' && lib !== null && 'pous' in lib && Array.isArray((lib as { pous: unknown }).pous)
}

/**
 * Parse an array type string like "ARRAY[1..10] OF INT" or "ARRAY[1..10, 1..5] OF MyStruct"
 * Returns null if not an array type, otherwise returns the parsed array type definition.
 * Also consumed by the data-type text parser (`PLC/data-type-text-parser.ts`).
 */
export const parseArrayType = (typeStr: string): PLCVariable['type'] | null => {
  // ARRAY[dimensions] OF baseType, where baseType is an identifier (optionally
  // namespaced) that may carry a declared string length —
  // `ARRAY [0..3] OF STRING(23)`.
  const arrayMatch = typeStr.match(
    /^ARRAY\s*\[([^\]]+)\]\s+OF\s+([A-Za-z_][\w.]*(?:\s*[([]\s*\d+\s*[)\]])?)\s*$/i,
  )
  if (!arrayMatch) return null

  const dimensionsStr = arrayMatch[1]
  const baseTypeStr = arrayMatch[2].trim()

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

export const parseIecStringToVariables = (
  iecString: string,
  pous?: PLCPou[],
  _dataTypes?: PLCDataType[], // Reserved for future use: will enable user-defined data type validation
  libraries?: LibraryState['libraries'],
): PLCVariable[] => {
  const variables: PLCVariable[] = []
  const lines = iecString.split(/\r?\n/)
  let currentClass: PLCVariable['class'] | null = null

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1
    const line = rawLine.trim()
    if (line === '') return

    const blockStart = line.match(/^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i)
    if (blockStart) {
      currentClass = varBlockToClass[blockStart[1].toUpperCase()]
      return
    }

    if (/^END_VAR\b/i.test(line)) {
      currentClass = null
      return
    }

    if (!currentClass) return

    // Try primary format first, then fall back to alternate format
    let match = line.match(lineRegex)
    if (!match?.groups) {
      match = line.match(alternateLineRegex)
    }
    if (!match?.groups) {
      throw new Error(`Syntax error on line ${lineNumber}: "${line}". Possible cause: ${guessErrorReason(line)}.`)
    }

    const { name, location, type, initialValue, documentation } = match.groups

    if (location && DISALLOWED_LOCATION_CLASSES.includes(currentClass)) {
      throw new Error(
        `Syntax error on line ${lineNumber}: "${line}". Location ("AT") is not allowed for variables of class "${currentClass.toUpperCase()}". Move "${name}" to a VAR block (class LOCAL) or remove the "AT ${location}" clause.`,
      )
    }

    if (initialValue && currentClass === 'external') {
      throw new Error(
        `Syntax error on line ${lineNumber}: Initial Value (":=") is not allowed for variables of class "EXTERNAL".`,
      )
    }

    const parsedType = type.trim()

    // Check if it's an array type first
    const arrayType = parseArrayType(parsedType)
    if (arrayType) {
      variables.push({
        name: name.trim(),
        class: currentClass,
        type: arrayType,
        location: location ? location.trim() : '',
        initialValue: initialValue ? initialValue.trim() : null,
        documentation: documentation ? documentation.trim() : '',
        debug: false,
      })
      return
    }

    // The type group admits a comma only so that inline multi-dimensional
    // ARRAY bounds parse.  Anything else that reached here with a comma is
    // malformed — `x : INT, DINT;`, `x : INT,;`, or an ARRAY with a blank bound
    // — and must be rejected instead of becoming a user data type named
    // "INT, DINT", which is persisted, shown in the type cell, and emitted
    // verbatim into the generated ST.  Mirrors the guard `buildFieldType` in
    // `PLC/data-type-text-parser.ts` applies to structure fields.
    if (parsedType.includes(',')) {
      throw new Error(
        `Syntax error on line ${lineNumber}: "${line}". A comma is only allowed between inline ARRAY bounds (e.g. "ARRAY[0..1, 0..2] OF INT"), and no bound may be empty.`,
      )
    }

    // A length-qualified string — `STRING(23)`, `WSTRING(8)`. STruC++ emits
    // `IECStringVar<23>` at 54 bytes where a plain STRING is 518. Square
    // brackets are accepted and normalised to the parenthesised form.
    //
    // Only a malformed or out-of-range length is refused, and refused here
    // rather than left to fall through: an unrecognised type is stored as a
    // user data type named "STRING(0)" and emitted verbatim into generated ST.
    //
    // The array element form is handled by `parseArrayType` above.
    const stringWithLength = /^(W?STRING)\s*[([]\s*([^)\]]*?)\s*[)\]]$/i.exec(parsedType)
    if (stringWithLength) {
      // Matching the shape commits to a length, so `STRING[]`, `STRING(abc)`,
      // `STRING(0)` and `STRING(999)` are all reported here. `parseStringLength`
      // returns `valid: true` with no length for an unqualified name, so the
      // undefined case must be caught explicitly.
      const { length, valid } = parseStringLength(parsedType)
      if (length === undefined || !valid) {
        throw new Error(
          `Syntax error on line ${lineNumber}: "${line}". ` +
            `${stringWithLength[1].toUpperCase()} takes a length from 1 to ${MAX_STRING_LENGTH}, ` +
            `got "${stringWithLength[2]}".`,
        )
      }
    }

    const baseCheck = baseTypeSchema.safeParse(parsedType.toUpperCase())

    const isUserFunctionBlock = pous?.some(
      (pou) => pou.pouType === 'function-block' && pou.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isSystemFunctionBlock = libraries?.system.some((lib) => {
      if (!hasLibraryPous(lib)) return false
      return lib.pous.some(
        (pou) => pou.type === 'function-block' && pou.name.toLowerCase() === parsedType.toLowerCase(),
      )
    })

    const isUserLibraryFunctionBlock = libraries?.user.some(
      (lib) => lib.type === 'function-block' && lib.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isFunctionBlock = isUserFunctionBlock || isSystemFunctionBlock || isUserLibraryFunctionBlock

    const typeDefinition: PLCVariable['type'] = baseCheck.success
      ? { definition: 'base-type' as const, value: baseCheck.data }
      : isFunctionBlock
        ? { definition: 'derived' as const, value: parsedType }
        : { definition: 'user-data-type' as const, value: parsedType }

    variables.push({
      name: name.trim(),
      class: currentClass,
      type: typeDefinition,
      location: location ? location.trim() : '',
      initialValue: initialValue ? initialValue.trim() : null,
      documentation: documentation ? documentation.trim() : '',
      debug: false,
    })
  })

  return variables
}
