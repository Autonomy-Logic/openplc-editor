/**
 * Port of `ComputeConnectionTypes` (PLCGenerator.py:971) — the BOOL
 * propagation phase. Mutates a `Phase2State` to build up the connection-point
 * type map.
 *
 * Scope (Phase 2c.1):
 *   ✅ IN / OUT / InOut variable branch (PLCGenerator.py:980-1030)
 *   ✅ Contact / Coil branch                              (1031-1044)
 *   ✅ LeftPowerRail / RightPowerRail branches            (1045-1061)
 *   ⏭ Transition branch (1062-1082) — no corpus coverage; ported but
 *      raises on encountering a malformed connection-type transition to
 *      match Python's `PLCGenException`.
 *   ⏭ Continuation / Connector branches (1083-1127) — no corpus coverage;
 *      ported.
 *   ⛔ Block branch (1129-1166) — deferred to Phase 2e (needs block library).
 *
 * The Python `pou` is dispatched by `isinstance(pou, (TransitionObjClass,
 * ActionObjClass))` to handle SFC sub-POUs differently. We assume `pou` is a
 * top-level POU element (Phase 2f will add SFC recursion); the
 * function-name-self-reference case for FUNCTION POUs is handled here.
 */

import {
  getactionList,
  getbody,
  getconnectionPointIn,
  getconnectionPointInAll,
  getconnectionPointOut,
  getconnectionPointOutAll,
  getconnections,
  getcontent,
  getcontentInstances,
  getexpression,
  getformalParameter,
  getinputVariables,
  getname,
  getoutputVariables,
  getpouType,
  gettransitionList,
  gettypeName,
  getvariable,
  InstanceTag,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { type Element, getLocalTag, isElement } from '../xmlclass/xsdschema'
import {
  type BlockInfos,
  GetBlockType,
  synthesizePermissiveBlockInfos,
} from './block_library'
import {
  ExtractRelatedConnections,
  GetConnectedConnector,
  GetLinkedConnector,
  type Phase2State,
} from './graph_primitives'
import { computeReturnType, type InterfaceEntry } from './interface'
import { getVariableType, literalType } from './variable_type'

/**
 * Run BOOL propagation + variable / block I/O typing over every graphical
 * instance in `body`.
 *
 * Mutates `state.connectionTypes` and `state.relatedConnections`. Iterates
 * children in document order — Python uses `body.getcontentInstances()`,
 * which is the same order our `getcontentInstances` returns.
 *
 * `project` is required so the Block branch can call `GetBlockType` against
 * project-local POUs. If `null`, blocks fall through to `synthesizePermissive`
 * unconditionally — useful for unit tests on isolated bodies.
 */
export function computeConnectionTypes(
  pou: Element,
  iface: InterfaceEntry[],
  body: Element,
  state: Phase2State,
  project: ProjectTree | Element | null = null,
): void {
  const undefinedBlocks: Element[] = []

  for (const instance of getcontentInstances(body)) {
    const tag = getLocalTag(instance)
    switch (tag) {
      case InstanceTag.InVariable:
      case InstanceTag.OutVariable:
      case InstanceTag.InOutVariable:
        handleVariableInstance(pou, iface, body, instance, tag, state, project)
        break

      case InstanceTag.Contact:
      case InstanceTag.Coil:
        handleContactOrCoil(body, instance, state)
        break

      case InstanceTag.LeftPowerRail:
        handleLeftPowerRail(instance, state)
        break

      case InstanceTag.RightPowerRail:
        handleRightPowerRail(body, instance, state)
        break

      case InstanceTag.Block:
        handleBlockPass1(body, instance, state, project, undefinedBlocks)
        break

      case InstanceTag.Transition:
        // Ported for completeness — corpus has no SFC bodies yet.
        handleTransition(body, instance, pou, state)
        break

      case InstanceTag.Continuation:
        handleContinuation(body, instance, state)
        break

      default:
        // `<connector>` is paired with `<continuation>` and processed via it.
        // `<step>` / `<jumpStep>` are SFC steps (Phase 2f).
        break
    }
  }

  // Pass 2: re-attempt resolution of blocks whose input types weren't yet
  // known in pass 1. Python's `GetBlockType(typename, tuple(input_types))`
  // narrows by signature for overloaded standard functions; project-local
  // POUs aren't overloaded so the narrowed lookup gives the same result.
  for (const instance of undefinedBlocks) {
    const typeName = gettypeName(instance) ?? ''
    let blockInfos: BlockInfos | null =
      project !== null ? GetBlockType(project, typeName) : null
    if (blockInfos === null) {
      blockInfos = synthesizePermissiveBlockInfos(instance)
    }
    computeBlockInputTypes(body, instance, blockInfos, state)
  }

  // SFC sub-POU recursion. Mirrors PLCGenerator.py:1167-1177:
  // after the main body has been typed, walk every named action / transition
  // sub-POU and run the same algorithm on each. Sub-POUs share the parent's
  // Interface and ConnectionTypes state — types accumulate across the family.
  const content = getcontent(body)
  if (content !== null && getLocalTag(content) === 'SFC') {
    for (const action of getactionList(pou)) {
      for (const subBody of getbody(action)) {
        computeConnectionTypes(action, iface, subBody, state, project)
      }
    }
    for (const transition of gettransitionList(pou)) {
      for (const subBody of getbody(transition)) {
        computeConnectionTypes(transition, iface, subBody, state, project)
      }
    }
  }
}

/* ────────────────────────── IN / OUT / InOut variables ───────────────────── */

function handleVariableInstance(
  pou: Element,
  iface: InterfaceEntry[],
  body: Element,
  instance: Element,
  tag: string,
  state: Phase2State,
  project: ProjectTree | Element | null,
): void {
  const expression = getexpression(instance) ?? ''
  let varType: string | null = getVariableType(iface, expression, project)

  if (varType === null) {
    // FUNCTION self-reference: when the expression is the function's own
    // name, its inferred type is the function's return type.
    if (getpouType(pou) === 'function' && getname(pou) === expression) {
      varType = computeReturnType(pou)
    }
  }
  if (varType === null) {
    varType = literalType(expression)
  }

  if (varType === null) return

  if (tag === InstanceTag.InVariable || tag === InstanceTag.InOutVariable) {
    const cpOut = getconnectionPointOut(instance)
    if (cpOut) {
      for (const c of ExtractRelatedConnections(state, cpOut)) {
        state.connectionTypes.set(c, varType)
      }
    }
  }
  if (tag === InstanceTag.OutVariable || tag === InstanceTag.InOutVariable) {
    const cpIn = getconnectionPointIn(instance)
    if (cpIn) {
      state.connectionTypes.set(cpIn, varType)
      const connected = GetConnectedConnector(cpIn, body)
      if (connected !== null && !state.connectionTypes.has(connected)) {
        for (const c of ExtractRelatedConnections(state, connected)) {
          state.connectionTypes.set(c, varType)
        }
      }
    }
  }
}

/* ────────────────────────── Contacts and Coils ───────────────────────────── */

function handleContactOrCoil(body: Element, instance: Element, state: Phase2State): void {
  const cpOut = getconnectionPointOut(instance)
  const cpIn = getconnectionPointIn(instance)
  if (cpOut) {
    for (const c of ExtractRelatedConnections(state, cpOut)) {
      state.connectionTypes.set(c, 'BOOL')
    }
  }
  if (cpIn) {
    state.connectionTypes.set(cpIn, 'BOOL')
    for (const link of getconnections(cpIn)) {
      const connected = GetLinkedConnector(link, body)
      if (connected !== null && !state.connectionTypes.has(connected)) {
        for (const c of ExtractRelatedConnections(state, connected)) {
          state.connectionTypes.set(c, 'BOOL')
        }
      }
    }
  }
}

/* ────────────────────────── Power rails ──────────────────────────────────── */

function handleLeftPowerRail(instance: Element, state: Phase2State): void {
  for (const cp of getconnectionPointOutAll(instance)) {
    for (const c of ExtractRelatedConnections(state, cp)) {
      state.connectionTypes.set(c, 'BOOL')
    }
  }
}

function handleRightPowerRail(body: Element, instance: Element, state: Phase2State): void {
  for (const cp of getconnectionPointInAll(instance)) {
    state.connectionTypes.set(cp, 'BOOL')
    for (const link of getconnections(cp)) {
      const connected = GetLinkedConnector(link, body)
      if (connected !== null && !state.connectionTypes.has(connected)) {
        for (const c of ExtractRelatedConnections(state, connected)) {
          state.connectionTypes.set(c, 'BOOL')
        }
      }
    }
  }
}

/* ────────────────────────── Block branch (pass 1) ────────────────────────── */

/**
 * First pass over a `<block>` instance.
 *
 * If `GetBlockType` resolves the type (project-local POU), immediately
 * propagate its signature via `computeBlockInputTypes`. Otherwise, populate
 * any per-input "what's connected upstream" hints into the state and queue
 * the block for pass 2 — by then enough other instances have been processed
 * that the input types may have become known.
 *
 * Mirrors `PLCGenerator.py:1129-1148`. The Python `"undefined"` sentinel
 * passed to `GetBlockType` is irrelevant for our project-local-only lookup
 * (Phase 2d.1 scope).
 */
function handleBlockPass1(
  body: Element,
  block: Element,
  state: Phase2State,
  project: ProjectTree | Element | null,
  undefinedBlocks: Element[],
): void {
  const typeName = gettypeName(block) ?? ''
  const blockInfos = project !== null ? GetBlockType(project, typeName) : null
  if (blockInfos !== null) {
    computeBlockInputTypes(body, block, blockInfos, state)
    return
  }
  // Couldn't resolve immediately — gather per-input hints so pass 2 sees the
  // freshest connection-type info.
  const inputWrapper = getinputVariables(block)
  if (inputWrapper) {
    for (const variable of getvariable(inputWrapper)) {
      const cpIn = getconnectionPointIn(variable)
      if (!cpIn) continue
      const connected = GetConnectedConnector(cpIn, body)
      if (connected === null) continue
      const varType = state.connectionTypes.get(connected)
      if (varType !== undefined) {
        state.connectionTypes.set(cpIn, varType)
      } else {
        const related = ExtractRelatedConnections(state, connected)
        related.push(cpIn)
        state.relatedConnections.push(related)
      }
    }
  }
  undefinedBlocks.push(block)
}

/* ────────────────────────── ComputeBlockInputTypes ──────────────────────── */

/**
 * Propagate a block's typed inputs/outputs to the connection points wired
 * into it. Mirrors `PouProgramGenerator.ComputeBlockInputTypes`
 * (PLCGenerator.py:1179-1241).
 *
 * Outputs first, then inputs. `EN` inputs and `ENO` outputs are always BOOL.
 * `ANY`-typed I/O accumulates into `undefined: Map<typeString, Element[]>`;
 * after the loop, each group resolves to either a concrete type observed
 * on one of its connection points, or stays ANY (in which case the group
 * is pushed into `relatedConnections` for later resolution by Continuations).
 */
export function computeBlockInputTypes(
  body: Element,
  instance: Element,
  blockInfos: BlockInfos,
  state: Phase2State,
): void {
  const undefinedGroups: Map<string, Element[]> = new Map()

  const outputs = getoutputVariables(instance)
  if (outputs) {
    for (const variable of getvariable(outputs)) {
      const cpOut = getconnectionPointOut(variable)
      if (!cpOut) continue
      const outputName = getformalParameter(variable)
      if (outputName === 'ENO') {
        for (const c of ExtractRelatedConnections(state, cpOut)) {
          state.connectionTypes.set(c, 'BOOL')
        }
        continue
      }
      for (const io of blockInfos.outputs) {
        if (io.name !== outputName) continue
        if (io.type.startsWith('ANY')) {
          getGroup(undefinedGroups, io.type).push(cpOut)
        } else if (!state.connectionTypes.has(cpOut)) {
          for (const c of ExtractRelatedConnections(state, cpOut)) {
            state.connectionTypes.set(c, io.type)
          }
        }
      }
    }
  }

  const inputs = getinputVariables(instance)
  if (inputs) {
    for (const variable of getvariable(inputs)) {
      const cpIn = getconnectionPointIn(variable)
      if (!cpIn) continue
      const inputName = getformalParameter(variable)
      if (inputName === 'EN') {
        for (const c of ExtractRelatedConnections(state, cpIn)) {
          state.connectionTypes.set(c, 'BOOL')
        }
        continue
      }
      for (const io of blockInfos.inputs) {
        if (io.name !== inputName) continue
        const connected = GetConnectedConnector(cpIn, body)
        if (io.type.startsWith('ANY')) {
          const group = getGroup(undefinedGroups, io.type)
          group.push(cpIn)
          if (connected !== null) group.push(connected)
        } else {
          state.connectionTypes.set(cpIn, io.type)
          if (connected !== null && !state.connectionTypes.has(connected)) {
            for (const c of ExtractRelatedConnections(state, connected)) {
              state.connectionTypes.set(c, io.type)
            }
          }
        }
      }
    }
  }

  // Resolve the deferred ANY groups: if any connection point in the group
  // is already concretely typed, the whole group adopts that type;
  // otherwise the group remains ANY and joins `relatedConnections`.
  for (const [origType, connections] of undefinedGroups) {
    let varType = origType
    const related: Element[] = []
    for (const c of connections) {
      const connectionType = state.connectionTypes.get(c)
      if (connectionType !== undefined && !connectionType.startsWith('ANY')) {
        varType = connectionType
      } else {
        related.push(...ExtractRelatedConnections(state, c))
      }
    }
    if (varType.startsWith('ANY') && related.length > 0) {
      state.relatedConnections.push(related)
    } else {
      for (const c of related) state.connectionTypes.set(c, varType)
    }
  }
}

function getGroup(groups: Map<string, Element[]>, key: string): Element[] {
  let group = groups.get(key)
  if (!group) {
    group = []
    groups.set(key, group)
  }
  return group
}

/* ────────────────────────── SFC: transitions ─────────────────────────────── */

/**
 * Error class used when a graphical condition can't be resolved. Mirrors
 * `PLCGenException` from `PLCGenerator.py`. Subclass of Error so it surfaces
 * cleanly in vitest output.
 */
export class PLCGenException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PLCGenException'
  }
}

