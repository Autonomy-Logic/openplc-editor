/**
 * LD body walker — JSON-native port of
 * `src/PLCGenerator/path_tree.ts:generatePaths` plus the per-sink
 * dispatch in `src/PLCGenerator/body_emit.ts`.
 *
 * Input: an `LdBody` IR.
 * Output: `state.program` populated with the same `ProgramChunk`
 * stream the DOM walker emits, byte-faithful against the fixture
 * corpus (verified by `tests/json_walker_corpus.test.ts`).
 *
 * Scope (incremental):
 *   - LeftPowerRail / RightPowerRail
 *   - Contact (with negated / edge modifiers)
 *   - Coil (with negated / set / reset modifiers)
 *   - InVariable / OutVariable / InOutVariable
 *   - Block (function-block instance with formalParameter wiring)
 *
 * Not yet ported (Phase 3 follow-up):
 *   - Connector / Continuation (FBD; only marginally relevant to LD)
 *   - Permissive block-type synthesis for unknown block types
 *   - EN/ENO gating in cascaded blocks (LD case #21 shows the
 *     pattern; needs additional plumbing through `computeBlockCall`)
 */

import { extractModifier } from './modifiers'
import {
  computePaths,
  factorizePaths,
  type Location,
  leafNode,
  type PathNode,
  type ProgramChunk,
  TRUE_NODE,
} from './path_tree'
import type { Connection, LdInstance } from './types'
import type { WalkerState } from './walker_state'

/* ─────────────────────────── public entry ───────────────────────────────── */

/**
 * Walk the LD body and accumulate ST chunks in `state.program`.
 *
 * Iteration order:
 *   1. Sinks with explicit `executionOrderId` ascending.
 *   2. Sinks without execution order, sorted by Y first (10-unit
 *      tolerance), then X.
 *
 * Sinks = coils + outVariables + standalone block calls (blocks not
 * consumed by any downstream node).
 */
export function emitLdBody(state: WalkerState): void {
  // Mirror body_emit.ts dispatch: two buckets keyed on whether the
  // instance has a non-zero `executionOrderId`.
  //   - ordered: emitted first, sorted by executionOrderId ascending.
  //     Recursion launched from these sinks runs with `order=true`,
  //     which suppresses eager emission of upstream blocks (they
  //     emit at their own iteration step).
  //   - others: emitted after, sorted by position (Y first 10-unit
  //     tolerance, then X).  `order=false` so recursion eagerly
  //     emits any not-yet-emitted upstream block.
  const ordered: LdInstance[] = []
  const others: LdInstance[] = []

  for (const inst of state.body.instances) {
    if (inst.kind !== 'outVariable' && inst.kind !== 'inOutVariable' &&
        inst.kind !== 'coil' && inst.kind !== 'block' && inst.kind !== 'connector') {
      continue
    }
    const eoid =
      'executionOrderId' in inst ? (inst.executionOrderId ?? 0) : 0
    if (eoid > 0) ordered.push(inst)
    else others.push(inst)
  }

  ordered.sort((a, b) => {
    const ao = 'executionOrderId' in a ? (a.executionOrderId ?? 0) : 0
    const bo = 'executionOrderId' in b ? (b.executionOrderId ?? 0) : 0
    return ao - bo
  })
  others.sort(comparePosition)

  for (const inst of ordered) dispatchInstance(state, inst, /*order=*/ true)
  for (const inst of others) dispatchInstance(state, inst, /*order=*/ false)
}

function dispatchInstance(state: WalkerState, inst: LdInstance, order: boolean): void {
  if (inst.kind === 'coil') return emitCoil(state, inst, order)
  if (inst.kind === 'outVariable') return emitOutVariable(state, inst, order)
  if (inst.kind === 'inOutVariable') return emitInOutVariable(state, inst, order)
  if (inst.kind === 'block') return emitStandaloneBlockCall(state, inst, order)
  if (inst.kind === 'connector') return emitConnector(state, inst)
}

/**
 * Connector iteration step.  Walks the connector's upstream and
 * caches the resulting expression under the connector's `name`.
 * Continuation visits later look up the cached chunks.
 */
