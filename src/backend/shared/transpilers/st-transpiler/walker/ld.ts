/**
 * React Flow LD body → Structured Text.
 *
 * Walks `RFBody.rungs[*].nodes/edges` directly — no PLCOpen
 * intermediate.  Output must match the python oracle
 * byte-for-byte against the python oracle;
 * `tests/per_case.test.ts` is the per-case validation loop, and
 * `tests/golden_react_flow.test.ts` covers the larger harvested
 * corpus once it lands.
 *
 * Reuses the legacy LD walker's algorithmic primitives
 * (`path_tree`, `modifiers`) for boolean factorization and modifier
 * emission — those modules are PLCOpen-independent and don't pull
 * the `LdBody` IR in.  Only the topology traversal is rewritten to
 * read React Flow's `nodes`/`edges` directly.
 */

import { extractModifier } from '../core/modifiers'
import {
  computePaths,
  factorizePaths,
  leafNode,
  type Location,
  type PathNode,
  type ProgramChunk,
  TRUE_NODE,
} from '../core/path-tree'
import { resolveConversionFunctionName } from '../helpers/block-library'
import { computeConnectionTypes, pinOut, type TypeContext } from './connection-types'
import {
  asBlockData,
  asCoilData,
  asConnectorData,
  asContactData,
  asContinuationData,
  asParallelData,
  asPowerRailData,
  asVariableData,
  asVariableExpressionData,
  type BlockData,
  coilModifierFromVariant,
  contactModifierFromVariant,
  type VariableData,
} from './narrow'
import type { RFBody, RFEdge, RFNode, RFRung } from './types'

/**
 * A variable the walker synthesises during emission that the caller
 * must declare in the POU's trailing local `VAR` section.  Two
 * flavours flow through this shape:
 *   - Trigger instances (`R_TRIG1`, `F_TRIG1`, …) — `type` is
 *     already the resolved `'R_TRIG'`/`'F_TRIG'` name.
 *   - Function-call output temps (`_TMP_<typeName><numericId>_<param>`)
 *     — `type` is `'BOOL'` for `ENO`, otherwise the graph-inferred
 *     pin type from `connection-types.ts` (literal `'ANY'` when no
 *     concrete type reaches the pin, matching Python).
 */
export interface SyntheticVar {
  name: string
  type: string
}

export interface EmitResult {
  bodySt: string
  syntheticVars: SyntheticVar[]
  warnings: string[]
}

interface WalkerState {
  tagName: string
  byId: Map<string, RFNode>
  /** Edges keyed by their target node id. */
  incoming: Map<string, RFEdge[]>
  /** Outgoing edges keyed by source node id — used to detect
   *  standalone blocks (no consumer of any output). */
  outgoing: Map<string, RFEdge[]>
  program: ProgramChunk[]
  currentIndent: string
  declaredVars: Set<string>
  triggerVars: { name: string; type: 'R_TRIG' | 'F_TRIG' }[]
  /** `_TMP_<typeName><numericId>_<param>` temps synthesised by
   *  function-call emission.  Types come from the pre-computed
   *  connection-type inference (`'ANY'` terminal fallback). */
  functionTempVars: {
    name: string
    type: string
  }[]
  emittedBlocks: Set<string>
  /** Output-write sinks (coil / output / inOut variable) keyed by the
   *  block that feeds them — emitted right after the block's call so a
   *  downstream block reads the written value, not a stale one (#830). */
  consumersByBlock: Map<string, RFNode[]>
  /** Sinks already emitted — by block coupling or the main sweep — so
   *  the other path skips them. */
  emittedSinks: Set<string>
  /** Connector expressions cached by name, consumed by continuation
   *  visits later in the same rung (FBD-only). */
  connectorExprs: Map<string, ProgramChunk[]>
  /** Cumulative Y-offset per node id — mirrors how `ladder-xml.ts`
   *  globalises rung positions when it serialises React Flow into
   *  PLCOpen XML (each rung's `reactFlowViewport[1]` height adds to
   *  the running offset).  Used to position-sort sinks across rungs
   *  in the same coordinate space the python oracle sees. */
  yOffset: Map<string, number>
  warnings: string[]
  /** Pin types from computeConnectionTypes; empty without a TypeContext. */
  connTypes: Map<string, string>
}

function rungHeight(rung: RFRung): number {
  const vp = rung.reactFlowViewport
  if (Array.isArray(vp) && typeof vp[1] === 'number' && Number.isFinite(vp[1])) {
    return vp[1]
  }
  return 0
}

/**
 * Location-tuple identity for a React Flow node.  Prefers the editor-
 * assigned `data.numericId` (an integer, matching PLCOpen `@localId`)
 * over the React Flow UUID — `factorizePaths` sorts paths by the
 * stable `pythonReprNode` key, so the location bytes embedded in chunk
 * reprs decide tie-break order between sibling AND-paths.  The python
 * oracle sees `int` localIds; using the same integers here keeps our
 * sort byte-identical with it.  Falls back to `node.id` when a fixture
 * lacks `numericId` (per-case fixtures that don't need the integer
 * round-trip).
 */
