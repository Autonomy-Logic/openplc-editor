import type { LibraryState } from '../../middleware/shared/ports/library-types'
import { baseTypeSchema } from '../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'
import { DEBUG_STRING_CAP } from './variable-sizes'

/**
 * Block header with its optional IEC qualifiers, e.g. `VAR RETAIN PERSISTENT`.
 *
 * The qualifiers are captured as one run and split afterwards rather than
 * enumerated in the pattern, so an unknown or repeated one produces a message
 * naming it instead of the header silently failing to match — which is how a
 * mistyped qualifier used to turn every declaration under it into a syntax
 * error on the following line.
 */
const blockStartRegex =
  /^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)(?<qualifiers>(?:\s+[A-Za-z_]\w*)*)\s*$/i

/**
 * Reduce a block header's qualifier run to the single flag the model carries.
 *
 * `NON_RETAIN` is IEC's name for the default, so it maps to no flag at all —
 * accepted and then forgotten, which is exactly what it means. `PERSISTENT`
 * folds into `retain`: CODESYS also keeps it across a download and this
 * toolchain does not, so the honest mapping is the weaker guarantee both
 * share (STruC++ treats the keyword the same way).
 *
 * Returns an `Error` rather than throwing so the caller can attach the line
 * number and the offending text.
 */
function parseBlockFlag(qualifiers: string): PLCVariable['flag'] | Error {
  let flag: PLCVariable['flag'] | undefined
  let sawNonRetain = false

  for (const word of qualifiers.trim().split(/\s+/).filter(Boolean)) {
    switch (word.toUpperCase()) {
      case 'CONSTANT':
        if (flag === 'retain') return new Error('A variable cannot be both RETAIN and CONSTANT.')
        flag = 'constant'
        break
      case 'RETAIN':
      case 'PERSISTENT':
        if (flag === 'constant') return new Error('A variable cannot be both RETAIN and CONSTANT.')
        flag = 'retain'
        break
      case 'NON_RETAIN':
        sawNonRetain = true
        break
      default:
        return new Error(
          `Unknown variable block qualifier "${word}". Expected CONSTANT, RETAIN, NON_RETAIN or PERSISTENT.`,
        )
    }
  }

  if (sawNonRetain && flag !== undefined) {
    return new Error(`A variable cannot be both ${flag.toUpperCase()} and NON_RETAIN.`)
  }
  return flag
}

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

// Primary format: name : type AT location := initialValue ; (* documentation *)
const lineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s*:\s*(?<type>[\w\s\[\],\.]+?)(?:\s+AT\s+(?<location>[\w\d\._%]+))?\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

// Alternate format: name AT location : type := initialValue ; (* documentation *)
// This format is used by some IEC 61131-3 tools and older versions of OpenPLC Editor
const alternateLineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s+AT\s+(?<location>[\w\d\._%]+)\s*:\s*(?<type>[\w\s\[\],\.]+?)\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

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
  // Match ARRAY[dimensions] OF baseType, where baseType is an identifier (optionally namespaced)
  const arrayMatch = typeStr.match(/^ARRAY\s*\[([^\]]+)\]\s+OF\s+([A-Za-z_][\w.]*)\s*$/i)
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
  // The block qualifier in force. IEC puts it on the block header, so every
  // declaration under it inherits the same value until END_VAR.
  let currentFlag: PLCVariable['flag'] | undefined

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1
    const line = rawLine.trim()
    if (line === '') return

    const blockStart = line.match(blockStartRegex)
    if (blockStart) {
      currentClass = varBlockToClass[blockStart[1].toUpperCase()]
      const parsedFlag = parseBlockFlag(blockStart.groups?.qualifiers ?? '')
      if (parsedFlag instanceof Error) {
        throw new Error(`Syntax error on line ${lineNumber}: "${line}". ${parsedFlag.message}`)
      }
      currentFlag = parsedFlag
      return
    }

    if (/^END_VAR\b/i.test(line)) {
      currentClass = null
      currentFlag = undefined
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
        ...(currentFlag !== undefined ? { flag: currentFlag } : {}),
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

    // A length-qualified string (`STRING[20]`, `WSTRING[8]`) is legal IEC and
    // legal CODESYS, and STruC++ does not accept it. Left alone it is not even
    // recognised as a string: it becomes a user data type literally named
    // "STRING[20]", which is persisted, shown in the type cell, and emitted
    // verbatim into the generated ST — where the compiler fails with
    // `Expected Semicolon, found [` pointing at a line the user never wrote.
    //
    // Refusing here says what is true today. The transport carries a fixed
    // DEBUG_STRING_CAP-character budget, so a declared length would not be honoured even if
    // it parsed; when the compiler grows the declaration, this guard is the one
    // place that has to change.
    // Both shapes it can take: on its own (`msg : STRING[20]`) and as an ARRAY's
    // element type (`tags : ARRAY [0..3] OF STRING[20]`). The array form needs
    // its own alternative because `parseArrayType` only accepts a bare
    // identifier after `OF`, so a length-qualified element matches nothing and
    // used to fall through every branch to the compiler — which then reported
    // `Expected Semicolon, found [` at a column the user never wrote, plus two
    // cascading errors on the FOLLOWING line, so even the line number misled.
    const lengthQualifiedString =
      /^(W?STRING)\s*\[\s*[^\]]*\]$/i.exec(parsedType) ??
      /^ARRAY\s*\[[^\]]*\]\s+OF\s+(W?STRING)\s*\[\s*[^\]]*\]\s*$/i.exec(parsedType)
    if (lengthQualifiedString) {
      const keyword = lengthQualifiedString[1].toUpperCase()
      throw new Error(
        `Syntax error on line ${lineNumber}: "${line}". A declared length is not supported on ${keyword} — ` +
          `use plain ${keyword}, which carries up to ${DEBUG_STRING_CAP} characters.`,
      )
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
      ...(currentFlag !== undefined ? { flag: currentFlag } : {}),
    })
  })

  return variables
}