function emitConnector(
  state: WalkerState,
  conn: Extract<LdInstance, { kind: 'connector' }>,
): void {
  if (state.connectorExprs.has(conn.name)) return
  const paths = generatePaths(state, conn.connections, false)
  if (paths.length === 0) return
  state.connectorExprs.set(conn.name, pathsToChunks(paths))
}

/* ─────────────────────────── position sort ──────────────────────────────── */

function comparePosition(a: LdInstance, b: LdInstance): number {
  // Mirror PLCGenerator.py:89 — sort by Y (10-unit tolerance) then X.
  const ax = Math.trunc(a.position.x)
  const ay = Math.trunc(a.position.y)
  const bx = Math.trunc(b.position.x)
  const by = Math.trunc(b.position.y)
  if (Math.abs(ay - by) >= 10) return ay - by
  return ax - bx
}

/* ─────────────────────────── per-sink emitters ──────────────────────────── */

function emitCoil(
  state: WalkerState,
  coil: Extract<LdInstance, { kind: 'coil' }>,
  _order: boolean,
): void {
  void _order
  // Top-level sinks always invoke generatePaths with order=false —
  // matches `body_emit.emitCoil` / `emitOutVariable` not threading the
  // sink's own eoid into computeExpression.  Order suppression only
  // applies inside block→block recursion (see `buildInputArgs`).
  const paths = generatePaths(state, coil.connections, false)
  if (paths.length === 0) {
    state.warnings.push(`Coil "${coil.variable}" must be connected.`)
    return
  }
  const expr = pathsToChunks(paths)
  const coilInfo: Location = [state.tagName, 'coil', coil.localId]
  const modified = extractModifier(state, coil.modifier, expr, coilInfo)
  state.program.push([state.currentIndent, []])
  state.program.push([coil.variable, [...coilInfo, 'reference']])
  state.program.push([' := ', []])
  state.program.push(...modified)
  state.program.push([';\n', []])
}

function emitOutVariable(
  state: WalkerState,
  ov: Extract<LdInstance, { kind: 'outVariable' }>,
  _order: boolean,
): void {
  void _order
  const paths = generatePaths(state, ov.connections, false)
  if (paths.length === 0) return
  const expr = pathsToChunks(paths)
  const info: Location = [state.tagName, 'io_variable', ov.localId, 'expression']

  // ENO gating — wrap the assignment in `IF <eno> THEN ... END_IF;`
  // when the upstream block has its EN input wired (mirrors
  // PLCGenerator.py:1243 `GetUsedEno`).
  const enoVar = getUsedEno(state, ov.connections)
  if (enoVar !== null) {
    state.program.push([`${state.currentIndent}IF ${enoVar}`, []])
    state.program.push([' THEN\n  ', []])
    state.currentIndent += '  '
  }

  state.program.push([state.currentIndent, []])
  state.program.push([ov.expression, info])
  state.program.push([' := ', []])
  state.program.push(...expr)
  state.program.push([';\n', []])

  if (enoVar !== null) {
    state.currentIndent = state.currentIndent.slice(0, -2)
    state.program.push([`${state.currentIndent}END_IF;\n`, []])
  }
}

/**
 * If the single upstream connection of an outVariable points at a
 * block with an `EN` input wired, return the `ENO` reference that
 * gates downstream assignment.  Mirrors PLCGenerator.py:1243.
 */
function getUsedEno(state: WalkerState, connections: readonly Connection[]): string | null {
  if (connections.length !== 1) return null
  const next = state.byId.get(connections[0].refLocalId)
  if (!next || next.kind !== 'block') return null
  for (const input of next.inputs) {
    if (input.formalParameter !== 'EN') continue
    if (input.connections.length === 0) return null
    if (next.instanceName !== undefined) {
      return `${next.instanceName}.ENO`
    }
    return `_TMP_${next.typeName}${next.localId}_ENO`
  }
  return null
}

function emitInOutVariable(
  state: WalkerState,
  iov: Extract<LdInstance, { kind: 'inOutVariable' }>,
  _order: boolean,
): void {
  void _order
  const paths = generatePaths(state, iov.connections, false)
  if (paths.length === 0) return
  const expr = pathsToChunks(paths)
  const info: Location = [state.tagName, 'io_variable', iov.localId, 'expression']
  state.program.push([state.currentIndent, []])
  state.program.push([iov.expression, info])
  state.program.push([' := ', []])
  state.program.push(...expr)
  state.program.push([';\n', []])
}

