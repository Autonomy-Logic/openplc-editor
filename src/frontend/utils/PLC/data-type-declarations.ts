/**
 * Read a `.dt` data type, using STruC++ as the parser.
 *
 * Same argument as the variable declarations next door (DOPE-650): STruC++ is
 * the compiler, so parsing with it is the only way the editor's idea of a data
 * type cannot drift from the one that has to compile.
 *
 * The regexes this replaces were anchored on `;$`, which meant a documentation
 * comment broke three of the four forms. `E : (A, B); // note` came back as
 * "unrecognized declaration format" and `END_STRUCT; (* x *)` as "missing
 * END_STRUCT; to close the structure" — pointing at a line where `END_STRUCT;`
 * was plainly present.
 *
 * As with the variables, identifiers are read from the source through their
 * spans rather than from the AST, which folds case: a data type the user called
 * `Irrigation_State` must not come back as `IRRIGATION_STATE` and get written
 * that way on the next save.
 */

import { parse } from 'strucpp'

import { baseTypeSchema } from '../../../middleware/shared/ports/plc-schemas'
import type { PLCDataType, PLCStructureVariable, PLCVariableType } from '../../../middleware/shared/ports/types'
import { classifyType } from './variable-declarations'

/**
 * A structure field's type is classified the same way a variable's is —
 * elementary, inline array, or a user data type. Function-block instances are
 * not resolved here: a STRUCT field cannot be one, so there is no project
 * context to consult.
 */
const FIELD_TYPE_CONTEXT = {
  resolveBaseType: (name: string) => {
    const check = baseTypeSchema.safeParse(name.toUpperCase())
    return check.success ? check.data : undefined
  },
}

export interface ParseDataTypeResult {
  dataType?: PLCDataType
  error?: string
}

interface StrucppSpan {
  startLine: number
  endLine: number
  startCol: number
  endCol: number
}

interface StrucppNode {
  kind: string
  sourceSpan: StrucppSpan
  [key: string]: unknown
}

