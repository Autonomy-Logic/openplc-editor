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
import { type BlockInfos, blockInfosFromVariant, isRecord } from '../helpers/block-library'
import type { ProgramChunk } from '../helpers/program'
import { computePouName } from '../helpers/text-helpers'
import { varTypeNames } from '../helpers/type-text'
import type { TranspilePou, TranspileProject, TranspileVariable, TranspileVariableClass } from '../types'
import type { TypeContext } from '../walker/connection-types'
import { emitFbdBody } from '../walker/fbd'
import type { SyntheticVar } from '../walker/ld'
import { emitLdBody } from '../walker/ld'
import { declaredTypeName, getTypeAsText } from './type-text'
import { computeValue } from './value'

interface InterfaceEntry {
  keyword: string
  vars: TranspileVariable[]
  located?: boolean
  /** Block qualifier for this group; absent = plain `VAR`. */
  flag?: TranspileVariable['flag']
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
  const typeContext = buildTypeContext(pou, project)
  const emitted =
    pou.body.language === 'ld' ? emitLdBody(pou.body.value, typeContext) : emitFbdBody(pou.body.value, typeContext)

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

  const iface = computeInterface(pou.interface?.variables ?? [], emitted.syntheticVars)
  for (const entry of iface) {
    const variableType = locationCategory(entry.keyword)
    program.push([`  ${entry.keyword}${flagKeyword(entry.flag)}`, []])
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

// Block signatures from every graphical block instance's variant — the
// co-located equivalent of the embedded <libraryBlocks> payload. Deduped
// by name, first instance wins — deliberately mirroring the oracle's
// <libraryBlocks> dedup; user POUs are excluded (they resolve from their
// own interface).
function collectBlockSignatures(project: TranspileProject): Map<string, BlockInfos> {
  const userPouNames = new Set(project.pous.map((p) => p.name))
  const registry = new Map<string, BlockInfos>()
  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!isRecord(node) || node.type !== 'block' || !isRecord(node.data)) continue
      const infos = blockInfosFromVariant(node.data.variant)
      if (infos === null || userPouNames.has(infos.name) || registry.has(infos.name)) continue
      registry.set(infos.name, infos)
    }
  }
  for (const pou of project.pous) {
    if (pou.body.language === 'ld') {
      for (const rung of pou.body.value.rungs) visit(rung.nodes)
    } else if (pou.body.language === 'fbd') {
      visit(pou.body.value.rung.nodes)
    }
  }
  return registry
}