function emitStandaloneBlockCall(
  state: WalkerState,
  blk: Extract<LdInstance, { kind: 'block' }>,
  _order: boolean,
): void {
  void _order
  // A block reached via the body iteration is unconditionally emitted
  // (idempotent via emittedBlocks).  This is the hook that lets
  // cascaded blocks emit in their iteration order even when their
  // outputs feed downstream consumers.
  if (blk.instanceName !== undefined) {
    emitFunctionBlockCall(state, blk)
  } else {
    emitFunctionCall(state, blk)
  }
}

/* ─────────────────────────── generatePaths (LD walk) ────────────────────── */

/**
 * Walk backward from a set of `Connection`s through the LD graph,
 * building a `PathNode[]` (lists for series, tuples for parallels).
 * Mirrors `src/PLCGenerator/path_tree.ts:generatePaths`.
 */
export function generatePaths(
  state: WalkerState,
  connections: readonly Connection[],
  order = false,
): PathNode[] {
  const paths: PathNode[] = []
  for (const conn of connections) {
    const next = state.byId.get(conn.refLocalId)
    if (!next) continue
    const node = visit(state, next, conn, order)
    if (node !== undefined) paths.push(node)
  }
  return paths
}

function visit(
  state: WalkerState,
  inst: LdInstance,
  conn: Connection,
  order: boolean,
): PathNode | undefined {
  switch (inst.kind) {
    case 'leftPowerRail':
      return TRUE_NODE

    case 'inVariable':
    case 'inOutVariable':
      return leafNode([
        [
          inst.expression,
          [state.tagName, 'io_variable', inst.localId, 'expression'],
        ],
      ])

    case 'block':
      return visitBlockOutput(state, inst, conn, order)

    case 'contact':
      return visitContact(state, inst, order)

    case 'coil': {
      // In LD, a coil's wire passes THROUGH it — downstream nodes
      // (a block input wired to the same signal that drives this
      // coil) can tap off it.  Walk back through `inst.connections`
      // to find whatever drives the coil and return that as the
      // path.  Mirrors `path_tree.ts:Coil` branch (PLCGenerator.py).
      const upstream = generatePaths(state, inst.connections, order)
      if (upstream.length === 0) return undefined
      if (upstream.length === 1) return upstream[0]
      const factored = factorizePaths(upstream)
      if (factored.length === 1) return factored[0]
      return { kind: 'or', children: factored }
    }

    case 'continuation': {
      // Look up the cached connector expression by name.  If the
      // matching connector hasn't been iterated yet, attempt to
      // resolve it eagerly so the continuation can produce a value
      // even when the connector appears later in iteration order.
      const cached = state.connectorExprs.get(inst.name)
      if (cached) return leafNode([...cached])
      const connector = findConnectorByName(state, inst.name)
      if (connector) {
        emitConnector(state, connector)
        const resolved = state.connectorExprs.get(inst.name)
        if (resolved) return leafNode([...resolved])
      }
      state.warnings.push(`continuation "${inst.name}" has no matching connector`)
      return undefined
    }

    case 'connector':
    case 'rightPowerRail':
    case 'outVariable':
      return undefined
  }
}

function findConnectorByName(
  state: WalkerState,
  name: string,
): Extract<LdInstance, { kind: 'connector' }> | null {
  for (const inst of state.body.instances) {
    if (inst.kind === 'connector' && inst.name === name) return inst
  }
  return null
}

