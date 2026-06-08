/**
 * IR-native graphical-POU emitter — LD / FBD bodies.
 *
 * Drives the React Flow walker (`../walker/`) for
 * the body content, then wraps it with the POU's signature + VAR
 * sections + END.  Trigger variables and function-call output temps
 * synthesised during the walk (`R_TRIG1`, `_TMP_<type><id>_OUT`, …)
 * get appended to the trailing `VAR` section before assembly so the
 * declaration order matches what the python oracle produces.
 */

import { PLC_BASE_TYPES } from '../helpers/base-types'
import { resolveBlockType } from '../helpers/block-library'
import type { ProgramChunk } from '../helpers/program'
import { computePouName } from '../helpers/text-helpers'
import { varTypeNames } from '../helpers/type-text'
import type { TranspilePou, TranspileProject, TranspileVariable, TranspileVariableClass } from '../types'
import { emitFbdBody } from '../walker/fbd'
import type { SyntheticVar } from '../walker/ld'
import { emitLdBody } from '../walker/ld'
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
 * the wrapping, with the body coming from the React Flow walker.
 */
export function generateGraphicalPou(pou: TranspilePou, project: TranspileProject): ProgramChunk[] {
  const tagName = computePouName(pou.name)
  const kindKeyword = (
    {
      program: 'PROGRAM',
      function: 'FUNCTION',
      'function-block': 'FUNCTION_BLOCK',
    } as Record<string, string>
  )[pou.pouType]

  if (pou.body.language !== 'ld' && pou.body.language !== 'fbd') {
    throw new Error(`generateGraphicalPou called with non-graphical body: ${pou.body.language}`)
  }
  const emitted = pou.body.language === 'ld' ? emitLdBody(pou.body.value) : emitFbdBody(pou.body.value)

  // Compose the final POU chunk stream now that the walker has
  // emitted the body bytes + any synthetic vars.
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
  const resolvedSyntheticVars = emitted.syntheticVars.map<SyntheticVar>((sv) => {
    if (sv.type !== 'ANY' || sv.originBlockTypeName === undefined) return sv
    const referenced = project.pous.find((p) => p.name === sv.originBlockTypeName)
    if (referenced && referenced.pouType === 'function' && referenced.interface.returnType) {
      return { ...sv, type: referenced.interface.returnType }
    }
    const stdResolved = resolveBlockType(sv.originBlockTypeName)
    if (stdResolved) {
      const outPort = stdResolved.infos.outputs.find((o) => o.name === sv.originFormalParameter)
      if (outPort) {
        const collapsed = outPort.type.startsWith('ANY') ? 'BOOL' : outPort.type
        return { ...sv, type: collapsed }
      }
    }
    return sv
  })

  const iface = computeInterface(pou.interface?.variables ?? [], resolvedSyntheticVars)
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
  program.push([emitted.bodySt, []])
  program.push([`END_${kindKeyword}\n\n`, []])
  return program
}

/* ────────────────────────── helpers ─────────────────────────────────────── */

function computeInterface(variables: TranspileVariable[], syntheticVars: SyntheticVar[]): InterfaceEntry[] {
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
  // declared locals — same order the python oracle produces.
  if (syntheticVars.length > 0) {
    const localKeyword = varTypeNames.localVars
    const localBucket = grouped.get(localKeyword) ?? []
    for (const sv of syntheticVars) {
      const isElementary = PLC_BASE_TYPES.has(sv.type.toUpperCase())
      localBucket.push({
        name: sv.name,
        type: isElementary
          ? { definition: 'base-type', value: sv.type.toUpperCase() }
          : { definition: 'derived', value: sv.type },
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
