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
 * These helpers are the single source of truth for how the EDITOR sides a parameter — pin
 * geometry, pin labels, the connection checks, the debug badges and the divergence detector all
 * derive from them, so the sides cannot drift.
 *
 * The compiler deliberately keeps its own predicate and is NOT governed by this file:
 * `st-transpiler/emit/pou-graphical.ts` and `backend/shared/utils/PLC/collect-library-blocks.ts`
 * both still test `output || inOut`, because code generation needs an in-out in BOTH directions
 * to emit the copy-in and the copy-out.
 */
type BlockParameter = { name: string; class: string }

export const blockInputVariables = <T extends BlockParameter>(variables: T[]): T[] =>
  variables.filter((variable) => variable.class === 'input' || variable.class === 'inOut')

export const blockOutputVariables = <T extends BlockParameter>(variables: T[]): T[] =>
  variables.filter((variable) => variable.class === 'output')

/**
 * Which side of a block a parameter's single pin sits on.
 *
 * Callers that classify an EXISTING pin (rather than filtering a list) need the same rule the
 * two filters above encode; deriving it here keeps them from re-deciding it locally.
 */
export const blockParameterSide = (variable: BlockParameter): 'input' | 'output' =>
  variable.class === 'output' ? 'output' : 'input'

/**
 * Horizontal space the ⟷ marker adds to an in-out pin's label, in pixels.
 *
 * Block width is measured from the pin labels, so the marker has to be paid for there or a
 * long in-out name plus the arrow overflows the block. Keep in step with InOutPinMarker.
 */
export const IN_OUT_MARKER_WIDTH = 16

/** Names of a block's `VAR_IN_OUT` parameters, for the pin marker and the connection checks. */
export const inOutVariableNames = <T extends BlockParameter>(variables: T[]): Set<string> =>
  new Set(variables.filter((variable) => variable.class === 'inOut').map((variable) => variable.name))

/**
 * A pin as the editors persist it inside a node's `data`.
 *
 * Only identity and side matter here — these rules never touch geometry, which is exactly why
 * they cannot put a pin in the wrong place. `id` is optional because xyflow ≥12.11 types a
 * handle id as nullable; every pin the editors build carries one, so an id-less handle is simply
 * not a pin these rules can speak about.
 */
interface HandleLike {
  id?: string
  type: string
}

/** The minimum a node has to look like for these rules to apply. */
interface BlockLikeNode {
  id: string
  type?: string
  data: {
    variant?: { variables?: { name: string; class: string }[] }
    handles?: HandleLike[]
    outputHandles?: HandleLike[]
  }
}

interface EdgeLike {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
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
  graph: { nodes: BlockLikeNode[]; edges: EdgeLike[] },
): string | undefined => {
  const { target, targetHandle } = connection
  if (!target || !targetHandle) return undefined

  const targetNode = graph.nodes.find((node) => node.id === target)
  if (!inOutPinsOf(targetNode).has(targetHandle)) return undefined

  const alreadyWired = graph.edges.some((edge) => edge.target === target && edge.targetHandle === targetHandle)
  return alreadyWired ? targetHandle : undefined
}

/**
 * Names of the pins a block still carries on its OUTPUT side for a `VAR_IN_OUT` parameter — the
 * two-sided geometry of a diagram saved before an in-out became input-only.
 *
 * Both persisted arrays are checked. `outputHandles` is what the sizing and label code reads;
 * `handles` is what actually renders, and an in-out appears in it twice under the SAME id, once
 * as `target` and once as `source` — so only the source entry counts, or the surviving input pin
 * would be swept up with it.
 */
export const legacyInOutSourcePinIds = (data: BlockLikeNode['data']): Set<string> => {
  const inOutPins = inOutVariableNames(data.variant?.variables ?? [])
  const stale = new Set<string>()
  if (inOutPins.size === 0) return stale

  for (const handle of data.outputHandles ?? []) if (handle.id && inOutPins.has(handle.id)) stale.add(handle.id)
  for (const handle of data.handles ?? [])
    if (handle.type === 'source' && handle.id && inOutPins.has(handle.id)) stale.add(handle.id)
  return stale
}

/**
 * True when a block node still carries the OUTPUT-side pin of a `VAR_IN_OUT` parameter.
 *
 * This cannot be detected by comparing declarations, which is what the editors' divergence
 * check does: the POU still declares the parameter as `inOut` and the node's own variant still
 * agrees with it. Nothing about the interface changed — only the rule that draws it did — and
 * handle geometry is persisted inside the node rather than recomputed on load.
 *
 * The signal is exact in both directions. `blockOutputVariables` excludes `inOut`, so a node
 * built by the current rules can never carry a source-side pin named after an in-out parameter:
 * no false positives. And rebuilding the node through `buildBlockNode` removes that pin, so the
 * flag clears itself once the user accepts the update.
 */
export const hasLegacyInOutOutputHandle = (node: BlockLikeNode): boolean =>
  node.type === 'block' && legacyInOutSourcePinIds(node.data).size > 0

/**
 * Re-point every wire that LEAVES one of `node`'s in-out pins at whatever feeds that pin.
 *
 * A diagram saved before the in-out pin became input-only can contain such wires — the
 * Irrigation Controller's `main` reads `Irrigation_Main_Controller.State` into two other
 * blocks. The read is equivalent to reading the variable connected to the pin (the block wrote
 * through the reference), so re-pointing keeps the diagram and the generated code behaving
 * exactly as before instead of dropping the wire.
 *
 * FBD ONLY. In Ladder an edge leaving a block is the rung chain, not a data read: re-pointing
 * it at the pin's feed would route the rail around the block. The Ladder update path re-points
 * its outgoing edges at the rebuilt block's `outputConnector` instead.
 *
 * A wire whose in-out pin has nothing feeding it cannot be salvaged and is dropped; the counts
 * come back so the caller can report both.
 */
export const rewireInOutReads = <E extends EdgeLike>(
  node: BlockLikeNode,
  edges: E[],
): { edges: E[]; rewired: number; dropped: number } => {
  const inOutPins = inOutPinsOf(node)
  if (inOutPins.size === 0) return { edges, rewired: 0, dropped: 0 }

  const leavesInOutPin = (edge: EdgeLike): boolean =>
    edge.source === node.id && !!edge.sourceHandle && inOutPins.has(edge.sourceHandle)

  if (!edges.some(leavesInOutPin)) return { edges, rewired: 0, dropped: 0 }

  // What feeds each in-out pin: pin name -> the wire's source.
  const feed = new Map<string, { source: string; sourceHandle?: string | null }>()
  for (const edge of edges) {
    if (edge.target !== node.id || !edge.targetHandle || !inOutPins.has(edge.targetHandle)) continue
    feed.set(edge.targetHandle, { source: edge.source, sourceHandle: edge.sourceHandle })
  }

  let rewired = 0
  let dropped = 0
  const out: E[] = []
  for (const edge of edges) {
    // Re-derive the pin rather than re-testing `leavesInOutPin`, so the narrowed handle name is
    // available below without a second null check that could never fire.
    const pin = edge.source === node.id && edge.sourceHandle ? edge.sourceHandle : undefined
    if (pin === undefined || !inOutPins.has(pin)) {
      out.push(edge)
      continue
    }
    const source = feed.get(pin)
    if (!source) {
      dropped++
      continue
    }
    rewired++
    out.push({ ...edge, source: source.source, sourceHandle: source.sourceHandle })
  }
  return { edges: out, rewired, dropped }
}