function visitContact(
  state: WalkerState,
  inst: Extract<LdInstance, { kind: 'contact' }>,
  order: boolean,
): PathNode {
  const contactInfo: Location = [state.tagName, 'contact', inst.localId]
  const variableChunks: ProgramChunk[] = [
    [inst.variable, [...contactInfo, 'reference']],
  ]
  const variableLeaf = leafNode(extractModifier(state, inst.modifier, variableChunks, contactInfo))

  const upstream = generatePaths(state, inst.connections, order)
  if (upstream.length === 0) {
    state.warnings.push(`Contact "${inst.variable}" must be connected.`)
    return variableLeaf
  }
  if (upstream.length === 1) {
    const only = upstream[0]
    if (only.kind === 'true') return variableLeaf
    if (only.kind === 'and') {
      return { kind: 'and', children: [variableLeaf, ...only.children] }
    }
    return { kind: 'and', children: [variableLeaf, only] }
  }
  const factored = factorizePaths(upstream)
  if (factored.length > 1) {
    return {
      kind: 'and',
      children: [variableLeaf, { kind: 'or', children: factored }],
    }
  }
  const tail = factored[0]
  const tailChildren = tail.kind === 'and' ? tail.children : [tail]
  return { kind: 'and', children: [variableLeaf, ...tailChildren] }
}

/* ─────────────────────────── block emission ─────────────────────────────── */

/**
 * Build the chunk sequence for one block-output read.  Side effect:
 * emits the block call statement into `state.program` if not yet
 * emitted (function-block path) or pre-computes the temp var
 * assignment (function path).
 *
 * Returns the leaf naming `instance.formalParameter` (e.g.
 * `TON0.Q`) for FBs or `_TMP_<type><localId>_<out>` for functions.
 */
function visitBlockOutput(
  state: WalkerState,
  block: Extract<LdInstance, { kind: 'block' }>,
  conn: Connection,
  order: boolean,
): PathNode {
  const isFunction = block.instanceName === undefined
  if (isFunction) {
    const out = conn.refFormalParameter ?? block.outputs[0]?.formalParameter ?? 'OUT'
    // When walking from an ordered sink, suppress eager emission —
    // the upstream block emits at its own iteration step (and
    // registers its temps then).  Otherwise emit now (idempotent
    // via `emittedBlocks`).
    if (!order) emitFunctionCall(state, block)
    const tempName = `_TMP_${block.typeName}${block.localId}_${out}`
    return leafNode([
      [tempName, [state.tagName, 'block', block.localId, 'output', out]],
    ])
  }
  if (!order) emitFunctionBlockCall(state, block)
  const instName = block.instanceName!
  const out = conn.refFormalParameter ?? block.outputs[0]?.formalParameter ?? 'OUT'
  return leafNode([
    [`${instName}.${out}`, [state.tagName, 'block', block.localId, 'output', out]],
  ])
}

/**
 * Function-block path: emit `instance(IN := …, PT := …);` once per
 * block (idempotent across multiple output reads).  Downstream
 * readers access outputs as `instance.<output>`.
 */
function emitFunctionBlockCall(
  state: WalkerState,
  block: Extract<LdInstance, { kind: 'block' }>,
): void {
  if (state.emittedBlocks.has(block.localId)) return
  state.emittedBlocks.add(block.localId)

  const instName = block.instanceName!
  const info: Location = [state.tagName, 'block', block.localId]
  const parts = buildInputArgs(state, block)

  state.program.push([state.currentIndent, []])
  state.program.push([instName, [...info, 'instance']])
  state.program.push(['(', []])
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) state.program.push([', ', []])
    state.program.push(...parts[i])
  }
  state.program.push([');\n', []])
}

/**
 * Function path: emit
 *
 *     _TMP_<type><localId>_<OUT> := <typeName>(arg1, arg2, …);
 *
 * — once per block (dedup via `emittedBlocks`).  Mirrors python's
 * `generateBlock` function branch (PLCGenerator.py:1494-1644; TS
 * reference `xml-to-st/src/PLCGenerator/path_tree.ts:606-826`).
 *
 * **Argument syntax** — named (`PARAM := expr`) when the block has
 * more than one declared output OR not every declared input is
 * wired; positional otherwise.  Two-output functions (with `ENO`)
 * are the common driver of named-arg form.
 *
 * **Outputs** — every declared output gets a synthesised
 * `_TMP_<typeName><localId>_<formalParameter>` temp, registered in
 * `state.functionTempVars` so the driver can append them to the
 * POU's VAR section.  Among the registered temps, the "primary"
 * output (empty formal parameter, or `OUT`, or a single output) is
 * placed on the LHS of the call; other outputs (notably `ENO`) are
 * passed as extra `param => tempName` named args inside the call.
 */