function locId(node: RFNode): number | string {
  const raw = node.data['numericId']
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && String(parsed) === raw) return parsed
  }
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  return node.id
}

/**
 * True for any node that holds a variable reference — covers both
 * vocabularies the editor produces:
 *   - 'variable' with `data.variant` of 'input'/'output'/'inout' (LD
 *     bodies + the older FBD shape used by per-case fixtures)
 *   - 'input-variable' / 'output-variable' / 'inout-variable' (modern
 *     FBD bodies as harvested from real projects)
 */
function isVariableNode(node: RFNode): boolean {
  return (
    node.type === 'variable' ||
    node.type === 'input-variable' ||
    node.type === 'output-variable' ||
    node.type === 'inout-variable'
  )
}

/* ─────────────────────────── public entry ───────────────────────────────── */

export function emitLdBody(body: RFBody, typeContext?: TypeContext): EmitResult {
  // POU name doesn't influence body emission today (it's only the
  // first element of the `Location` tuples used for source-map back-
  // references).  Hard-code a sentinel; the orchestrator can pass a
  // real name when it wires this walker in.
  const tagName = 'P::main'
  const state: WalkerState = {
    tagName,
    byId: new Map(),
    incoming: new Map(),
    outgoing: new Map(),
    program: [],
    currentIndent: '  ',
    declaredVars: new Set(),
    triggerVars: [],
    functionTempVars: [],
    emittedBlocks: new Set(),
    consumersByBlock: new Map(),
    emittedSinks: new Set(),
    connectorExprs: new Map(),
    yOffset: new Map(),
    warnings: [],
    connTypes: typeContext ? computeConnectionTypes(body, typeContext) : new Map<string, string>(),
  }

  // Index every node + edge from every rung up front.  Sinks are then
  // collected and bucketed GLOBALLY (across all rungs) — the python
  // oracle iterates a flat instance list, so per-rung bucketing would
  // misorder cases where an ordered block (executionOrderId > 0) lives
  // in a later rung but must emit before unordered work earlier in the
  // body.  Each rung's local Y coords are shifted by the cumulative
  // viewport heights of earlier rungs (matches `ladder-xml.ts`:612).
  let cumulativeYOffset = 0
  for (const rung of body.rungs) {
    for (const node of rung.nodes) {
      if (state.byId.has(node.id)) {
        state.warnings.push(`duplicate node id "${node.id}" across rungs`)
      }
      state.byId.set(node.id, node)
      state.incoming.set(node.id, [])
      state.outgoing.set(node.id, [])
      state.yOffset.set(node.id, cumulativeYOffset)
    }
    for (const edge of rung.edges) {
      const targetBucket = state.incoming.get(edge.target)
      if (targetBucket !== undefined) targetBucket.push(edge)
      const sourceBucket = state.outgoing.get(edge.source)
      if (sourceBucket !== undefined) sourceBucket.push(edge)
    }
    cumulativeYOffset += rungHeight(rung)
  }

  // Collect sinks across the body.  A sink is any instance that
  // appears in the body iteration sweep (mirrors PLCGenerator.py's
  // generate-instances loop):
  //   - coils, outVariables, inOutVariables — write targets
  //   - blocks (idempotent via `emittedBlocks`; ensures cascaded
  //     blocks get their call site regardless of consumer chain)
  //   - connectors — cache their upstream expression for later
  //     continuation visits.
  //
  // Empty-name variables are dropped to match `ladder-xml.ts`:602, which
  // filters them out of the PLCOpen serialization the oracle consumes.
  // Those nodes represent dangling block outputs the user never wired
  // to a real variable.
  const sinks: RFNode[] = []
  for (const rung of body.rungs) {
    for (const node of rung.nodes) {
      if (node.type === 'coil') {
        if (asCoilData(node.data)?.variable) sinks.push(node)
      } else if (isVariableNode(node)) {
        const data = asVariableData(node.data)
        if (data === null || data.variable === '') continue
        if (data.variant === 'output' || data.variant === 'inout') sinks.push(node)
      } else if (node.type === 'block') {
        sinks.push(node)
      } else if (node.type === 'connector') {
        sinks.push(node)
      }
    }
  }

  // Bucket by executionOrderId: explicit > 0 emits first (sorted
  // ascending), zero/unset falls back to position sort (Y first
  // 10-unit tol, then X).  Mirrors `body_emit.ts` in the legacy
  // walker.  Walks launched from an ordered sink propagate
  // `order=true` so upstream blocks don't emit eagerly — they emit
  // at their own iteration step instead.
  const ordered: RFNode[] = []
  const others: RFNode[] = []
  for (const node of sinks) {
    if (nodeExecutionOrder(node) > 0) ordered.push(node)
    else others.push(node)
  }
  ordered.sort((a, b) => nodeExecutionOrder(a) - nodeExecutionOrder(b))
  others.sort((a, b) => compareNodePosition(state, a, b))

  // Index each block's output-write sinks (coils / output / inOut
  // variables fed solely by that block).  These are emitted right after
  // the block's call by `emitBlockConsumers` — wherever the call lands,
  // eager or lazy — and skipped in the sweep below.  Otherwise a block
  // numbered ahead of its output variable (write left at
  // executionOrderId 0) emits its call in the ordered pass while the
  // assignment waits for the unordered pass, so a later block in the
  // rung reads the variable before it is written (#830).
  for (const node of [...ordered, ...others]) {
    const blockId = blockFedSink(state, node)
    if (blockId === null) continue
    const list = state.consumersByBlock.get(blockId) ?? []
    list.push(node)
    state.consumersByBlock.set(blockId, list)
  }

  emitSinksWithCoilGrouping(state, ordered)
  emitSinksWithCoilGrouping(state, others)

  const bodySt = '\n' + state.program.map((c) => c[0]).join('')
  const syntheticVars: SyntheticVar[] = [
    ...state.triggerVars.map((t) => ({ name: t.name, type: t.type })),
    ...state.functionTempVars,
  ]
  return { bodySt, syntheticVars, warnings: state.warnings }
}

