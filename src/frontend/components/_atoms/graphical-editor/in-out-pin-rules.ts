/**
 * Rules that follow from a `VAR_IN_OUT` parameter being a single, by-reference pin.
 *
 * Two of them matter to a diagram:
 *  - an in-out pin accepts exactly ONE variable, because a second wire would alias the same
 *    parameter twice with no defined order (CODESYS: "The 'X' pin internally contains more
 *    than one associated connection. This is not allowed.");
 *  - nothing may read the pin back out. The block writes THROUGH the reference, so the
 *    caller's own variable already holds the result — which is why a wire that used to leave
 *    an in-out pin can be re-pointed at whatever feeds the pin without changing behaviour.
 */
import type { PLCVariable } from '../../../../middleware/shared/ports/types'

/**
 * Which side of a block a parameter appears on.
 *
 * A `VAR_IN_OUT` parameter is a SINGLE pin on the INPUT side, the way CODESYS draws it (with a
 * ⟷ marker over the pin). It used to get a pin on both sides, which let a diagram read the
 * value back out of the block — something CODESYS rejects outright ("No external access to
 * VAR_IN_OUT parameter"), because an in-out is passed by reference and the block's copy IS the
 * caller's variable.
 *
 * Nothing is lost by dropping the output pin: the compiler already emits the copy-out from the
 * input-side connection alone, so a call still generates
 * `FB.PARAM = VAR;  FB();  VAR = FB.PARAM;` exactly as before.
 *
 * These helpers are the single source of truth for that rule — pin geometry, pin labels, the
 * generated XML and the connection checks all derive from them, so the two sides cannot drift.
 */
type BlockParameter = { name: string; class: string }

export const blockInputVariables = <T extends BlockParameter>(variables: T[]): T[] =>
  variables.filter((variable) => variable.class === 'input' || variable.class === 'inOut')

export const blockOutputVariables = <T extends BlockParameter>(variables: T[]): T[] =>
  variables.filter((variable) => variable.class === 'output')

/** Names of a block's `VAR_IN_OUT` parameters, for the pin marker and the connection checks. */
export const inOutVariableNames = <T extends BlockParameter>(variables: T[]): Set<string> =>
  new Set(variables.filter((variable) => variable.class === 'inOut').map((variable) => variable.name))

/** A pin as the editors persist it inside a node's `data`. */
interface HandleLike {
  id: string
  type: string
  glbPosition?: { x: number; y: number }
  relPosition?: { x: number; y: number }
  style?: Record<string, number>
}

/** The minimum a node has to look like for these rules to apply. */
interface BlockLikeNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: {
    variant?: { variables?: { name: string; class: string }[] }
    handles?: HandleLike[]
    inputHandles?: HandleLike[]
    outputHandles?: HandleLike[]
    outputConnector?: HandleLike
  }
}

/** Vertical placement of a block's pins, which differs between FBD and Ladder. */
export interface PinGeometry {
  connectorY: number
  connectorOffsetY: number
}
interface EdgeLike {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}
interface GraphLike {
  nodes: BlockLikeNode[]
  edges: EdgeLike[]
}

const inOutPinsOf = (node: BlockLikeNode | undefined): Set<string> =>
  new Set(
    (node?.type === 'block' ? (node.data.variant?.variables ?? []) : [])
      .filter((variable) => variable.class === 'inOut')
      .map((variable) => variable.name),
  )

/**
 * The in-out pin this connection would overfill, or undefined when the connection is fine.
 * Returns the pin NAME so the caller can name it in the message.
 */
export const findOccupiedInOutPin = (
  connection: { target?: string | null; targetHandle?: string | null },
  graph: GraphLike,
): string | undefined => {
  const { target, targetHandle } = connection
  if (!target || !targetHandle) return undefined

  const targetNode = graph.nodes.find((node) => node.id === target)
  if (!inOutPinsOf(targetNode).has(targetHandle)) return undefined

  const alreadyWired = graph.edges.some((edge) => edge.target === target && edge.targetHandle === targetHandle)
  return alreadyWired ? targetHandle : undefined
}

