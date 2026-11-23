import { getNumber, getRecord, getString, isRecord } from './node-data'

/** A node as the sink order reads it; structural, so the store's xyflow nodes and the walker's nodes both fit. */
export interface LdOrderNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: unknown
}

/** A rung as the sink order reads it: its nodes and its stored `[width, height]` viewport. */
export interface LdOrderRung<N extends LdOrderNode = LdOrderNode> {
  nodes: readonly N[]
  reactFlowViewport?: unknown
}

/** The sinks of a POU body: execution order > 0 ascending, then the rest by position, each list in emission order. */
export interface LdSinkBuckets<N extends LdOrderNode> {
  ordered: N[]
  others: N[]
}

const VARIABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'variable',
  'input-variable',
  'output-variable',
  'inout-variable',
])
const COIL_VARIANTS: ReadonlySet<string> = new Set(['default', 'negated', 'risingEdge', 'fallingEdge', 'set', 'reset'])
const VARIABLE_VARIANTS: ReadonlySet<string> = new Set([
  'input',
  'input-variable',
  'output',
  'output-variable',
  'inout',
  'inout-variable',
])
const WRITE_VARIABLE_VARIANTS: ReadonlySet<string> = new Set(['output', 'output-variable', 'inout', 'inout-variable'])
const POSITION_BAND = 10

/** True for a node holding a variable reference, in the LD (`variable`) or the FBD (`*-variable`) vocabulary. */
export function isLdVariableNode(node: { type?: string }): boolean {
  return node.type !== undefined && VARIABLE_NODE_TYPES.has(node.type)
}

function dataOf(node: LdOrderNode): Record<string, unknown> | undefined {
  return isRecord(node.data) ? node.data : undefined
}

/** A field holding a plain object; arrays do not count. */
function objectField(data: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = getRecord(data, key)
  return value === undefined || Array.isArray(value) ? undefined : value
}

/** `data.variable.name`, or an empty string when it is missing. */
function variableName(data: Record<string, unknown> | undefined): string {
  return getString(objectField(data, 'variable'), 'name') ?? ''
}

/** `data.executionOrder` when it is a finite number, otherwise 0. */
function executionOrderField(data: Record<string, unknown> | undefined): number {
  const value = getNumber(data, 'executionOrder')
  return value !== undefined && Number.isFinite(value) ? value : 0
}

/** True for a node the walker emits as a statement: a named coil, a named output or in-out variable, a block, a connector. */
function isLdSink(node: LdOrderNode): boolean {
  const data = dataOf(node)
  if (node.type === 'coil') return COIL_VARIANTS.has(getString(data, 'variant') ?? '') && variableName(data) !== ''
  if (isLdVariableNode(node)) {
    return WRITE_VARIABLE_VARIANTS.has(getString(data, 'variant') ?? '') && variableName(data) !== ''
  }
  return node.type === 'block' || node.type === 'connector'
}

/** The execution order of a coil, block or variable node with a recognised data shape; 0 for anything else. */
function ldExecutionOrder(node: LdOrderNode): number {
  const data = dataOf(node)
  if (node.type === 'coil') return COIL_VARIANTS.has(getString(data, 'variant') ?? '') ? executionOrderField(data) : 0
  if (node.type === 'block') {
    return getString(objectField(data, 'variant'), 'name') !== undefined ? executionOrderField(data) : 0
  }
  if (isLdVariableNode(node)) {
    return VARIABLE_VARIANTS.has(getString(data, 'variant') ?? '') ? executionOrderField(data) : 0
  }
  return 0
}

/** The height stored in a rung viewport (`[width, height]`), or 0 when it is missing or not finite. */
function rungHeight(viewport: unknown): number {
  const height: unknown = Array.isArray(viewport) ? viewport[1] : undefined
  return typeof height === 'number' && Number.isFinite(height) ? height : 0
}

/** Cumulative Y offset per node id: each rung adds its reactFlowViewport[1] (0 when missing or not finite). */
export function ldRungYOffsets(rungs: readonly LdOrderRung[]): ReadonlyMap<string, number> {
  const offsets = new Map<string, number>()
  let cumulative = 0
  for (const rung of rungs) {
    for (const node of rung.nodes) offsets.set(node.id, cumulative)
    cumulative += rungHeight(rung.reactFlowViewport)
  }
  return offsets
}

/** The walker's comparator for unordered sinks: truncated Y (+ offset) first unless within 10 units, then truncated X. */
export function compareLdNodePosition(a: LdOrderNode, b: LdOrderNode, yOffset: ReadonlyMap<string, number>): number {
  const ax = Math.trunc(a.position.x)
  const ay = Math.trunc(a.position.y + (yOffset.get(a.id) ?? 0))
  const bx = Math.trunc(b.position.x)
  const by = Math.trunc(b.position.y + (yOffset.get(b.id) ?? 0))
  if (Math.abs(ay - by) >= POSITION_BAND) return ay - by
  return ax - bx
}

/**
 * The sinks of a POU body in the walker's emission order, split into its two passes. Sinks are collected in rung order
 * then node array order; those with execution order > 0 are sorted by it, the rest with compareLdNodePosition.
 */
export function ldSinkBuckets<N extends LdOrderNode>(rungs: readonly LdOrderRung<N>[]): LdSinkBuckets<N> {
  const ordered: N[] = []
  const others: N[] = []
  for (const rung of rungs) {
    for (const node of rung.nodes) {
      if (!isLdSink(node)) continue
      if (ldExecutionOrder(node) > 0) ordered.push(node)
      else others.push(node)
    }
  }
  const yOffset = ldRungYOffsets(rungs)
  ordered.sort((a, b) => ldExecutionOrder(a) - ldExecutionOrder(b))
  others.sort((a, b) => compareLdNodePosition(a, b, yOffset))
  return { ordered, others }
}

/**
 * Ids of a POU body's sinks in the walker's emission order: execution order > 0 ascending first, then the rest sorted
 * with compareLdNodePosition, starting from rung order then node array order.
 */
export function ldSinkOrder(rungs: readonly LdOrderRung[]): readonly string[] {
  const { ordered, others } = ldSinkBuckets(rungs)
  return [...ordered, ...others].map((node) => node.id)
}
