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
  const interfaceTypes = new Map<string, string>()
  for (const v of project.configuration.globalVariables) {
    interfaceTypes.set(v.name, getTypeAsText(v))
  }
  for (const v of pou.interface?.variables ?? []) {
    interfaceTypes.set(v.name, getTypeAsText(v))
  }

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

  const variableType: TypeContext['variableType'] = (expression) => {
    const parts = expression.split('.')
    let name = parts.shift() ?? ''
    let current: string | null = null
    if (pou.pouType === 'function' && name === pou.name && pou.interface.returnType !== undefined) {
      current = normalizeReturnType(pou.interface.returnType)
    } else {
      current = interfaceTypes.get(name) ?? null
    }
    while (current !== null && parts.length > 0) {
      const block = memberBlockInfos(current)
      if (block !== null) {
        name = parts.shift() ?? ''
        current = null
        for (const io of [...block.inputs, ...block.outputs]) {
          if (io.name === name) {
            current = io.type
            break
          }
        }
      } else {
        const dt = project.dataTypes.find((d) => d.name === current)
        if (dt !== undefined && dt.derivation === 'structure') {
          name = parts.shift() ?? ''
          current = null
          for (const el of dt.variable) {
            if (el.name === name) {
              current = getTypeAsText(el)
              break
            }
          }
        } else {
          break
        }
      }
    }
    return current
  }

  return { variableType, resolveBlock }
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
  // Group by keyword, preserving IR insertion order.
  const grouped = new Map<string, TranspileVariable[]>()
  for (const v of variables) {
    const keyword = classToKeyword[v.class ?? 'local'] ?? varTypeNames.localVars
    const bucket = grouped.get(keyword) ?? []
    bucket.push(v)
    grouped.set(keyword, bucket)
  }
  // python splits each varlist into an unlocated block then a located one (DIV-03)
  const out: InterfaceEntry[] = []
  for (const [keyword, vars] of grouped) {
    const unlocated = vars.filter((v) => !v.location)
    const located = vars.filter((v) => v.location)
    if (unlocated.length > 0) out.push({ keyword, vars: unlocated })
    if (located.length > 0) out.push({ keyword, vars: located, located: true })
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
    if (last !== undefined && last.keyword === varTypeNames.localVars && !last.located) {
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