/**
 * Re-point every wire that LEAVES an in-out pin at whatever feeds that pin.
 *
 * Projects saved before the in-out pin became input-only can contain such wires — the
 * Irrigation Controller's `main` reads `Irrigation_Main_Controller.State` into two other
 * blocks. The read is equivalent to reading the variable connected to the pin (the block
 * wrote through the reference), so re-pointing keeps the diagram and the generated code
 * behaving exactly as before instead of silently dropping the wire.
 *
 * A wire whose in-out pin has nothing feeding it cannot be salvaged and is dropped; the
 * count comes back so the caller can say so.
 */
export const migrateInOutSourceEdges = <E extends EdgeLike>(
  nodes: BlockLikeNode[],
  edges: E[],
): { edges: E[]; rewired: number; dropped: number } => {
  const inOutByNode = new Map<string, Set<string>>()
  for (const node of nodes) {
    const pins = inOutPinsOf(node)
    if (pins.size > 0) inOutByNode.set(node.id, pins)
  }
  if (inOutByNode.size === 0) return { edges, rewired: 0, dropped: 0 }

  const leavesInOutPin = (edge: EdgeLike): boolean =>
    !!edge.sourceHandle && !!inOutByNode.get(edge.source)?.has(edge.sourceHandle)

  if (!edges.some(leavesInOutPin)) return { edges, rewired: 0, dropped: 0 }

  // What feeds each in-out pin: node id -> pin name -> the wire's source.
  const feed = new Map<string, Map<string, { source: string; sourceHandle?: string | null }>>()
  for (const edge of edges) {
    if (!edge.targetHandle || !inOutByNode.get(edge.target)?.has(edge.targetHandle)) continue
    const pins = feed.get(edge.target) ?? new Map()
    pins.set(edge.targetHandle, { source: edge.source, sourceHandle: edge.sourceHandle })
    feed.set(edge.target, pins)
  }

  let rewired = 0
  let dropped = 0
  const out: E[] = []
  for (const edge of edges) {
    if (!leavesInOutPin(edge)) {
      out.push(edge)
      continue
    }
    const source = feed.get(edge.source)?.get(edge.sourceHandle as string)
    if (!source) {
      dropped++
      continue
    }
    rewired++
    out.push({ ...edge, source: source.source, sourceHandle: source.sourceHandle })
  }
  return { edges: out, rewired, dropped }
}

/** True when `variable` is declared as VAR_IN_OUT on the POU that owns the diagram. */
export const isInOutVariable = (variable: Pick<PLCVariable, 'class'> | undefined): boolean =>
  variable?.class === 'inOut'

/**
 * Drop the output-side pin of every in-out parameter from a block node's persisted handles.
 *
 * Handle geometry is saved inside the node, not recomputed on load, so a project written
 * before this change still carries the in-out's right-hand pin — it would keep rendering and
 * keep accepting wires. Removing it also re-flows the remaining output pins, whose vertical
 * position comes from their index, so labels and pins stay aligned.
 */
export const stripInOutOutputHandles = <N extends BlockLikeNode>(node: N, geometry: PinGeometry): N => {
  if (node.type !== 'block') return node
  const inOutPins = inOutPinsOf(node)
  if (inOutPins.size === 0) return node

  const outputHandles = (node.data.outputHandles ?? []).filter((handle) => !inOutPins.has(handle.id))
  if (outputHandles.length === (node.data.outputHandles ?? []).length) return node

  const top = (index: number): number => geometry.connectorY + index * geometry.connectorOffsetY
  const reflowed = outputHandles.map((handle, index) => ({
    ...handle,
    glbPosition: handle.glbPosition
      ? { ...handle.glbPosition, y: (node.position?.y ?? 0) + index * geometry.connectorOffsetY }
      : handle.glbPosition,
    relPosition: handle.relPosition ? { ...handle.relPosition, y: top(index) } : handle.relPosition,
    style: handle.style ? { ...handle.style, top: top(index) } : handle.style,
  }))
  const inputHandles = node.data.inputHandles ?? []

  return {
    ...node,
    data: {
      ...node.data,
      handles: [...inputHandles, ...reflowed],
      outputHandles: reflowed,
      // `outputConnector` is the block's primary source pin; drop it if it was the in-out.
      outputConnector:
        node.data.outputConnector && inOutPins.has(node.data.outputConnector.id)
          ? reflowed[0]
          : node.data.outputConnector,
    },
  }
}