/**
 * Subset of `transition.getconditionContent()` (plcopen.py:2801). For the
 * Phase 2c branch we only need the `"connection"` shape — text-based
 * conditions are handled by Phase 4 ST parsing, not type inference.
 */
function getConditionConnectionPoint(transition: Element): Element | null {
  const condition = findFirstChild(transition, 'condition')
  if (!condition) return null
  const inner = findFirstChildElement(condition)
  if (!inner) return null
  if (getLocalTag(inner) === 'connectionPointIn') return inner
  return null
}

function findFirstChild(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node && isElement(node) && node.localName === localName) return node
  }
  return null
}

function findFirstChildElement(el: Element): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i)
    if (node && isElement(node)) return node
  }
  return null
}

function handleTransition(
  body: Element,
  instance: Element,
  pou: Element,
  state: Phase2State,
): void {
  const cpIn = getConditionConnectionPoint(instance)
  if (!cpIn) return // text-based condition; handled elsewhere
  state.connectionTypes.set(cpIn, 'BOOL')
  const links = getconnections(cpIn)
  if (links.length === 0) {
    throw new PLCGenException(
      `SFC transition in POU "${getname(pou) ?? ''}" must be connected.`,
    )
  }
  for (const link of links) {
    const connected = GetLinkedConnector(link, body)
    if (connected !== null && !state.connectionTypes.has(connected)) {
      for (const c of ExtractRelatedConnections(state, connected)) {
        state.connectionTypes.set(c, 'BOOL')
      }
    }
  }
}