function emitFunctionCall(
  state: WalkerState,
  block: Extract<LdInstance, { kind: 'block' }>,
): void {
  if (state.emittedBlocks.has(block.localId)) return
  state.emittedBlocks.add(block.localId)

  const info: Location = [state.tagName, 'block', block.localId]
  const allInputConnected = block.inputs.every(
    (inp) => inp.connections.length > 0,
  )
  const useNamedArgs = block.outputs.length > 1 || !allInputConnected

  // Build input arg parts.
  const recurseOrdered =
    'executionOrderId' in block && (block.executionOrderId ?? 0) > 0
  const parts: ProgramChunk[][] = []
  for (const input of block.inputs) {
    const upstream = generatePaths(state, input.connections, recurseOrdered)
    if (upstream.length === 0) continue
    const inputExpr = pathsToChunks(upstream)
    if (useNamedArgs) {
      parts.push([[`${input.formalParameter} := `, []], ...inputExpr])
    } else {
      parts.push(inputExpr)
    }
  }

  // Register every output's temp var; pick the primary; append
  // non-primary outputs as `param => tempName` extras to `parts`.
  let primaryName: string | null = null
  let primaryFormal = ''
  let primaryIdx = 0
  for (let i = 0; i < block.outputs.length; i++) {
    const out = block.outputs[i]
    const tempName = `_TMP_${block.typeName}${block.localId}_${out.formalParameter}`
    const tempType = out.formalParameter === 'ENO' ? 'BOOL' : 'ANY'
    state.functionTempVars.push({
      name: tempName,
      type: tempType,
      originBlockTypeName: block.typeName,
      originFormalParameter: out.formalParameter,
    })
    const isPrimary =
      block.outputs.length === 1 ||
      out.formalParameter === '' ||
      out.formalParameter === 'OUT'
    if (isPrimary && primaryName === null) {
      primaryName = tempName
      primaryFormal = out.formalParameter
      primaryIdx = i
    } else {
      parts.push([
        [out.formalParameter, [...info, 'output', i]],
        [` => ${tempName}`, []],
      ])
    }
  }

  // No primary output → nothing meaningful to emit.  Corpus never
  // triggers this (standard functions always have `OUT` or unnamed).
  if (primaryName === null) return

  state.program.push([state.currentIndent, []])
  state.program.push([primaryName, [...info, 'output', primaryIdx]])
  state.program.push([' := ', []])
  state.program.push([block.typeName, [...info, 'type']])
  state.program.push(['(', []])
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) state.program.push([', ', []])
    state.program.push(...parts[i])
  }
  state.program.push([');\n', []])
  void primaryFormal
}

/** Build `IN := upstream_expr` chunks for every wired input on a
 *  function-block instance.  Used by `emitFunctionBlockCall`.
 *  `recurseOrdered` is true when the block's own executionOrderId
 *  is > 0 — propagated to upstream walks so cascaded ordered blocks
 *  don't eagerly emit each other. */
function buildInputArgs(
  state: WalkerState,
  block: Extract<LdInstance, { kind: 'block' }>,
): ProgramChunk[][] {
  const recurseOrdered =
    'executionOrderId' in block && (block.executionOrderId ?? 0) > 0
  const parts: ProgramChunk[][] = []
  for (const input of block.inputs) {
    const upstream = generatePaths(state, input.connections, recurseOrdered)
    if (upstream.length === 0) continue
    const inputExpr = pathsToChunks(upstream)
    const chunk: ProgramChunk[] = [[`${input.formalParameter} := `, []]]
    chunk.push(...inputExpr)
    parts.push(chunk)
  }
  return parts
}


/* ─────────────────────────── helpers ────────────────────────────────────── */

function pathsToChunks(paths: PathNode[]): ProgramChunk[] {
  if (paths.length === 0) return [['TRUE', []]]
  if (paths.length === 1) return computePaths(paths[0], /*first=*/ true)
  const factored = factorizePaths(paths)
  if (factored.length === 1) return computePaths(factored[0], /*first=*/ true)
  return computePaths({ kind: 'or', children: factored }, /*first=*/ true)
}
