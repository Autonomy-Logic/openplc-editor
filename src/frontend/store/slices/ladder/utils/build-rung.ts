/**
 * Build a ladder rung from a series/parallel description, with no coordinates.
 *
 * A rung is a series-parallel two-terminal network, so a nested expression
 * describes it completely — which is what lets a caller author one without
 * knowing anything about React Flow, handle ids or pixel geometry.
 *
 * Geometry is deliberately left at `{x: 0, y: 0}` on every element. That is not
 * a placeholder: `needsPositionRecovery` treats any element at the origin as a
 * signal, and `addLadderFlow` then runs the editor's real layout solver over the
 * rung (`ladder/slice.ts:222-272`). Omitting `position` entirely would NOT
 * trigger it — an absent position is explicitly not a signal — so every node
 * must carry `{0, 0}` and let the store place it.
 *
 * This lives in the store layer because `nodesBuilder` is a component module the
 * CLI may not import; `ladder/utils/index.ts` already carries that exception.
 */

import type { Edge, Node } from '@xyflow/react'

import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../components/_atoms/graphical-editor/ladder/node-builders'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import type { RungLadderState } from '../types'

/** The literals the ladder nodes carry — see `ladder/utils/types.ts`. */
export type ContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
export type CoilVariant = ContactVariant | 'set' | 'reset'

/** A leaf: one contact. */
export interface RungContact {
  contact: { variable: string; variant: ContactVariant }
}

/** The series-parallel expression describing a rung's condition. */
export type RungLogic = RungContact | { series: RungLogic[] } | { parallel: RungLogic[] }

/** What the rung drives. */
export type RungOutput =
  | { coil: { variable: string; variant: CoilVariant } }
  | {
      block: {
        variant: unknown
        instance?: string
        /**
         * Variable or literal per data pin, keyed by the pin's own name.
         * Applied AFTER the flow is added — `addLadderFlow` creates one
         * variable element per pin itself, so these name the elements it made
         * rather than adding a second set.
         */
        inputs?: Record<string, string>
        outputs?: Record<string, string>
        /**
         * Add EN/ENO and run rung power through them.
         *
         * Off by default, which is how a timer or counter is drawn: power goes
         * in the first boolean input and out the first boolean output, so the
         * block is actually driven. With EN/ENO the rung only gates the call and
         * `IN` is left open — the timer never runs. The editor forces this on
         * anyway for a block whose first input or output is not BOOL.
         */
        executionControl?: boolean
      }
    }

/**
 * Resolve an element's variable name to the POU's declared variable.
 *
 * Returning `undefined` leaves the element carrying just the name, which is what
 * the editor shows for a name that matches nothing.
 */
export type RungVariableResolver = (name: string, kind: 'contact' | 'coil' | 'block') => { name: string } | undefined

export interface BuildLadderRungInput {
  rungId: string
  comment?: string
  logic?: RungLogic
  outputs: RungOutput[]
  /** Without this, elements carry a bare name and the editor rings them red. */
  resolveVariable?: RungVariableResolver
  /** Canvas the rails span. Defaults to the size the editor starts a rung at. */
  defaultBounds?: [number, number]
}

/** One built fragment and the two terminals the caller wires it by. */
interface Fragment {
  nodes: Node[]
  edges: Edge[]
  entry: { nodeId: string; handleId: string }
  exit: { nodeId: string; handleId: string }
  /**
   * The terminals to use when this fragment hangs off a parallel's DOWN path.
   *
   * A parallel pair carries a second set of connectors — `input-top` on the open
   * and `output-top` on the close — that exist only for nesting: they sit a
   * connector's height above the others, which is what makes concentric
   * brackets draw as brackets. `startParallelConnection` overrides the handles
   * for exactly this case ("Detect nested parallel for handle overrides"), and
   * wiring the inner pair by its ordinary `input`/`output-right` instead put the
   * verticals in a staircase.
   *
   * Only set by a fragment that begins/ends with a parallel pair.
   */
  nestedEntry?: { nodeId: string; handleId: string }
  nestedExit?: { nodeId: string; handleId: string }
}

/** Ladder's own edge-id form — see `ladder-utils/edges.ts`. */
function edgeId(source: string, target: string, sourceHandle: string, targetHandle: string): string {
  return `e_${source}_${target}__${sourceHandle}_${targetHandle}`
}

function connect(from: { nodeId: string; handleId: string }, to: { nodeId: string; handleId: string }): Edge {
  return {
    id: edgeId(from.nodeId, to.nodeId, from.handleId, to.handleId),
    source: from.nodeId,
    sourceHandle: from.handleId,
    target: to.nodeId,
    targetHandle: to.handleId,
    type: 'smoothstep',
  }
}