function nodeExecutionOrder(node: RFNode): number {
  if (node.type === 'coil') return asCoilData(node.data)?.executionOrder ?? 0
  if (node.type === 'block') return asBlockData(node.data)?.executionOrder ?? 0
  if (isVariableNode(node)) return asVariableData(node.data)?.executionOrder ?? 0
  return 0
}

function compareNodePosition(state: WalkerState, a: RFNode, b: RFNode): number {
  const aOff = state.yOffset.get(a.id) ?? 0
  const bOff = state.yOffset.get(b.id) ?? 0
  const ax = Math.trunc(a.position.x)
  const ay = Math.trunc(a.position.y + aOff)
  const bx = Math.trunc(b.position.x)
  const by = Math.trunc(b.position.y + bOff)
  if (Math.abs(ay - by) >= 10) return ay - by
  return ax - bx
}

/**
 * If `node` is an output-write sink (coil / output- or inOut-variable)
 * whose value comes solely from a single block, return that block's id.
 * Such a sink is the block's output binding — it must emit right after
 * the block's call so downstream blocks read the written value, not a
 * stale one (#830).  Returns null for anything else (multi-source
 * sinks, non-block sources, blocks, connectors).
 */
function blockFedSink(state: WalkerState, node: RFNode): string | null {
  if (node.type !== 'coil' && !isVariableNode(node)) return null
  const edges = state.incoming.get(node.id) ?? []
  // Only direct block->sink edges couple; sinks fed through a
  // passthrough node or with extra wires stay on the positional sweep.
  if (edges.length !== 1) return null
  const src = state.byId.get(edges[0].source)
  if (src === undefined || src.type !== 'block') return null
  return src.id
}

function emitSink(state: WalkerState, node: RFNode): void {
  // Top-level sink walks ALWAYS use order=false — the sink's own
  // executionOrderId doesn't propagate into its upstream walks
  // (mirrors body_emit.emitCoil / emitOutVariable in the legacy
  // walker).  Order suppression is purely a block→upstream-block
  // concern, applied inside `buildInputArgs` based on the emitting
  // block's eoid.
  if (node.type === 'coil') return emitCoilNode(state, node)
  if (isVariableNode(node)) {
    const data = asVariableData(node.data)
    if (data?.variant === 'output') return emitOutVariableNode(state, node, data)
    if (data?.variant === 'inout') return emitInOutVariableNode(state, node, data)
    return
  }
  if (node.type === 'block') return emitStandaloneBlock(state, node)
  if (node.type === 'connector') return emitConnectorNode(state, node)
}

/**
 * Emit sinks in order, collapsing SET/RESET coils that branch off the
 * SAME upstream source into a single `IF`.  Parallel coils share one
 * energization path, so the rung condition must be evaluated ONCE and
 * applied to every branch — emitting a separate `IF` per coil
 * re-evaluates the condition between assignments, which is wrong when
 * the condition reads a coil an earlier branch just set
 * (e.g. `IF NOT(coils1)... coils1 := TRUE`).
 *
 * Same-source coils are gathered even when they are NOT adjacent in
 * emission order: a coil fed by their merge (so it shares neither
 * source) can sort between two parallel branches by position, yet the
 * branches must still collapse into one `IF`.  The group is emitted at
 * the first branch's slot; the intervening sink (and any other
 * downstream work) follows after — which is also its dataflow order,
 * since a merge-fed sink is downstream of the branches it consumes.
 */
function emitSinksWithCoilGrouping(state: WalkerState, sinks: RFNode[]): void {
  for (let i = 0; i < sinks.length; i++) {
    if (state.emittedSinks.has(sinks[i].id)) continue
    const key = setResetCoilGroupKey(state, sinks[i])
    if (key === null) {
      state.emittedSinks.add(sinks[i].id)
      emitSink(state, sinks[i])
      continue
    }
    const group: RFNode[] = [sinks[i]]
    for (let j = i + 1; j < sinks.length; j++) {
      if (state.emittedSinks.has(sinks[j].id)) continue
      if (setResetCoilGroupKey(state, sinks[j]) === key) group.push(sinks[j])
    }
    for (const g of group) state.emittedSinks.add(g.id)
    if (group.length === 1) emitCoilNode(state, sinks[i])
    else emitCoilGroup(state, group)
  }
}

