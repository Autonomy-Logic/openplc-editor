/**
 * FBD/LD body dispatcher — iterates the graphical instances of a body in
 * execution order + position-sorted order, dispatching each to its emitter.
 *
 * Mirrors the FBD/LD branch of `PouProgramGenerator.ComputeProgram`
 * (PLCGenerator.py:1322-1427) plus the helper functions it relies on:
 *   - `SortInstances`              (PLCGenerator.py:89)
 *   - `GetUsedEno`                 (PLCGenerator.py:1243)
 *
 * Per-instance emitters are kept in this module too so the file is the
 * single home for "what does a graphical body emit?". `generateBlock` and
 * `computeExpression` live in `path_tree.ts` because they form the
 * sub-expression machinery that `body_emit.ts` orchestrates.
 */

import {
  getconnectionPointIn,
  getconnections,
  getcontentInstance,
  getcontentInstances,
  getexecutionOrderId,
  getexpression,
  getformalParameter,
  getinputVariables,
  getinstanceName,
  getlocalId,
  getname,
  getposition,
  getrefLocalId,
  gettypeName,
  getvariable,
  getvariableText,
  InstanceTag,
} from '../plcopen/accessors'
import { type Element, getLocalTag } from '../xmlclass/xsdschema'
import { type BlockInfos, GetBlockType, synthesizePermissiveBlockInfos } from './block_library'
import { PLCGenException } from './connection_types'
import type { GenState } from './gen_state'
import { extractModifier } from './modifiers'
import { computeExpression, generateBlock } from './path_tree'
import type { Location, ProgramChunk } from './program'

/* ──────────────────────── SortInstances ─────────────────────────────────── */

/**
 * Comparator for instances without an `executionOrderId`. Sort by y first
 * (with a 10-unit tolerance — within a band, fall through to x sort).
 * Mirrors PLCGenerator.py:89 exactly.
 */
export function sortInstances(a: Element, b: Element): number {
  const pa = getposition(a)
  const pb = getposition(b)
  // Python casts to int — mirror by truncating.
  const ax = Math.trunc(pa?.x ?? 0)
  const ay = Math.trunc(pa?.y ?? 0)
  const bx = Math.trunc(pb?.x ?? 0)
  const by = Math.trunc(pb?.y ?? 0)
  if (Math.abs(ay - by) < 10) return ax - bx
  return ay - by
}

/* ────────────────────────── GetUsedEno ──────────────────────────────────── */

/**
 * If the single upstream block of `connections[0]` has its `EN` input
 * connected, return the ENO output variable name. Otherwise null.
 *
 * Mirrors PLCGenerator.py:1243. Used by `emitOutVariable` to wrap the
 * assignment in `IF eno THEN ... END_IF;` so values from EN-gated blocks
 * don't propagate when EN is false.
 */
export function getUsedEno(body: Element, connections: readonly Element[]): string | null {
  if (connections.length !== 1) return null
  const refId = getrefLocalId(connections[0])
  if (refId === null) return null
  const blk = getcontentInstance(body, refId)
  if (!blk) return null
  // Python's `hasattr(blk, "inputVariables")` — only blocks have it.
  if (getLocalTag(blk) !== InstanceTag.Block) return null

  const inputWrapper = getinputVariables(blk)
  if (!inputWrapper) return null
  for (const invar of getvariable(inputWrapper)) {
    if (getformalParameter(invar) !== 'EN') continue
    const cpIn = getconnectionPointIn(invar)
    if (!cpIn) return null
    if (getconnections(cpIn).length === 0) return null
    const instanceName = getinstanceName(blk)
    if (instanceName === null) {
      const typeName = gettypeName(blk) ?? ''
      const localId = getlocalId(blk) ?? 0
      return `_TMP_${typeName}${localId}_ENO`
    }
    return `${instanceName}.ENO`
  }
  return null
}

/* ────────────────────────── per-instance emitters ───────────────────────── */

function indentRight(state: GenState): void {
  state.currentIndent += '  '
}

function indentLeft(state: GenState): void {
  if (state.currentIndent.length >= 2) {
    state.currentIndent = state.currentIndent.slice(0, -2)
  }
}

/**
 * Emit an `<outVariable>` or `<inOutVariable>` assignment.
 *
 * Mirrors PLCGenerator.py:1350-1381. Optional ENO wrap when the upstream
 * source is an EN-gated block.
 */
function emitOutVariable(state: GenState, instance: Element, body: Element): void {
  const cpIn = getconnectionPointIn(instance)
  if (!cpIn) return
  const connections = getconnections(cpIn)
  if (connections.length === 0) return
  const expression = computeExpression(state, body, connections)
  if (expression === null) return

  const enoVar = getUsedEno(body, connections)
  if (enoVar !== null) {
    state.program.push([`${state.currentIndent}IF ${enoVar}`, []])
    state.program.push([' THEN\n  ', []])
    indentRight(state)
  }

  const localId = getlocalId(instance) ?? 0
  const expressionText = getexpression(instance) ?? ''
  state.program.push([state.currentIndent, []])
  state.program.push([expressionText, [state.tagName, 'io_variable', localId, 'expression']])
  state.program.push([' := ', []])
  state.program.push(...expression)
  state.program.push([';\n', []])

  if (enoVar !== null) {
    indentLeft(state)
    state.program.push([`${state.currentIndent}END_IF;\n`, []])
  }
}