// GetVariableType + GetBlockType ports (PLCGenerator.py:786-817, PLCControler.py:1288-1335)
function buildTypeContext(pou: TranspilePou, project: TranspileProject): TypeContext {
  const normalizeReturnType = (rt: string): string => (PLC_BASE_TYPES.has(rt.toUpperCase()) ? rt.toUpperCase() : rt)

  const projectBlockInfos = (typeName: string): BlockInfos | null => {
    const p = project.pous.find((x) => x.name === typeName)
    if (p === undefined) return null
    const inputs: BlockInfos['inputs'] = []
    const outputs: BlockInfos['outputs'] = []
    for (const v of p.interface?.variables ?? []) {
      const io = { name: v.name, type: getTypeAsText(v), qualifier: 'none' as const }
      if (v.class === 'input' || v.class === 'inOut') inputs.push(io)
      if (v.class === 'output' || v.class === 'inOut') outputs.push(io)
    }
    if (p.pouType === 'function') {
      outputs.push({
        name: 'OUT',
        type: normalizeReturnType(p.interface.returnType ?? 'BOOL'),
        qualifier: 'none',
      })
    }
    return {
      name: typeName,
      type: p.pouType === 'function' ? 'function' : 'functionBlock',
      extensible: false,
      inputs,
      outputs,
      comment: '',
      usage: '',
    }
  }

  const libraryBlocks = collectBlockSignatures(project)

  // Library blocks (single generic signature each) resolve from the project's
  // own variants; user-defined POUs resolve from their interface. Generic
  // types stay verbatim — connection-type unification concretizes them.
  const resolveBlock = (typeName: string): BlockInfos | null =>
    libraryBlocks.get(typeName) ?? projectBlockInfos(typeName)

  const memberBlockInfos = resolveBlock

  const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()
  const findDataType = (name: string) => project.dataTypes.find((d) => same(d.name, name))

  const PARTIAL_ACCESS: Record<string, string> = { X: 'BOOL', B: 'BYTE', W: 'WORD', D: 'DWORD' }

  // The member `name` of a block or structure type, or a bit/part (`.3`, `.%B1`).
  const memberType = (typeName: string, name: string): string | null => {
    if (/^\d+$/.test(name)) return 'BOOL'
    const part = /^%([XBWD])\d+$/i.exec(name)
    if (part !== null) return PARTIAL_ACCESS[part[1].toUpperCase()]
    const block = memberBlockInfos(typeName)
    if (block !== null) {
      const io = [...block.inputs, ...block.outputs].find((m) => same(m.name, name))
      return io?.type ?? null
    }
    const dt = findDataType(typeName)
    if (dt === undefined || dt.derivation !== 'structure') return null
    const el = dt.variable.find((m) => same(m.name, name))
    return el === undefined ? null : getTypeAsText(el)
  }

  // The element of an array type (inline `ARRAY [..] OF T` or a named array
  // type) reached through `indices` subscripts, one per dimension.
  const elementType = (typeName: string, indices: number): string | null => {
    let dims: number
    let base: string
    const inline = /^ARRAY\s*\[(.*)\]\s*OF\s+(.+)$/i.exec(typeName.trim())
    if (inline !== null) {
      dims = inline[1].split(',').length
      base = inline[2].trim()
    } else {
      const dt = findDataType(typeName)
      if (dt === undefined || dt.derivation !== 'array') return null
      dims = dt.dimensions.length
      base = typeof dt.baseType === 'string' ? dt.baseType : dt.baseType.value
    }
    if (indices === dims) return PLC_BASE_TYPES.has(base.toUpperCase()) ? base.toUpperCase() : base
    if (indices > dims) return elementType(base, indices - dims)
    return null
  }

  // `name`, then `.field` and `[i, j]` steps; null when `expression` is not a
  // variable access (a literal, an expression).
  const parseAccess = (expression: string): { name: string; steps: (string | number)[] } | null => {
    const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(expression)
    if (head === null) return null
    const steps: (string | number)[] = []
    let i = head[0].length
    while (i < expression.length) {
      const rest = expression.slice(i)
      const field = /^\s*\.\s*(%?[A-Za-z0-9_]+)/.exec(rest)
      if (field !== null) {
        steps.push(field[1])
        i += field[0].length
        continue
      }
      const open = /^\s*\[/.exec(rest)
      if (open === null) return /^\s*$/.test(rest) ? { name: head[1], steps } : null
      i += open[0].length
      let depth = 1
      let indices = 1
      while (i < expression.length && depth > 0) {
        const ch = expression[i]
        if (ch === '[' || ch === '(') depth++
        else if (ch === ']' || ch === ')') depth--
        else if (ch === ',' && depth === 1) indices++
        i++
      }
      if (depth !== 0) return null
      steps.push(indices)
    }
    return { name: head[1], steps }
  }

  const variableType: TypeContext['variableType'] = (expression) => {
    const access = parseAccess(expression)
    if (access === null) return null
    let current: string | null = null
    if (pou.pouType === 'function' && same(access.name, pou.name) && pou.interface.returnType !== undefined) {
      current = normalizeReturnType(pou.interface.returnType)
    } else {
      const v = (pou.interface?.variables ?? []).find((x) => same(x.name, access.name))
      current = v === undefined ? null : getTypeAsText(v)
    }
    for (const step of access.steps) {
      if (current === null) break
      current = typeof step === 'number' ? elementType(current, step) : memberType(current, step)
    }
    return current
  }

  return { variableType, resolveBlock }
}

/** `CONSTANT` / `RETAIN` suffix for a var-block header; empty for a plain VAR. */
function flagKeyword(flag: TranspileVariable['flag']): string {
  return flag === 'constant' ? ' CONSTANT' : flag === 'retain' ? ' RETAIN' : ''
}

function computeInterface(variables: TranspileVariable[], syntheticVars: SyntheticVar[]): InterfaceEntry[] {
  const classToKeyword: Record<TranspileVariableClass, string> = {
    input: varTypeNames.inputVars,
    output: varTypeNames.outputVars,
    inOut: varTypeNames.inOutVars,
    external: varTypeNames.externalVars,
    local: varTypeNames.localVars,
    temp: varTypeNames.tempVars,
  }
  // Group by keyword × flag, preserving IR insertion order. The flag belongs to
  // the var BLOCK in IEC, so variables of one class with different qualifiers
  // cannot share a `…END_VAR` pair.
  const grouped = new Map<string, { keyword: string; flag?: TranspileVariable['flag']; vars: TranspileVariable[] }>()
  for (const v of variables) {
    const keyword = classToKeyword[v.class ?? 'local'] ?? varTypeNames.localVars
    const key = `${keyword}\u0000${v.flag ?? ''}`
    const bucket = grouped.get(key) ?? { keyword, ...(v.flag !== undefined ? { flag: v.flag } : {}), vars: [] }
    bucket.vars.push(v)
    grouped.set(key, bucket)
  }
  // python splits each varlist into an unlocated block then a located one (DIV-03)
  const out: InterfaceEntry[] = []
  for (const { keyword, flag, vars } of grouped.values()) {
    const flagPart = flag !== undefined ? { flag } : {}
    const unlocated = vars.filter((v) => !v.location)
    const located = vars.filter((v) => v.location)
    if (unlocated.length > 0) out.push({ keyword, vars: unlocated, ...flagPart })
    if (located.length > 0) out.push({ keyword, vars: located, located: true, ...flagPart })
  }
  if (syntheticVars.length > 0) {
    const synth: TranspileVariable[] = syntheticVars.map((sv) => {
      const isElementary = PLC_BASE_TYPES.has(sv.type.toUpperCase())
      return {
        name: sv.name,
        type: isElementary
          ? { definition: 'base-type', value: sv.type.toUpperCase() }
          : { definition: 'derived', value: sv.type },
        class: 'local',
      }
    })
    const last = out[out.length - 1]
    // python reuses the trailing block only when it is a plain unlocated VAR (DIV-16)
    if (last !== undefined && last.keyword === varTypeNames.localVars && !last.located && last.flag === undefined) {
      last.vars.push(...synth)
    } else {
      out.push({ keyword: varTypeNames.localVars, vars: synth })
    }
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
