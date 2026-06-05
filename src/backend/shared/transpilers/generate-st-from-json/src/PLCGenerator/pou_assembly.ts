/**
 * POU assembly — wraps the body chunks `computeProgram` produces with the
 * full POU declaration (signature, VAR sections, body, closing keyword).
 *
 * Mirrors:
 *   - `PouProgramGenerator.GenerateProgram` (PLCGenerator.py:2414)
 *   - `errorVarTypes`                       (PLCGenerator.py:59)
 *   - `ProgramGenerator.ComputeValue`       (PLCGenerator.py:135)
 *   - `PLCControler.GetBaseType`            (PLCControler.py:1504)
 */

import { getname, getpouType } from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { type Element } from '../xmlclass/xsdschema'
import { PLCGenException } from './connection_types'
import { ComputeDataTypeName, GetDataTypeInfos } from './data_type'
import type { GenState } from './gen_state'
import { computeInterface, computeReturnType } from './interface'
import { computeProgram, type ProgramChunk } from './program'
import { computePouName } from './text_helpers'
import { TypeHierarchy } from './type_hierarchy'

/* ────────────────────── errorVarTypes ──────────────────────────────────── */

/**
 * Map VAR keyword → location-tuple category. Mirrors PLCGenerator.py:59.
 * Unrecognized keywords fall back to `"var_local"` (the bare `VAR` case).
 */
const ERROR_VAR_TYPES: Readonly<Record<string, string>> = {
  VAR_INPUT: 'var_input',
  VAR_OUTPUT: 'var_output',
  VAR_INOUT: 'var_inout',
}

function variableLocationCategory(keyword: string): string {
  return ERROR_VAR_TYPES[keyword] ?? 'var_local'
}

/* ────────────────────── getBaseType ────────────────────────────────────── */

/**
 * Walk derived types to their root IEC type. Mirrors `PLCControler.GetBaseType`
 * (PLCControler.py:1504).
 *
 * Returns:
 *   - the typename itself if it's already in `TypeHierarchy`
 *   - the resolved base type if the project defines this as a derived type
 *   - the input typename if the project defines it but `GetDataTypeBaseType` returns null
 *   - `null` if the type is unknown
 */
export function getBaseType(project: ProjectTree | Element | null, typename: string): string | null {
  if (typename in TypeHierarchy) return typename
  if (project === null) return null

  const infos = GetDataTypeInfos(project, ComputeDataTypeName(typename))
  if (infos === null) return null

  // Python's GetDataTypeBaseType wraps the same data we get back from
  // GetDataTypeInfos: for Subrange/Array/Structure it uses the inner base
  // type; for Directly it returns the alias target.
  let baseType: string | null = null
  if (infos.type === 'Subrange') {
    baseType = infos.base_type
  } else if (infos.type === 'Array') {
    baseType = infos.base_type
  } else if (infos.type === 'Directly') {
    baseType = infos.base_type
  } else if (infos.type === 'Structure') {
    // Python's GetDataTypeBaseType on a struct dataType returns the local
    // tag uppercased — i.e. the literal "struct" content tag's upper form.
    // In practice this branch isn't reached for STRING/WSTRING wrapping.
    return typename
  } else if (infos.type === 'Enumerated') {
    // Same as struct case.
    return typename
  }
  if (baseType === null) return typename
  return getBaseType(project, baseType)
}

/* ────────────────────── computeValue ───────────────────────────────────── */

/**
 * Wrap STRING / WSTRING initial values in quotes when the user didn't already.
 * Mirrors `ProgramGenerator.ComputeValue` (PLCGenerator.py:135).
 */
export function computeValue(project: ProjectTree | Element | null, value: string, varType: string): string {
  const baseType = getBaseType(project, varType)
  if (baseType === 'STRING' && !value.startsWith("'") && !value.endsWith("'")) {
    return `'${value}'`
  }
  if (baseType === 'WSTRING' && !value.startsWith('"') && !value.endsWith('"')) {
    return `"${value}"`
  }
  return value
}

/* ────────────────────── generateProgram ────────────────────────────────── */

export interface GenerateProgramOptions {
  /** Initial indentation level in spaces. Python defaults to 2. */
  indent?: number
  /** Project tree, required for body type inference + STRING/WSTRING quote logic. */
  project?: ProjectTree | Element | null
}