/**
 * Emit a standalone block invocation (no downstream consumer of its outputs).
 *
 * Mirrors PLCGenerator.py:1382-1404. The `link` parameter is `None` here —
 * `generateBlock`'s output-resolution branch returns `undefined` and we
 * discard the result. The block's call statement still lands in
 * `state.program` as a side effect.
 */
function emitStandaloneBlock(state: GenState, instance: Element, body: Element): void {
  const typeName = gettypeName(instance) ?? ''
  const inputWrapper = getinputVariables(instance)
  const callerInputTypes: string[] = inputWrapper
    ? getvariable(inputWrapper)
        .filter((v) => getformalParameter(v) !== 'EN')
        .map((v) => {
          const cp = getconnectionPointIn(v)
          if (!cp) return 'ANY'
          return state.connectionTypes.get(cp) ?? 'ANY'
        })
    : []
  let blockInfos: BlockInfos | null =
    state.project !== null ? GetBlockType(state.project, typeName, callerInputTypes) : null
  if (blockInfos === null && state.project !== null) {
    blockInfos = GetBlockType(state.project, typeName)
  }
  if (blockInfos === null) {
    blockInfos = synthesizePermissiveBlockInfos(instance)
  }
  try {
    generateBlock(state, instance, blockInfos, body, null)
  } catch (e) {
    if (e instanceof Error) throw new PLCGenException(e.message)
    throw e
  }
}

/**
 * Emit a connector. Mirrors PLCGenerator.py:1405-1413.
 *
 * A `<connector>` caches its upstream expression into
 * `state.computedConnectors` keyed by `@name`. Downstream `<continuation>`
 * elements with the same name fetch the cached expression instead of
 * recomputing. Phase 4f's Continuation branch (still pending) will read
 * this map.
 */
function emitConnector(state: GenState, instance: Element, body: Element): void {
  const name = getname(instance)
  if (name === null) return
  if (state.computedConnectors.get(name)) return
  const cpIn = getconnectionPointIn(instance)
  if (!cpIn) return
  const connections = getconnections(cpIn)
  if (connections.length === 0) return
  const expression = computeExpression(state, body, connections)
  if (expression !== null) {
    state.computedConnectors.set(name, expression)
  }
}

/**
 * Emit a coil assignment. Mirrors PLCGenerator.py:1414-1427.
 *
 * `coil.variable := expression;` — with `extractModifier` applied
 * (handles negation, set/reset storage, rising/falling edges).
 */
function emitCoil(state: GenState, instance: Element, body: Element): void {
  const cpIn = getconnectionPointIn(instance)
  if (!cpIn) return
  const connections = getconnections(cpIn)
  if (connections.length === 0) return

  const localId = getlocalId(instance) ?? 0
  const coilInfo: Location = [state.tagName, 'coil', localId]
  let expression = computeExpression(state, body, connections)
  if (expression === null) return
  expression = extractModifier(state, instance, expression, coilInfo)

  state.program.push([state.currentIndent, []])
  state.program.push([getvariableText(instance), [...coilInfo, 'reference']])
  state.program.push([' := ', []])
  state.program.push(...expression)
  state.program.push([';\n', []])
}

/* ───────────────────────── FBD/LD dispatcher ────────────────────────────── */

/**
 * Drive the FBD/LD branch of `ComputeProgram`. Categorize instances by
 * type + executionOrderId, sort each bucket per Python's rules, then
 * dispatch each instance to its emitter.
 *
 * Mirrors PLCGenerator.py:1322-1427.
 */
export function emitFbdLdBody(state: GenState, body: Element): void {
  const orderedInstances: [number, Element][] = []
  const outVariablesAndCoils: Element[] = []
  const blocks: Element[] = []
  const connectors: Element[] = []

  for (const instance of getcontentInstances(body)) {
    const tag = getLocalTag(instance)
    if (tag === InstanceTag.OutVariable || tag === InstanceTag.InOutVariable || tag === InstanceTag.Block) {
      const order = getexecutionOrderId(instance) ?? 0
      if (order > 0) {
        orderedInstances.push([order, instance])
      } else if (tag === InstanceTag.OutVariable || tag === InstanceTag.InOutVariable) {
        outVariablesAndCoils.push(instance)
      } else {
        blocks.push(instance)
      }
    } else if (tag === InstanceTag.Connector) {
      connectors.push(instance)
    } else if (tag === InstanceTag.Coil) {
      outVariablesAndCoils.push(instance)
    }
    // Contact / InVariable / Left+RightPowerRail / Continuation / Step /
    // Transition / JumpStep — silently skipped (Python's elif chain).
  }

  orderedInstances.sort((a, b) => a[0] - b[0])
  const orderedOnly = orderedInstances.map(([, inst]) => inst)

  const others = [...outVariablesAndCoils, ...blocks, ...connectors]
  others.sort(sortInstances)

  const instances = [...orderedOnly, ...others]

  for (const instance of instances) {
    const tag = getLocalTag(instance)
    if (tag === InstanceTag.OutVariable || tag === InstanceTag.InOutVariable) {
      emitOutVariable(state, instance, body)
    } else if (tag === InstanceTag.Block) {
      emitStandaloneBlock(state, instance, body)
    } else if (tag === InstanceTag.Connector) {
      emitConnector(state, instance, body)
    } else if (tag === InstanceTag.Coil) {
      emitCoil(state, instance, body)
    }
  }
}

/* ────────────────────────── re-exports ──────────────────────────────────── */

// `Location` and `ProgramChunk` are re-exported so callers of this file
// don't need to reach into program.ts for typed work with chunks.
export type { Location, ProgramChunk }