/**
 * Emit a block's output-write sinks (coils / output / inOut variables
 * fed solely by it) right after its call — wherever that call lands.
 * Reuses the coil-grouping sweep so parallel SET/RESET coils off the
 * same block still collapse into one `IF`.  Idempotent via
 * `state.emittedSinks`, so the main sweep skips what is emitted here.
 */
function emitBlockConsumers(state: WalkerState, blockId: string): void {
  const consumers = state.consumersByBlock.get(blockId)
  if (consumers === undefined) return
  emitSinksWithCoilGrouping(state, consumers)
}

/**
 * Group identity for a SET/RESET coil: the sorted set of its upstream
 * source node ids.  Two coils with the same key branch off the same
 * point (parallel rails) and therefore share a condition.  Returns
 * null for anything not groupable (non-coils, plain/negated/edge
 * coils, or an unconnected coil).
 */
function setResetCoilGroupKey(state: WalkerState, node: RFNode): string | null {
  if (node.type !== 'coil') return null
  const data = asCoilData(node.data)
  if (data === null || (data.variant !== 'set' && data.variant !== 'reset')) return null
  const sources = (state.incoming.get(node.id) ?? []).map((e) => e.source).sort()
  if (sources.length === 0) return null
  return sources.join('|')
}

/* ─────────────────────────── coil emission ──────────────────────────────── */

/**
 * Emit a group of parallel SET/RESET coils under one shared `IF`.
 * The condition is computed once from the first coil's upstream (all
 * coils in the group share it by construction), then each branch's
 * assignment is written inside the single `THEN` body.
 */
function emitCoilGroup(state: WalkerState, coils: RFNode[]): void {
  const first = coils[0]
  const paths = pathsFromIncoming(state, first.id, /*order=*/ false)
  if (paths.length === 0) {
    // Shared upstream resolved to nothing — fall back to per-coil
    // emission so each surfaces its own "must be connected" warning.
    for (const coil of coils) emitCoilNode(state, coil)
    return
  }
  const expr = pathsToChunks(paths)
  const firstData = asCoilData(first.data)
  const firstInfo: Location = [state.tagName, 'coil', locId(first)]

  state.program.push([`${state.currentIndent}IF `, [...firstInfo, firstData?.variant ?? 'set']])
  for (const chunk of expr) state.program.push(chunk)
  state.program.push([' THEN\n', []])

  const inner = state.currentIndent + '  '
  for (const coil of coils) {
    const data = asCoilData(coil.data)
    if (data === null) continue
    const storage = data.variant === 'reset' ? 'reset' : 'set'
    const value = storage === 'set' ? 'TRUE' : 'FALSE'
    const info: Location = [state.tagName, 'coil', locId(coil)]
    state.program.push([inner, []])
    state.program.push([data.variable, [...info, 'reference']])
    state.program.push([` := ${value}; (*${storage}*)\n`, []])
  }
  state.program.push([`${state.currentIndent}END_IF;\n`, []])
}

function emitCoilNode(state: WalkerState, node: RFNode): void {
  const data = asCoilData(node.data)
  if (data === null) {
    state.warnings.push(`coil node "${node.id}" has unrecognised data shape`)
    return
  }

  const paths = pathsFromIncoming(state, node.id, /*order=*/ false)
  if (paths.length === 0) {
    state.warnings.push(`Coil "${data.variable}" must be connected.`)
    return
  }
  const expr = pathsToChunks(paths)
  const coilInfo: Location = [state.tagName, 'coil', locId(node)]
  const modifier = coilModifierFromVariant(data.variant)
  const modified = extractModifier(state, modifier, expr, coilInfo)

  state.program.push([state.currentIndent, []])
  state.program.push([data.variable, [...coilInfo, 'reference']])
  state.program.push([' := ', []])
  for (const chunk of modified) state.program.push(chunk)
  state.program.push([';\n', []])
}

/* ─────────────────────────── outVariable emission ───────────────────────── */

function emitOutVariableNode(state: WalkerState, node: RFNode, data: VariableData): void {
  const paths = pathsFromIncoming(state, node.id, /*order=*/ false)
  if (paths.length === 0) {
    state.warnings.push(`outVariable "${data.variable}" must be connected.`)
    return
  }
  const expr = pathsToChunks(paths)
  const info: Location = [state.tagName, 'io_variable', locId(node), 'expression']

  // ENO gating — when the single upstream connection points at a
  // block with `EN` wired, wrap the assignment in
  // `IF <ENO_ref> THEN ... END_IF;`.  Mirrors PLCGenerator.py:1243
  // (`GetUsedEno`).
  const enoVar = getUsedEnoForNode(state, node.id)
  if (enoVar !== null) {
    state.program.push([`${state.currentIndent}IF ${enoVar}`, []])
    state.program.push([' THEN\n  ', []])
    state.currentIndent += '  '
  }

  state.program.push([state.currentIndent, []])
  state.program.push([data.variable, info])
  state.program.push([' := ', []])
  for (const chunk of expr) state.program.push(chunk)
  state.program.push([';\n', []])

  if (enoVar !== null) {
    state.currentIndent = state.currentIndent.slice(0, -2)
    state.program.push([`${state.currentIndent}END_IF;\n`, []])
  }
}

