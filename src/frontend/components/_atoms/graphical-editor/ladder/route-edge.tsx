import {
  ladderSymbol,
  type LdEdgeEnds,
  parallelEdgeRoute,
  type RungLayout,
  symbolKindOf,
  type WirePoint,
} from '@root/middleware/shared/utils/ladder-layout'
import { BaseEdge, type Edge, type EdgeProps, type Node } from '@xyflow/react'
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
 * the insets of the symbols at its ends; undefined for any other edge.
 */
export function ladderRouteEdgeData(
  layout: RungLayout,
  edge: LdEdgeEnds,
  nodeById: ReadonlyMap<string, Node>,
): LadderRouteEdgeData | undefined {
  const points = parallelEdgeRoute(layout, edge)
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

/** The edge types of an LD rung: the routed parallel wires; every other edge stays xyflow's smoothstep. */
export const ladderEdgeTypes = { ladderRoute: exportLadderRouteEdge }

export { exportLadderRouteEdge as LadderRouteEdge }
