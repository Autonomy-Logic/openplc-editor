import {
  ladderSymbol,
  type LdEdgeEnds,
  parallelEdgeRoute,
  type RungLayout,
  symbolKindOf,
  type WirePoint,
} from '@root/middleware/shared/utils/ladder-layout'
import { BaseEdge, type Edge, type EdgeProps, getSmoothStepPath, type Node, type Position } from '@xyflow/react'
import { memo } from 'react'

/** Data of an LD edge drawn along its engine route: the route's points and how far it runs on into each symbol. */
export type LadderRouteEdgeData = {
  points: readonly WirePoint[]
  sourceInset: number
  targetInset: number
}

export type LadderRouteEdgeType = Edge<LadderRouteEdgeData, 'ladderRoute'>

/** How far a wire runs on into node `node`'s symbol: a contact's or coil's wire inset, else 0. */
function symbolInset(node: Node | undefined): number {
  const variant: unknown = node?.data.variant
  const kind = symbolKindOf(node?.type ?? '', typeof variant === 'string' ? variant : undefined)
  return kind === undefined ? 0 : ladderSymbol(kind).wireInset
}

/**
 * The route data of an LD edge that leaves an opening or ends on a closing parallel node, from the rung layout, with
 * the insets of the symbols at its ends; undefined for any other edge. dx is the display-only x shift per node id.
 */
export function ladderRouteEdgeData(
  layout: RungLayout,
  edge: LdEdgeEnds,
  nodeById: ReadonlyMap<string, Node>,
  dx: (nodeId: string) => number = () => 0,
): LadderRouteEdgeData | undefined {
  const points = parallelEdgeRoute(layout, edge, dx)
  if (points === undefined) return undefined
  return {
    points,
    sourceInset: symbolInset(nodeById.get(edge.source)),
    targetInset: symbolInset(nodeById.get(edge.target)),
  }
}

/** An SVG path through `points`, straight segments only. */
export function polylinePath(points: readonly WirePoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
}

/** The short straight runs that carry a route on into the contact or coil symbols at its ends. */
function symbolRuns(data: LadderRouteEdgeData): string {
  const first = data.points[0]
  const last = data.points[data.points.length - 1]
  const runs: string[] = []
  if (first !== undefined && data.sourceInset > 0) runs.push(`M${first.x - data.sourceInset} ${first.y} H${first.x}`)
  if (last !== undefined && data.targetInset > 0) runs.push(`M${last.x} ${last.y} H${last.x + data.targetInset}`)
  return runs.join(' ')
}

/** An LD edge drawn as the straight polyline through its engine route, in its edge style. */
const LadderRouteEdge = ({ id, data, style }: EdgeProps<LadderRouteEdgeType>) => {
  if (data === undefined || data.points.length < 2) return null
  const runs = symbolRuns(data)
  return (
    <>
      <BaseEdge id={id} path={polylinePath(data.points)} style={style} data-testid={`ld-wire-${id}`} />
      {runs !== '' && <path d={runs} fill='none' style={style} className='react-flow__edge-path' />}
    </>
  )
}

const exportLadderRouteEdge = memo(LadderRouteEdge)

/** Ends closer than this in y count as one height. */
const SAME_HEIGHT_EPS = 0.5

/**
 * The SVG path of an LD wire without an engine route: a straight segment between its ends when they share a y (a
 * smoothstep's fixed offset would overshoot a short wire), else xyflow's smoothstep. A same-height target left of its
 * source (a trailing group's closing junction drawn on the rail) leaves nothing to draw.
 */
export function ladderWirePath(ends: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
}): string {
  if (Math.abs(ends.sourceY - ends.targetY) <= SAME_HEIGHT_EPS) {
    const fromX = Math.min(ends.sourceX, ends.targetX)
    return `M${fromX} ${ends.sourceY} L${ends.targetX} ${ends.sourceY}`
  }
  return getSmoothStepPath(ends)[0]
}

/** An LD wire between two handles, drawn by ladderWirePath. */
const LadderWireEdge = ({
  id,
  style,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) => (
  <BaseEdge
    id={id}
    path={ladderWirePath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })}
    style={style}
  />
)

/** The edge types of an LD rung: the routed parallel wires, and every other wire. */
export const ladderEdgeTypes = { ladderRoute: exportLadderRouteEdge, ladderWire: memo(LadderWireEdge) }

export { exportLadderRouteEdge as LadderRouteEdge }