/** Every element starts at the origin so the solver knows to place it. */
const ORIGIN = { posX: 0, posY: 0, handleX: 0, handleY: 0 }

/** A power rail carries exactly one handle. */
function railHandleId(rail: Node): string {
  return (rail.data as { handles: { id: string }[] }).handles[0].id
}

function buildContact(spec: RungContact): Fragment {
  const id = newGraphicalEditorNodeID('CONTACT')
  const node = nodesBuilder.contact({ id, ...ORIGIN, variant: spec.contact.variant }) as unknown as Node
  const data = node.data as { variable: { name: string } }
  data.variable = { name: spec.contact.variable }
  return {
    nodes: [node],
    edges: [],
    entry: { nodeId: id, handleId: 'input' },
    exit: { nodeId: id, handleId: 'output' },
  }
}

function buildSeries(parts: RungLogic[]): Fragment {
  const built = parts.map(buildLogic)
  const nodes = built.flatMap((part) => part.nodes)
  const edges = built.flatMap((part) => part.edges)
  for (let index = 0; index < built.length - 1; index += 1) {
    edges.push(connect(built[index].exit, built[index + 1].entry))
  }
  const last = built[built.length - 1]
  return {
    nodes,
    edges,
    entry: built[0].entry,
    exit: last.exit,
    // Carried from the ends: a series that STARTS with a parallel is still a
    // nested parallel as far as the enclosing pair's down path is concerned.
    nestedEntry: built[0].nestedEntry,
    nestedExit: last.nestedExit,
  }
}

/**
 * A parallel pair wraps exactly two branches — that is what the node model
 * carries, one straight-through path and one "down" path. Three or more nest,
 * which is also how the editor builds them when a branch is added to a branch.
 */
function buildParallel(branches: RungLogic[]): Fragment {
  if (branches.length > 2) {
    return buildParallel([branches[0], { parallel: branches.slice(1) }])
  }

  const openId = newGraphicalEditorNodeID('PARALLEL_OPEN')
  const closeId = newGraphicalEditorNodeID('PARALLEL_CLOSE')
  const open = nodesBuilder.parallel({ id: openId, ...ORIGIN, type: 'open' }) as unknown as Node
  const close = nodesBuilder.parallel({ id: closeId, ...ORIGIN, type: 'close' }) as unknown as Node

  // The pair is linked by id; the layout and wiring code both follow these.
  const openData = open.data as {
    parallelCloseReference?: string
    parallelOutputConnector: { id: string }
    parallelInputConnector: { id: string }
  }
  const closeData = close.data as {
    parallelOpenReference?: string
    parallelInputConnector: { id: string }
    parallelOutputConnector: { id: string }
  }
  openData.parallelCloseReference = closeId
  closeData.parallelOpenReference = openId

  const [first, second] = branches.map(buildLogic)
  const nodes = [open, ...first.nodes, ...second.nodes, close]
  const edges = [...first.edges, ...second.edges]

  // Straight through: OPEN's output to the first branch, on to CLOSE's input.
  edges.push(connect({ nodeId: openId, handleId: 'output-right' }, first.entry))
  edges.push(connect(first.exit, { nodeId: closeId, handleId: 'input' }))
  // The branch below: OPEN's down pin to the second branch, on to CLOSE's. A
  // nested pair is entered by its top connectors, not its ordinary ones.
  edges.push(
    connect({ nodeId: openId, handleId: openData.parallelOutputConnector.id }, second.nestedEntry ?? second.entry),
  )
  edges.push(
    connect(second.nestedExit ?? second.exit, { nodeId: closeId, handleId: closeData.parallelInputConnector.id }),
  )

  return {
    nodes,
    edges,
    entry: { nodeId: openId, handleId: 'input' },
    exit: { nodeId: closeId, handleId: 'output-right' },
    nestedEntry: { nodeId: openId, handleId: openData.parallelInputConnector.id },
    nestedExit: { nodeId: closeId, handleId: closeData.parallelOutputConnector.id },
  }
}

function buildLogic(logic: RungLogic): Fragment {
  if ('contact' in logic) return buildContact(logic)
  if ('series' in logic) return buildSeries(logic.series)
  return buildParallel(logic.parallel)
}