/**
 * If the only incoming edge to `nodeId` originates from a block that
 * has its `EN` input wired, return the ST reference of the matching
 * `ENO` output — `<instance>.ENO` for FB instances,
 * `_TMP_<typeName><numericId>_ENO` for functions.  Otherwise null.
 */
function getUsedEnoForNode(state: WalkerState, nodeId: string): string | null {
  const edges = state.incoming.get(nodeId) ?? []
  if (edges.length !== 1) return null
  const upstream = state.byId.get(edges[0].source)
  if (upstream === undefined || upstream.type !== 'block') return null
  const data = asBlockData(upstream.data)
  if (data === null) return null
  // Block has EN wired iff some incoming edge targets the EN handle.
  const blockIncoming = state.incoming.get(upstream.id) ?? []
  const enWired = blockIncoming.some((e) => e.targetHandle === 'EN')
  if (!enWired) return null
  if (data.blockKind === 'function-block-instance') {
    return `${data.instanceName}.ENO`
  }
  return `_TMP_${data.typeName}${data.numericId}_ENO`
}

/* ─────────────────────────── inOutVariable emission ────────────────────── */

function emitInOutVariableNode(state: WalkerState, node: RFNode, data: VariableData): void {
  const paths = pathsFromIncoming(state, node.id, /*order=*/ false)
  if (paths.length === 0) {
    state.warnings.push(`inOutVariable "${data.variable}" must be connected.`)
    return
  }
  const expr = pathsToChunks(paths)
  const info: Location = [state.tagName, 'io_variable', locId(node), 'expression']
  state.program.push([state.currentIndent, []])
  state.program.push([data.variable, info])
  state.program.push([' := ', []])
  for (const chunk of expr) state.program.push(chunk)
  state.program.push([';\n', []])
}

/**
 * Connector emission: walk the connector's single incoming edge,
 * cache the resulting expression chunks under the connector's name
 * for later continuation lookups.  No bytes emitted into
 * `state.program` — the continuation is what surfaces the cached
 * expression at its consumer's call site.
 */
function emitConnectorNode(state: WalkerState, node: RFNode): void {
  const data = asConnectorData(node.data)
  if (data === null) {
    state.warnings.push(`connector node "${node.id}" has unrecognised data shape`)
    return
  }
  if (state.connectorExprs.has(data.name)) return
  const paths = pathsFromIncoming(state, node.id, /*order=*/ false)
  if (paths.length === 0) return
  state.connectorExprs.set(data.name, pathsToChunks(paths))
}

/* ─────────────────────────── standalone block ───────────────────────────── */

function emitStandaloneBlock(state: WalkerState, node: RFNode): void {
  const data = asBlockData(node.data)
  if (data === null) {
    state.warnings.push(`block node "${node.id}" has unrecognised data shape`)
    return
  }
  if (data.blockKind === 'function-block-instance') {
    emitFunctionBlockCall(state, node, data)
  } else {
    emitFunctionCall(state, node, data)
  }
}

/* ─────────────────────────── upstream walk ──────────────────────────────── */

function pathsFromIncoming(state: WalkerState, nodeId: string, order: boolean): PathNode[] {
  const edges = state.incoming.get(nodeId) ?? []
  const out: PathNode[] = []
  for (const edge of edges) {
    const upstream = state.byId.get(edge.source)
    if (upstream === undefined) continue
    const node = visitUpstream(state, upstream, edge, order)
    if (node !== undefined) out.push(node)
  }
  return out
}

function visitUpstream(state: WalkerState, node: RFNode, edge: RFEdge, order: boolean): PathNode | undefined {
  switch (node.type) {
    case 'powerRail': {
      const data = asPowerRailData(node.data)
      // A left-rail upstream contributes "always-on" energization.
      // A right-rail upstream is never reached during a back-walk
      // (rails sink wires; they don't source them).
      if (data?.variant === 'left') return TRUE_NODE
      return undefined
    }
    case 'contact':
      return visitContact(state, node, order)
    case 'parallel':
      return visitParallel(state, node, order)
    case 'variable':
    case 'input-variable':
    case 'output-variable':
    case 'inout-variable':
      return visitVariable(state, node)
    case 'block':
      return visitBlockOutput(state, node, edge, order)
    case 'coil':
      // Coil-as-passthrough: editor topologies sometimes route a wire
      // past a coil to feed a downstream node.  Mirror legacy walker
      // behaviour: emit nothing for the coil, just propagate the
      // upstream signal.
      return visitCoilPassthrough(state, node, order)
    case 'continuation':
      return visitContinuation(state, node)
    case 'connector':
      // Connectors are sinks, never sources — skip when encountered
      // as an upstream during a back-walk.
      return undefined
    default:
      state.warnings.push(`unknown upstream node type "${node.type}"`)
      return undefined
  }
}