/** Character offset of the start of each 1-indexed line. */
function lineStarts(source: string): number[] {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** The source text a span covers, which is the user's own spelling. */
function sliceSpan(source: string, starts: number[], span: StrucppSpan): string {
  const start = (starts[span.startLine - 1] ?? 0) + span.startCol - 1
  const end = (starts[span.endLine - 1] ?? 0) + span.endCol
  return source.slice(start, end)
}

/** Comment trailing a field declaration, which the AST discards. */
function trailingDocumentation(source: string, starts: number[], span: StrucppSpan): string {
  const from = (starts[span.endLine - 1] ?? 0) + span.endCol
  const lineEnd = source.indexOf('\n', from)
  const rest = source.slice(from, lineEnd === -1 ? source.length : lineEnd)

  const block = /\(\*([\s\S]*?)\*\)/.exec(rest)
  if (block) return block[1].trim()
  const line = /\/\/(.*)$/.exec(rest)
  if (line) return line[1].trim()
  return ''
}

/** `TYPE Name : (); END_TYPE` — an enumeration the user has not filled in yet. */
const EMPTY_ENUM_REGEX = /^\s*TYPE\s+([A-Za-z_]\w*)\s*:\s*\(\s*\)\s*;\s*END_TYPE\s*$/i

const isRecord = (value: unknown): value is StrucppNode =>
  typeof value === 'object' && value !== null && 'kind' in value

/** The element type of an array definition, as the user spelled it. */
function elementType(source: string, starts: number[], definition: StrucppNode): PLCVariableType {
  const element = definition.elementType
  const text = isRecord(element)
    ? sliceSpan(source, starts, element.sourceSpan).trim()
    : typeof definition.elementTypeName === 'string'
      ? definition.elementTypeName
      : 'INT'
  const base = FIELD_TYPE_CONTEXT.resolveBaseType(text)
  return base !== undefined ? { definition: 'base-type', value: base } : { definition: 'user-data-type', value: text }
}

/** `0..3` for one dimension, read from the source so symbolic bounds survive. */
function dimensionText(source: string, starts: number[], dimension: StrucppNode): string {
  return sliceSpan(source, starts, dimension.sourceSpan).trim()
}

function buildStructure(source: string, starts: number[], name: string, definition: StrucppNode): ParseDataTypeResult {
  const fields = Array.isArray(definition.fields) ? definition.fields : []
  const variable: PLCStructureVariable[] = []

  for (const field of fields) {
    if (!isRecord(field)) continue
    const names = Array.isArray(field.names) ? field.names : []
    const nameSpans = Array.isArray(field.nameSpans) ? field.nameSpans : []
    const typeNode = isRecord(field.type) ? field.type : undefined
    if (!typeNode) continue

    const typeText = sliceSpan(source, starts, typeNode.sourceSpan).trim()
    const documentation = trailingDocumentation(source, starts, field.sourceSpan)
    const initialNode = isRecord(field.initialValue) ? field.initialValue : undefined
    const initialValue = initialNode ? sliceSpan(source, starts, initialNode.sourceSpan).trim() : ''

    // A field naming several variables is one declaration in the text and
    // several fields in the model, exactly as in a VAR block.
    names.forEach((_folded, index) => {
      const span: StrucppSpan | undefined = nameSpans[index]
      const fieldName = span ? sliceSpan(source, starts, span) : ''
      variable.push({
        name: fieldName,
        type: classifyType(typeText, FIELD_TYPE_CONTEXT),
        // A structure field's initial value is wrapped, unlike a variable's.
        ...(initialValue !== '' ? { initialValue: { simpleValue: { value: initialValue } } } : {}),
        ...(documentation !== '' ? { documentation } : {}),
      })
    })
  }

  return { dataType: { name, derivation: 'structure', variable } }
}

function buildEnum(source: string, starts: number[], name: string, definition: StrucppNode): ParseDataTypeResult {
  const members = Array.isArray(definition.members) ? definition.members : []
  const values = members.filter(isRecord).map((member) => ({
    description: sliceSpan(source, starts, member.sourceSpan).trim(),
  }))

  // `defaultValue` is the folded name, so match it back to the member the user
  // wrote and take that spelling. Otherwise an enum defaulting to `Running`
  // comes back as `RUNNING` and is written that way on the next save.
  const initial = typeof definition.defaultValue === 'string' ? definition.defaultValue : ''
  const spelled = values.find((value) => value.description.toUpperCase() === initial.toUpperCase())

  return {
    dataType: {
      name,
      derivation: 'enumerated',
      values,
      initialValue: spelled?.description ?? initial,
    },
  }
}

function buildArray(
  source: string,
  starts: number[],
  name: string,
  definition: StrucppNode,
  defaultValue: unknown,
): ParseDataTypeResult {
  const dimensions = (Array.isArray(definition.dimensions) ? definition.dimensions : [])
    .filter(isRecord)
    .map((dimension) => ({ dimension: dimensionText(source, starts, dimension) }))

  if (dimensions.length === 0) return { error: `data type "${name}" declares an array with no dimensions` }

  return {
    dataType: {
      name,
      derivation: 'array',
      baseType: elementType(source, starts, definition),
      initialValue: isRecord(defaultValue) ? sliceSpan(source, starts, defaultValue.sourceSpan).trim() : '',
      dimensions,
    },
  }
}

/**
 * Parse a `.dt` file's `TYPE … END_TYPE` block into the editor's model.
 *
 * `expectedName` is the name the file claims by its path; a declaration naming
 * something else is refused rather than silently renamed, because the file name
 * is what the project tree and every reference use.
 */
export function parseDataTypeFromText(content: string, expectedName?: string): ParseDataTypeResult {
  let ast: { types?: unknown[] } | undefined
  let errors: Array<{ message: string }> = []
  try {
    const result = parse(content) as { ast?: { types?: unknown[] }; errors?: Array<{ message: string }> }
    ast = result.ast
    errors = result.errors ?? []
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  if (errors.length > 0) {
    // `E : ();` is what the UI produces the moment a user adds an enumeration,
    // before they have typed a value into it. STruC++ refuses it, and is right
    // to — an enumeration with no members cannot compile — but the editor has
    // to be able to hold a type that is still being written. Same reasoning as
    // an empty POU: refuse it at build time, not while it is being authored.
    const empty = EMPTY_ENUM_REGEX.exec(content)
    if (empty) {
      return { dataType: { name: empty[1], derivation: 'enumerated', values: [], initialValue: '' } }
    }
    return { error: errors[0].message }
  }

  const types = (ast?.types ?? []).filter(isRecord)
  if (types.length === 0) return { error: 'the TYPE block declares no data type' }
  if (types.length > 1) return { error: 'a .dt file must declare exactly one data type' }

  const starts = lineStarts(content)
  const declaration = types[0]
  const name = sliceSpan(content, starts, declaration.sourceSpan).trim().split(/[\s:]/)[0]
  const definition = isRecord(declaration.definition) ? declaration.definition : undefined
  if (!definition) return { error: `data type "${name}" has no definition` }

  let result: ParseDataTypeResult
  switch (definition.kind) {
    case 'StructDefinition':
      result = buildStructure(content, starts, name, definition)
      break
    case 'EnumDefinition':
      result = buildEnum(content, starts, name, definition)
      break
    case 'ArrayDefinition':
      result = buildArray(content, starts, name, definition, declaration.defaultValue)
      break
    default:
      // A plain alias (`MyInt : INT;`) is legal IEC that the editor's model has
      // no derivation for — it knows structures, enumerations and arrays only.
      // Refusing it is honest; inventing a one-field structure for it would put
      // something in the tree the user never wrote.
      return { error: `data type "${name}" is an alias for another type, which this editor cannot represent` }
  }

  if (result.dataType === undefined) return result

  if (expectedName !== undefined && result.dataType.name.toLowerCase() !== expectedName.toLowerCase()) {
    return {
      error: `declared type name "${result.dataType.name}" does not match the expected name "${expectedName}" — rename the data type via the project tree instead`,
    }
  }
  if (expectedName !== undefined) result.dataType.name = expectedName

  return result
}