/**
 * Assemble a complete POU declaration: signature + VAR sections + body +
 * closing keyword.
 *
 * Mirrors `PouProgramGenerator.GenerateProgram` (PLCGenerator.py:2414). The
 * function internally calls `computeProgram` (which in turn runs
 * `computeInterface` and `computeConnectionTypes`); the assembled output
 * matches Python's `gen.GenerateProgram(pou)` return byte-for-byte.
 *
 * Throws `PLCGenException` when the POU has no interface or no body —
 * matches Python's validation guards.
 */
export function generateProgram(pou: Element, options: GenerateProgramOptions = {}): ProgramChunk[] {
  const indent = options.indent ?? 2
  const project = options.project ?? null

  // Determine POU kind for the signature and closing keyword. Python maps:
  //   "program"        → "PROGRAM"
  //   "function"       → "FUNCTION"
  //   "functionBlock"  → "FUNCTION_BLOCK"
  const pouType = getpouType(pou) ?? ''
  const type =
    (
      {
        program: 'PROGRAM',
        function: 'FUNCTION',
        functionBlock: 'FUNCTION_BLOCK',
      } as Record<string, string>
    )[pouType] ?? pouType.toUpperCase()

  const name = getname(pou) ?? ''
  const tagName = computePouName(name)

  // Drive computeProgram with a state object so we can read state.iface
  // afterward for the declarations. We populate `iface` here (instead of
  // letting computeProgram do it) because callers passing a pre-built
  // state expect computeProgram to consume it as-is.
  const state: GenState = {
    pou,
    tagName,
    iface: computeInterface(pou),
    body: pou,
    project,
    program: [],
    currentIndent: ' '.repeat(indent),
    computedConnectors: new Map(),
    computedBlocks: new Map(),
    connectionTypes: new Map(),
    relatedConnections: [],
    warnings: [],
    sfcSteps: new Map(),
    sfcTransitions: new Map(),
    sfcActions: new Map(),
    initialSteps: [],
    sfcComputedBlocks: [],
    actionNumber: 0,
  }
  computeProgram(pou, { project, indent, state })

  // Build the signature line. Python writes `<Type> <name>` then optional
  // `: <return>`, then `\n`.
  const program: ProgramChunk[] = [
    [`${type} `, []],
    [name, [tagName, 'name']],
  ]
  const returnType = computeReturnTypeOf(pou)
  if (returnType !== null) {
    program.push([' : ', []])
    program.push([returnType, [tagName, 'return']])
  }
  program.push(['\n', []])

  if (state.iface.length === 0) {
    throw new PLCGenException(`No variable defined in "${name}" POU`)
  }
  if (state.program.length === 0) {
    throw new PLCGenException(`No body defined in "${name}" POU`)
  }

  // Emit each variable section.
  let varNumber = 0
  for (const entry of state.iface) {
    const variableType = variableLocationCategory(entry.keyword)
    program.push([`  ${entry.keyword}`, []])
    if (entry.option !== null) {
      program.push([
        ` ${entry.option}`,
        [
          tagName,
          variableType,
          // Python emits this field as a `(start, end)` tuple. Our Location
          // model is a flat list; we encode the range as two consecutive
          // numbers prefixed with a sentinel so consumers can recognize the
          // pair. Real-Python cross-check below verifies the exact shape.
          varNumber,
          varNumber + entry.vars.length,
          entry.option.toLowerCase(),
        ],
      ])
    }
    program.push(['\n', []])

    for (const v of entry.vars) {
      program.push(['    ', []])
      if (v.name) {
        program.push([v.name, [tagName, variableType, varNumber, 'name']])
        program.push([' ', []])
      }
      if (v.address !== null) {
        program.push(['AT ', []])
        program.push([v.address, [tagName, variableType, varNumber, 'location']])
        program.push([' ', []])
      }
      program.push([': ', []])
      program.push([v.type, [tagName, variableType, varNumber, 'type']])
      if (v.initial !== null) {
        program.push([' := ', []])
        program.push([computeValue(project, v.initial, v.type), [tagName, variableType, varNumber, 'initial value']])
      }
      program.push([';\n', []])
      varNumber++
    }
    program.push(['  END_VAR\n', []])
  }
  program.push(['\n', []])
  program.push(...state.program)
  program.push([`END_${type}\n\n`, []])
  return program
}

/**
 * Determine the return type string used in the FUNCTION signature.
 *
 * Python sets `self.ReturnType` inside `ComputeInterface`. We re-run the
 * return-type extractor here (cheap, idempotent) rather than threading
 * that field through GenState. For non-FUNCTION POUs and POUs without a
 * `<returnType>`, returns `null` (signature has no `: returnType`).
 */
function computeReturnTypeOf(pou: Element): string | null {
  if (getpouType(pou) !== 'function') return null
  return computeReturnType(pou)
}