/* ────────────────────────── Continuations / Connectors ───────────────────── */

function handleContinuation(body: Element, instance: Element, state: Phase2State): void {
  const name = getname(instance)
  if (name === null) return

  let connector: Element | null = null
  for (const candidate of getcontentInstances(body)) {
    if (getLocalTag(candidate) === InstanceTag.Connector && getname(candidate) === name) {
      if (connector !== null) {
        throw new PLCGenException(
          `More than one connector found corresponding to "${name}" continuation`,
        )
      }
      connector = candidate
    }
  }
  if (connector === null) {
    throw new PLCGenException(`No connector found corresponding to "${name}" continuation`)
  }

  const cpOut = getconnectionPointOut(instance)
  const cpIn = getconnectionPointIn(connector)
  const candidates: Element[] = []
  if (cpOut) candidates.push(cpOut)
  if (cpIn) {
    candidates.push(cpIn)
    const connected = GetConnectedConnector(cpIn, body)
    if (connected) candidates.push(connected)
  }

  let varType = 'ANY'
  const related: Element[] = []
  for (const c of candidates) {
    const t = state.connectionTypes.get(c)
    if (t !== undefined) {
      varType = t
    } else {
      related.push(...ExtractRelatedConnections(state, c))
    }
  }

  if (varType.startsWith('ANY') && related.length > 0) {
    state.relatedConnections.push(related)
  } else {
    for (const c of related) state.connectionTypes.set(c, varType)
  }
}
