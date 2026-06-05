/**
 * IR-native graphical-POU emitter — LD / FBD bodies.
 *
 * Drives the JSON-native walker (`ld/walker.ts`) for the body
 * content, then wraps it with the POU's signature + VAR sections +
 * END.  Trigger variables synthesised during the walk
 * (`R_TRIG1`, `F_TRIG1`, …) get appended to the trailing `VAR`
 * section before assembly so the declaration order matches what the
 * existing DOM walker produces.
 */

import type { LdBody } from '../ld/types'
import { emitLdBody } from '../ld/walker'
import { newWalkerState } from '../ld/walker_state'
import { resolveBlockType } from '../src/PLCGenerator/block_library'
import { PLC_BASE_TYPES } from '../src/PLCGenerator/ctn_globals'
import type { ProgramChunk } from '../src/PLCGenerator/program'
import { computePouName } from '../src/PLCGenerator/text_helpers'
import { varTypeNames } from '../src/PLCGenerator/type_text'
import type { TranspilePou, TranspileProject, TranspileVariable, TranspileVariableClass } from '../types'
import { declaredTypeName, getTypeAsText } from './type-text'
import { computeValue } from './value'

interface InterfaceEntry {
  keyword: string
  vars: TranspileVariable[]
}

/* ─────────────────────────── public entry ───────────────────────────────── */

/**
 * Emit a complete LD/FBD POU (signature → VAR sections → body →
 * closing keyword).  Mirrors `pou-textual.generateTextualPou` for
 * the wrapping, with the body coming from `emitLdBody` instead of
 * a raw string passthrough.
 */
export function generateGraphicalPou(
  pou: TranspilePou,
  ldBody: LdBody,
  project: TranspileProject,
  indent = 2,
): ProgramChunk[] {
  const tagName = computePouName(pou.name)
  const kindKeyword = (
    {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    } as Record<string, string>
  )[pou.pouType]

  // Pre-populate the walker's declaredVars set so trigger-var
  // synthesis (`R_TRIG1`, …) avoids collisions with the POU's
  // existing interface entries.
  const declaredVars = new Set<string>()
  for (const v of pou.interface?.variables ?? []) declaredVars.add(v.name)

  const walkerState = newWalkerState(tagName, ldBody, declaredVars)
  walkerState.currentIndent = ' '.repeat(indent)
  emitLdBody(walkerState)

  // Compose the final POU chunk stream now that the walker has
  // accumulated the body + any trigger vars.
  const program: ProgramChunk[] = []
  program.push([`${kindKeyword} `, []])
  program.push([pou.name, [tagName, 'name']])
  if (pou.pouType === 'function') {
    const returnType = (pou.interface.returnType ?? 'BOOL').toUpperCase()
    program.push([' : ', []])
    program.push([returnType, [tagName, 'return']])
  }
  program.push(['\n', []])

  // Resolve `ANY` placeholders in the synthesised function-output
  // temps:
  //   1. User-defined project functions → declared `interface.returnType`.
  //   2. Standard catalog functions (ADD, MUL, NOT, AND, …) → catalog's
  //      formal output `type`.  Generic groups (`ANY_BIT`, `ANY_NUM`,
  //      …) collapse to `BOOL`, which matches the corpus where these
  //      operators are always Boolean rung logic.  A future
  //      computeConnectionTypes port will narrow these properly.
  const resolvedTempVars = walkerState.functionTempVars.map((tv) => {
    if (tv.type !== 'ANY') return tv
    const referenced = project.pous.find((p) => p.name === tv.originBlockTypeName)
    if (referenced && referenced.pouType === 'function' && referenced.interface.returnType) {
      return { ...tv, type: referenced.interface.returnType }
    }
    const stdResolved = resolveBlockType(null, tv.originBlockTypeName)
    if (stdResolved) {
      const outPort = stdResolved.infos.outputs.find((o) => o.name === tv.originFormalParameter)
      if (outPort) {
        const t = outPort.type
        const collapsed = t.startsWith('ANY') ? 'BOOL' : t
        return { ...tv, type: collapsed }
      }
    }
    return tv
  })

  const iface = computeInterface(pou.interface?.variables ?? [], walkerState.triggerVars, resolvedTempVars)
  for (const entry of iface) {
    const variableType = locationCategory(entry.keyword)
    program.push([`  ${entry.keyword}`, []])
    program.push(['\n', []])
    entry.vars.forEach((v, varNumber) => {
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
    })
    program.push(['  END_VAR\n', []])
  }
  program.push(['\n', []])
  program.push(...walkerState.program)
  program.push([`END_${kindKeyword}\n\n`, []])
  return program
}

/* ────────────────────────── helpers ─────────────────────────────────────── */

function computeInterface(
  variables: TranspileVariable[],
  triggerVars: { name: string; type: 'R_TRIG' | 'F_TRIG' }[],
  functionTempVars: {
    name: string
    type: string
    originBlockTypeName: string
    originFormalParameter: string
  }[],
): InterfaceEntry[] {
  const classToKeyword: Record<TranspileVariableClass, string> = {
    input: varTypeNames.inputVars,
    output: varTypeNames.outputVars,
    inOut: varTypeNames.inOutVars,
    external: varTypeNames.externalVars,
    local: varTypeNames.localVars,
    temp: varTypeNames.tempVars,
  }
  // Group by keyword, preserving IR insertion order.
  const grouped = new Map<string, TranspileVariable[]>()
  for (const v of variables) {
    const keyword = classToKeyword[v.class ?? 'local'] ?? varTypeNames.localVars
    const bucket = grouped.get(keyword) ?? []
    bucket.push(v)
    grouped.set(keyword, bucket)
  }
  // Append synthesised trigger vars + function-call output temps to
  // the trailing VAR (local) bucket so they appear after the user's
  // declared locals — same order the DOM walker produces.
  if (triggerVars.length > 0 || functionTempVars.length > 0) {
    const localKeyword = varTypeNames.localVars
    const localBucket = grouped.get(localKeyword) ?? []
    for (const t of triggerVars) {
      localBucket.push({
        name: t.name,
        type: { definition: 'derived', value: t.type },
        class: 'local',
      })
    }
    for (const t of functionTempVars) {
      const isElementary = PLC_BASE_TYPES.has(t.type.toUpperCase())
      localBucket.push({
        name: t.name,
        type: isElementary
          ? { definition: 'base-type', value: t.type.toUpperCase() }
          : { definition: 'derived', value: t.type },
        class: 'local',
      })
    }
    grouped.set(localKeyword, localBucket)
  }
  const out: InterfaceEntry[] = []
  for (const [keyword, vars] of grouped) {
    out.push({ keyword, vars })
  }
  return out
}

const ERROR_VAR_TYPES: Record<string, string> = {
  VAR_INPUT: 'var_input',
  VAR_OUTPUT: 'var_output',
  VAR_INOUT: 'var_inout',
}

function locationCategory(keyword: string): string {
  return ERROR_VAR_TYPES[keyword] ?? 'var_local'
}