function visitContact(state: WalkerState, node: RFNode, order: boolean): PathNode {
  const data = asContactData(node.data)
  if (data === null) {
    state.warnings.push(`contact node "${node.id}" has unrecognised data shape`)
    return TRUE_NODE
  }
  const contactInfo: Location = [state.tagName, 'contact', locId(node)]
  const variableChunks: ProgramChunk[] = [[data.variable, [...contactInfo, 'reference']]]
  const modifier = contactModifierFromVariant(data.variant)
  const variableLeaf = leafNode(extractModifier(state, modifier, variableChunks, contactInfo))

  const upstream = pathsFromIncoming(state, node.id, order)
  if (upstream.length === 0) {
    state.warnings.push(`Contact "${data.variable}" must be connected.`)
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

function visitCoilPassthrough(state: WalkerState, node: RFNode, order: boolean): PathNode | undefined {
  const upstream = pathsFromIncoming(state, node.id, order)
  if (upstream.length === 0) return undefined
  if (upstream.length === 1) return upstream[0]
  const factored = factorizePaths(upstream)
  if (factored.length === 1) return factored[0]
  return { kind: 'or', children: factored }
}

/**
 * Parallel-marker nodes (open/close) are zero-cost pass-throughs in
 * the path-tree algebra.  Their job is purely topological: they let
 * React Flow express wire merges that the editor renders as parallel
 * rails.
 *
 *   - `close`: collect every incoming branch, factor common terms,
 *     return as a single `or` (or unwrapped child if only one).
 *   - `open`: collapse to its single upstream — the open marker
 *     itself doesn't contribute a term.
 */
function visitParallel(state: WalkerState, node: RFNode, order: boolean): PathNode | undefined {
  const data = asParallelData(node.data)
  if (data === null) {
    state.warnings.push(`parallel node "${node.id}" has unrecognised data shape`)
    return undefined
  }
  const paths = pathsFromIncoming(state, node.id, order)
  if (paths.length === 0) return undefined
  // Flatten nested OR children — when the editor chains close markers
  // to render a 3+ way merge (each close takes 2 inputs), the naive
  // recursion produces `((A OR B) OR C)`.  The python oracle has no
  // such intermediates and emits a flat `A OR B OR C`; the
  // factorize-then-stable-sort below relies on the OR being flat.
  const flat: PathNode[] = []
  for (const p of paths) {
    if (p.kind === 'or') flat.push(...p.children)
    else flat.push(p)
  }
  if (data.side === 'open') {
    // Open markers should have exactly one upstream wire; if multiple
    // arrive, fall back to OR-ing them so we surface the topology
    // weirdness rather than silently dropping branches.
    if (flat.length === 1) return flat[0]
    const factored = factorizePaths(flat)
    if (factored.length === 1) return factored[0]
    return { kind: 'or', children: factored }
  }
  // close
  if (flat.length === 1) return flat[0]
  const factored = factorizePaths(flat)
  if (factored.length === 1) return factored[0]
  return { kind: 'or', children: factored }
}

/**
 * Continuation visit: surface the connector expression cached
 * earlier under the same `name`.  If the matching connector hasn't
 * been visited yet (iteration order quirk), resolve it eagerly by
 * walking the connector's incoming edge now.
 */
function visitContinuation(state: WalkerState, node: RFNode): PathNode | undefined {
  const data = asContinuationData(node.data)
  if (data === null) {
    state.warnings.push(`continuation node "${node.id}" has unrecognised data shape`)
    return undefined
  }
  const cached = state.connectorExprs.get(data.name)
  if (cached !== undefined) return leafNode([...cached])
  const connector = findConnectorByName(state, data.name)
  if (connector !== undefined) {
    emitConnectorNode(state, connector)
    const resolved = state.connectorExprs.get(data.name)
    if (resolved !== undefined) return leafNode([...resolved])
  }
  state.warnings.push(`continuation "${data.name}" has no matching connector`)
  return undefined
}

function findConnectorByName(state: WalkerState, name: string): RFNode | undefined {
  for (const node of state.byId.values()) {
    if (node.type !== 'connector') continue
    if (asConnectorData(node.data)?.name === name) return node
  }
  return undefined
}

/**
 * A `variable` node — both inVariable (variant='input') and inOut-
 * Variable when read as an upstream — contributes its `expression`
 * (or fallback variable name) as a single leaf.
 */
function visitVariable(state: WalkerState, node: RFNode): PathNode | undefined {
  // Editor stores `data.variable.name` as the expression text; when
  // the body comes from a non-editor source (or older versions), a
  // dedicated `data.expression` field may be present instead.
  const expr = asVariableExpressionData(node.data)?.expression ?? asVariableData(node.data)?.variable
  if (expr === undefined || expr === '') return undefined
  return leafNode([[expr, [state.tagName, 'io_variable', locId(node), 'expression']]])
}

/* ─────────────────────────── block emission ─────────────────────────────── */

/**
 * One block-output read.  Emits the block-call statement on first
 * visit (idempotent via `emittedBlocks`) and returns a leaf naming
 * the requested output — `<instance>.<formal>` for FB instances or
 * `_TMP_<type><numericId>_<formal>` for functions.
 */
function visitBlockOutput(state: WalkerState, node: RFNode, edge: RFEdge, order: boolean): PathNode | undefined {
  const data = asBlockData(node.data)
  if (data === null) {
    state.warnings.push(`block node "${node.id}" has unrecognised data shape`)
    return undefined
  }
  const requestedOutput =
    typeof edge.sourceHandle === 'string' && edge.sourceHandle.length > 0
      ? edge.sourceHandle
      : (data.outputs[0] ?? 'OUT')

  // `order=true` suppresses eager emission: the upstream block emits
  // at its own iteration step instead.  Only emit now when walking
  // from an unordered sink (or the block hasn't been reached yet
  // and the consumer will need its call site).
  if (data.blockKind === 'function-block-instance') {
    if (!order) emitFunctionBlockCall(state, node, data)
    const out = requestedOutput
    return leafNode([[`${data.instanceName}.${out}`, [state.tagName, 'block', locId(node), 'output', out]]])
  }
  // function path
  if (!order) emitFunctionCall(state, node, data)
  const out = requestedOutput
  const tempName = `_TMP_${data.typeName}${data.numericId}_${out}`
  return leafNode([[tempName, [state.tagName, 'block', locId(node), 'output', out]]])
}

function emitFunctionBlockCall(state: WalkerState, node: RFNode, data: BlockData): void {
  if (state.emittedBlocks.has(node.id)) return
  state.emittedBlocks.add(node.id)

  // Block-input walks inherit the block's own ordering — when the
  // block carries an explicit executionOrderId, upstream blocks
  // emit at their own steps; otherwise they emit eagerly.
  const recurseOrdered = data.executionOrder > 0
  const info: Location = [state.tagName, 'block', locId(node)]
  const parts = buildInputArgs(state, node, data, /*useNamedArgs=*/ true, recurseOrdered)

  state.program.push([state.currentIndent, []])
  state.program.push([data.instanceName, [...info, 'instance']])
  state.program.push(['(', []])
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) state.program.push([', ', []])
    for (const chunk of parts[i]) state.program.push(chunk)
  }
  state.program.push([');\n', []])
  emitBlockConsumers(state, node.id)
}

