/**
 * IR-native textual-POU emitter — ST / IL / Python / C++.
 *
 * Skips the DOM round-trip entirely: walks `TranspilePou` directly
 * and emits the same chunk shape `pou_assembly.generateProgram`
 * produces for textual bodies.  Byte-identical with the XML-fed
 * transpiler (verified by the comparison helper).
 *
 * Graphical POUs (LD / FBD / SFC) still go through the DOM-based
 * walker in `src/PLCGenerator/pou_assembly.ts` — see `index.ts`'s
 * dispatch.
 */

import { PLC_BASE_TYPES } from '../helpers/base-types'
import type { ProgramChunk } from '../helpers/program'
import { reIndentText } from '../helpers/text-helpers'
import { computePouName } from '../helpers/text-helpers'
import { varTypeNames } from '../helpers/type-text'
import type { TranspilePou, TranspileProject, TranspileVariable, TranspileVariableClass } from '../types'
import { declaredTypeName, getTypeAsText } from './type-text'
import { computeValue } from './value'

/**
 * Mirror python's `<returnType>` rendering rule: elementary IEC
 * types come out uppercased (`BOOL`, `INT`, …), user-defined
 * derived types keep their declared case (`Irrigation_State`).
 * `interface.computeReturnType` in the XML-fed transpiler does the
 * equivalent by branching on the `<derived>` local tag.
 */
function formatReturnType(returnType: string | undefined): string {
  if (returnType === undefined || returnType === '') return 'BOOL'
  return PLC_BASE_TYPES.has(returnType.toUpperCase()) ? returnType.toUpperCase() : returnType
}

interface InterfaceEntry {
  keyword: string
  located: boolean
  /** Block qualifier for this group; absent = plain `VAR`. */
  flag?: TranspileVariable['flag']
  vars: TranspileVariable[]
}

/* ─────────────────────────── public entry ───────────────────────────────── */

/**
 * Emit a complete textual-body POU (signature → VAR sections → body
 * text → closing keyword).  Mirrors
 * `PouProgramGenerator.GenerateProgram` (PLCGenerator.py:2414) for the
 * textual body path.
 *
 * Throws `Error` when the POU has no interface or no body — same
 * guards Python uses.
 */
export function generateTextualPou(pou: TranspilePou, project: TranspileProject, indent = 2): ProgramChunk[] {
  const tagName = computePouName(pou.name)
  const kindKeyword = (
    {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    } as Record<string, string>
  )[pou.pouType]

  const program: ProgramChunk[] = []
  program.push([`${kindKeyword} `, []])
  program.push([pou.name, [tagName, 'name']])

  if (pou.pouType === 'function') {
    program.push([' : ', []])
    program.push([formatReturnType(pou.interface.returnType), [tagName, 'return']])
  }
  program.push(['\n', []])

  const iface = computeInterface(pou.interface.variables)
  if (iface.length === 0) {
    throw new Error(`No variable defined in "${pou.name}" POU`)
  }

  let varNumber = 0
  for (const entry of iface) {
    const variableType = locationCategory(entry.keyword)
    program.push([`  ${entry.keyword}${flagKeyword(entry.flag)}`, []])
    program.push(['\n', []])

    for (const v of entry.vars) {
      program.push(['    ', []])
      program.push([v.name, [tagName, variableType, varNumber, 'name']])
      program.push([' ', []])

      if (v.location) {
        program.push(['AT ', []])
        program.push([v.location, [tagName, variableType, varNumber, 'location']])
        program.push([' ', []])
      }

      const typeText = getTypeAsText(v)
      program.push([': ', []])
      program.push([typeText, [tagName, variableType, varNumber, 'type']])

      if (v.initialValue !== undefined && v.initialValue !== '') {
        const declared = declaredTypeName(v)
        program.push([' := ', []])
        program.push([
          computeValue(project, v.initialValue, declared),
          [tagName, variableType, varNumber, 'initial value'],
        ])
      }
      program.push([';\n', []])
      varNumber++
    }
    program.push(['  END_VAR\n', []])
  }

  program.push(['\n', []])

  // Body: raw textual source, re-indented to `indent` spaces.  For ST
  // / IL / Python / C++ the IR's `value` is already a string.
  if (
    pou.body.language !== 'st' &&
    pou.body.language !== 'il' &&
    pou.body.language !== 'python' &&
    pou.body.language !== 'cpp'
  ) {
    throw new Error(`generateTextualPou called with non-textual body "${pou.body.language}"`)
  }
  const bodyText = pou.body.value
  if (bodyText.length === 0) {
    throw new Error(`No body defined in "${pou.name}" POU`)
  }
  program.push([reIndentText(bodyText, indent), [tagName, 'body', indent]])

  program.push([`END_${kindKeyword}\n\n`, []])
  return program
}

