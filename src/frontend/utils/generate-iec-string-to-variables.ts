import type { LibraryState } from '../../middleware/shared/ports/library-types'
import { baseTypeSchema } from '../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCPou, PLCVariable } from '../../middleware/shared/ports/types'

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

// Primary format: name : type AT location := initialValue ; (* documentation *)
const lineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s*:\s*(?<type>[\w\s\[\]\.]+?)(?:\s+AT\s+(?<location>[\w\d\._%]+))?\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

// Alternate format: name AT location : type := initialValue ; (* documentation *)
// This format is used by some IEC 61131-3 tools and older versions of OpenPLC Editor
const alternateLineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s+AT\s+(?<location>[\w\d\._%]+)\s*:\s*(?<type>[\w\s\[\]\.]+?)\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  // eslint-disable-next-line no-useless-escape
  if (/[^A-Za-z0-9_\s:;=%()/*\-.\[\]]/.test(line)) return 'invalid or unsupported characters'
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
 */
const parseArrayType = (typeStr: string): PLCVariable['type'] | null => {
  // Match ARRAY[dimensions] OF baseType, where baseType is an identifier (optionally namespaced)
  const arrayMatch = typeStr.match(/^ARRAY\s*\[([^\]]+)\]\s+OF\s+([A-Za-z_][\w.]*)\s*$/i)
  if (!arrayMatch) return null

  const dimensionsStr = arrayMatch[1]
  const baseTypeStr = arrayMatch[2].trim()

  // Parse dimensions (can be comma-separated for multi-dimensional arrays)
  const dimensionParts = dimensionsStr.split(',').map((d) => d.trim())
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