function emitFunctionCall(state: WalkerState, node: RFNode, data: BlockData): void {
  if (state.emittedBlocks.has(node.id)) return
  state.emittedBlocks.add(node.id)

  const info: Location = [state.tagName, 'block', locId(node)]
  const wiredInputs = data.inputs.filter((name) => firstIncomingForHandle(state, node.id, name) !== undefined)
  // python only ever sees wired pins for extensible blocks (DIV-18)
  const allInputConnected = data.extensible || wiredInputs.length === data.inputs.length
  const useNamedArgs = data.outputs.length > 1 || !allInputConnected

  const recurseOrdered = data.executionOrder > 0
  const parts = buildInputArgs(state, node, data, useNamedArgs, recurseOrdered)

  // Pick the primary output — function emits `_TMP_<type><id>_<primary>
  // := <type>(...)` on the LHS; secondary outputs (e.g. `ENO`) tail
  // as `param => tempName` extras.
  let primaryName: string | null = null
  let primaryFormal = ''
  for (let i = 0; i < data.outputs.length; i++) {
    const out = data.outputs[i]
    const tempName = `_TMP_${data.typeName}${data.numericId}_${out}`
    const tempType = state.connTypes.get(pinOut(node.id, out)) ?? (out === 'ENO' ? 'BOOL' : 'ANY')
    state.functionTempVars.push({
      name: tempName,
      type: tempType,
    })
    const isPrimary = data.outputs.length === 1 || out === '' || out === 'OUT'
    if (isPrimary && primaryName === null) {
      primaryName = tempName
      primaryFormal = out
    } else {
      parts.push([
        [out, [...info, 'output', i]],
        [` => ${tempName}`, []],
      ])
    }
  }
  if (primaryName === null) return

  // Polymorphic IEC 61131-3 conversion blocks (`TO_INT`, `TO_UINT`,
  // `TO_REAL`, …) are placed with the generic shorthand as their type
  // name, but that shorthand isn't itself a real ST function — only
  // the fully qualified `<SRC>_TO_<DST>` family is (matiec/strucpp both
  // reject a bare `TO_INT(...)` call).  Resolve it here from whatever
  // is wired directly into the block's single input; leave the name
  // untouched when it can't be resolved (unconnected input, upstream
  // isn't a plain variable, or the source type has no defined
  // conversion to this destination) so an unresolvable case still
  // surfaces the same "undefined function" error it always did,
  // rather than silently emitting a different wrong name.
  const callName = resolveConversionCallName(state, node, data) ?? data.typeName

  state.program.push([state.currentIndent, []])
  state.program.push([primaryName, [...info, 'output', 0]])
  state.program.push([' := ', []])
  state.program.push([callName, [...info, 'type']])
  state.program.push(['(', []])
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) state.program.push([', ', []])
    for (const chunk of parts[i]) state.program.push(chunk)
  }
  state.program.push([');\n', []])
  void primaryFormal
  emitBlockConsumers(state, node.id)
}