function buildOutput(output: RungOutput): Fragment {
  if ('coil' in output) {
    const id = newGraphicalEditorNodeID('COIL')
    const node = nodesBuilder.coil({ id, ...ORIGIN, variant: output.coil.variant }) as unknown as Node
    const data = node.data as { variable: { name: string } }
    data.variable = { name: output.coil.variable }
    return {
      nodes: [node],
      edges: [],
      entry: { nodeId: id, handleId: 'input' },
      exit: { nodeId: id, handleId: 'output' },
    }
  }

  const id = newGraphicalEditorNodeID('BLOCK')
  const node = nodesBuilder.block({
    id,
    ...ORIGIN,
    variant: output.block.variant as never,
    executionControl: output.block.executionControl ?? false,
  }) as unknown as Node
  const data = node.data as {
    variable: { name: string }
    inputConnector?: { id: string }
    outputConnector?: { id: string }
  }
  if (output.block.instance) data.variable = { name: output.block.instance }

  // Read the power pins off the built node rather than naming them. The builder
  // decides whether the block gets EN/ENO, and its first left/right connector is
  // whichever pin ends up carrying rung power — EN/ENO when execution control is
  // on, the first boolean input and output when it is not.
  return {
    nodes: [node],
    edges: [],
    entry: { nodeId: id, handleId: data.inputConnector?.id ?? 'EN' },
    exit: { nodeId: id, handleId: data.outputConnector?.id ?? 'ENO' },
  }
}

/**
 * What the editor starts every rung at (`graphical/ladder/index.tsx`).
 *
 * The value matters beyond the initial canvas: `changeRailBounds` only moves the
 * right rail when content is WIDER than this, so a generous bound leaves the
 * rail parked out at its full width with the coil stranded mid-rung. At 300 any
 * real rung overflows, and the rail is pulled in to sit just past the last
 * element — which is where a hand-drawn rung puts it.
 */
const EDITOR_RUNG_BOUNDS: [number, number] = [300, 100]

export function buildLadderRung(input: BuildLadderRungInput): RungLadderState {
  const defaultBounds = input.defaultBounds ?? EDITOR_RUNG_BOUNDS
  const { powerRail } = defaultCustomNodesStyles

  // Rails keep real coordinates — `needsPositionRecovery` ignores them, and the
  // solver measures the span it has to lay the rung out across from them.
  const leftRail = nodesBuilder.powerRail({
    id: `left-rail-${input.rungId}`,
    posX: 0,
    posY: defaultBounds[1] / 2 - powerRail.height / 2,
    connector: 'right',
    handleX: powerRail.width,
    handleY: defaultBounds[1] / 2,
  }) as unknown as Node
  const rightRail = nodesBuilder.powerRail({
    id: `right-rail-${input.rungId}`,
    posX: defaultBounds[0],
    posY: defaultBounds[1] / 2 - powerRail.height / 2,
    connector: 'left',
    handleX: defaultBounds[0] - powerRail.width,
    handleY: defaultBounds[1] / 2,
  }) as unknown as Node

  // Read the handle id off the built rail: it is the opposite of the node's
  // `connector`, so naming it here gets it backwards. `startLadderRung` reads
  // it the same way.
  const leftExit = { nodeId: leftRail.id, handleId: railHandleId(leftRail) }
  const rightEntry = { nodeId: rightRail.id, handleId: railHandleId(rightRail) }

  const nodes: Node[] = [leftRail]
  const edges: Edge[] = []
  let power = leftExit

  if (input.logic) {
    const condition = buildLogic(input.logic)
    nodes.push(...condition.nodes)
    edges.push(...condition.edges)
    edges.push(connect(power, condition.entry))
    power = condition.exit
  }

  for (const output of input.outputs) {
    const built = buildOutput(output)
    nodes.push(...built.nodes)
    edges.push(...built.edges)
    edges.push(connect(power, built.entry))
    power = built.exit
  }

  edges.push(connect(power, rightEntry))
  nodes.push(rightRail)

  // The editor stores the whole declared variable on an element, not just its
  // name, and checks the two agree — a block whose instance does not resolve is
  // ringed red. Placing the name alone produced exactly that.
  if (input.resolveVariable) {
    for (const node of nodes) {
      const kind = node.type
      if (kind !== 'contact' && kind !== 'coil' && kind !== 'block') continue
      const data = node.data as { variable: { name: string } }
      const resolved = input.resolveVariable(data.variable.name, kind)
      if (resolved) data.variable = resolved
    }
  }

  return {
    id: input.rungId,
    comment: input.comment ?? '',
    defaultBounds,
    reactFlowViewport: defaultBounds,
    selectedNodes: [],
    nodes,
    edges,
  } as unknown as RungLadderState
}