/* ────────────────────── helpers ─────────────────────────────────────────── */

function computeInterface(variables: TranspileVariable[]): InterfaceEntry[] {
  // Bucket variables by class, mirroring the order Python's varlist
  // iteration produces.  `classToKeyword` is keyed on IR class names
  // (which match the PLCOpen `<localVars>`/`<inputVars>`/… local
  // tags after lower-casing the leading section); look those up
  // through `varTypeNames` so the keyword strings stay identical to
  // the DOM emitter.
  const classToKeyword: Record<TranspileVariableClass, string> = {
    input: varTypeNames.inputVars,
    output: varTypeNames.outputVars,
    inOut: varTypeNames.inOutVars,
    external: varTypeNames.externalVars,
    local: varTypeNames.localVars,
    temp: varTypeNames.tempVars,
  }

  // Keyed by class × flag: IEC puts the qualifier on the var BLOCK, not on the
  // declaration, so two variables of the same class with different flags cannot
  // share a block — `VAR CONSTANT` and `VAR` are separate `…END_VAR` pairs.
  // The key keeps `keyword` first so a Map iteration still yields the class
  // order the DOM emitter produced.
  const grouped = new Map<
    string,
    { keyword: string; flag?: TranspileVariable['flag']; located: TranspileVariable[]; unlocated: TranspileVariable[] }
  >()
  // Maintain insertion order matching the IR's variable order.
  for (const v of variables) {
    const keyword = classToKeyword[v.class ?? 'local'] ?? varTypeNames.localVars
    const key = `${keyword}\u0000${v.flag ?? ''}`
    let bucket = grouped.get(key)
    if (!bucket) {
      bucket = { keyword, ...(v.flag !== undefined ? { flag: v.flag } : {}), located: [], unlocated: [] }
      grouped.set(key, bucket)
    }
    if (v.location) bucket.located.push(v)
    else bucket.unlocated.push(v)
  }

  const out: InterfaceEntry[] = []
  for (const bucket of grouped.values()) {
    const flagPart = bucket.flag !== undefined ? { flag: bucket.flag } : {}
    if (bucket.unlocated.length > 0) {
      out.push({ keyword: bucket.keyword, located: false, ...flagPart, vars: bucket.unlocated })
    }
    if (bucket.located.length > 0) {
      out.push({ keyword: bucket.keyword, located: true, ...flagPart, vars: bucket.located })
    }
  }
  return out
}

/** `CONSTANT` / `RETAIN` suffix for a var-block header; empty for a plain VAR. */
function flagKeyword(flag: TranspileVariable['flag']): string {
  return flag === 'constant' ? ' CONSTANT' : flag === 'retain' ? ' RETAIN' : ''
}

const ERROR_VAR_TYPES: Record<string, string> = {
  VAR_INPUT: 'var_input',
  VAR_OUTPUT: 'var_output',
  VAR_INOUT: 'var_inout',
}

function locationCategory(keyword: string): string {
  return ERROR_VAR_TYPES[keyword] ?? 'var_local'
}