function buildInputArgs(
  state: WalkerState,
  node: RFNode,
  data: BlockData,
  useNamedArgs: boolean,
  order: boolean,
): ProgramChunk[][] {
  const parts: ProgramChunk[][] = []
  for (const inputName of data.inputs) {
    if (data.extensible) {
      // Extensible inputs: the editor's XML serializer (`fbd-xml.ts`:67)
      // emits one `<variable formalParameter="<name>">` per edge that
      // targets this handle.  The python oracle then puts the
      // serialized list through a dict keyed on the formal parameter
      // (`PLCGenerator.py`:1498) — duplicates overwrite, so all
      // occurrences of the same name resolve to the LAST connected
      // edge's upstream.  Mimic that here: emit one arg per edge, all
      // using the shared "last edge" upstream's expression.
      const edges = edgesForBlockInput(state, node.id, inputName)
      if (edges.length === 0) continue
      const lastEdge = edges[edges.length - 1]
      const lastUpstream = state.byId.get(lastEdge.source)
      if (lastUpstream === undefined) continue
      const sharedPath = visitUpstream(state, lastUpstream, lastEdge, order)
      if (sharedPath === undefined) continue
      const sharedExpr = pathsToChunks([sharedPath])
      for (let i = 0; i < edges.length; i++) {
        if (useNamedArgs) {
          const chunk: ProgramChunk[] = [[`${inputName} := `, []]]
          for (const c of sharedExpr) chunk.push(c)
          parts.push(chunk)
        } else {
          parts.push([...sharedExpr])
        }
      }
      continue
    }
    const upstreamPaths = pathsForBlockInput(state, node.id, inputName, order)
    if (upstreamPaths.length === 0) continue
    const inputExpr = pathsToChunks(upstreamPaths)
    if (useNamedArgs) {
      const chunk: ProgramChunk[] = [[`${inputName} := `, []]]
      for (const c of inputExpr) chunk.push(c)
      parts.push(chunk)
    } else {
      parts.push([...inputExpr])
    }
  }
  return parts
}

function edgesForBlockInput(state: WalkerState, blockId: string, inputName: string): RFEdge[] {
  const incoming = state.incoming.get(blockId) ?? []
  return incoming.filter((e) => e.targetHandle === inputName)
}

function pathsForBlockInput(state: WalkerState, blockId: string, inputName: string, order: boolean): PathNode[] {
  const incoming = state.incoming.get(blockId) ?? []
  const out: PathNode[] = []
  for (const edge of incoming) {
    if (edge.targetHandle !== inputName) continue
    const upstream = state.byId.get(edge.source)
    if (upstream === undefined) continue
    const node = visitUpstream(state, upstream, edge, order)
    if (node !== undefined) out.push(node)
  }
  return out
}

function firstIncomingForHandle(state: WalkerState, blockId: string, handle: string): RFEdge | undefined {
  const incoming = state.incoming.get(blockId) ?? []
  for (const edge of incoming) {
    if (edge.targetHandle === handle) return edge
  }
  return undefined
}

/**
 * Resolve a polymorphic `TO_<TYPE>` block's concrete ST call name
 * (e.g. `REAL_TO_INT`) from the inferred type of whatever is wired into
 * its single input. Returns `null` for anything that
 * isn't a `TO_<TYPE>` block, has zero or more than one formal input
 * (every supported conversion function takes exactly one),
 * an unconnected upstream, or a source type with no supported conversion.
 */
function resolveConversionCallName(state: WalkerState, node: RFNode, data: BlockData): string | null {
  if (data.inputs.length !== 1) return null
  const edge = firstIncomingForHandle(state, node.id, data.inputs[0])
  if (edge === undefined) return null
  const upstream = state.byId.get(edge.source)
  if (upstream === undefined) return null
  const sourcePin = upstream.type === 'block' ? pinOut(edge.source, edge.sourceHandle ?? '') : pinOut(edge.source)
  const sourceType = state.connTypes.get(sourcePin)
  if (sourceType === undefined) return null
  return resolveConversionFunctionName(data.typeName, sourceType)
}

/* ─────────────────────────── helpers ────────────────────────────────────── */

function pathsToChunks(paths: PathNode[]): ProgramChunk[] {
  if (paths.length === 0) return [['TRUE', []]]
  if (paths.length === 1) return computePaths(paths[0], /*first=*/ true)
  const factored = factorizePaths(paths)
  if (factored.length === 1) return computePaths(factored[0], /*first=*/ true)
  return computePaths({ kind: 'or', children: factored }, /*first=*/ true)
}
