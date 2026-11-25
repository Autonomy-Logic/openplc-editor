import type { NodeGeometry, ParallelGroupLayout, RungLayout } from './types'

/** A point of a wire in rung canvas coordinates. */
export interface WirePoint {
  x: number
  y: number
}

/** The ends of an LD edge: its nodes and handles. */
export interface LdEdgeEnds {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface Junctions {
  opens: ReadonlyMap<string, ParallelGroupLayout>
  closes: ReadonlyMap<string, ParallelGroupLayout>
}

const junctionCache = new WeakMap<RungLayout, Junctions>()

/** The group each opening and closing parallel node of a layout belongs to. */
function junctionsOf(layout: RungLayout): Junctions {
  const cached = junctionCache.get(layout)
  if (cached !== undefined) return cached
  const opens = new Map<string, ParallelGroupLayout>()
  const closes = new Map<string, ParallelGroupLayout>()
  for (const group of layout.parallels) {
    for (const id of group.openNodeIds) opens.set(id, group)
    for (const id of group.closeNodeIds) closes.set(id, group)
  }
  const junctions = { opens, closes }
  junctionCache.set(layout, junctions)
  return junctions
}

/** A handle's position in rung canvas coordinates, or undefined when the node or handle is not in the layout. */
function handlePoint(layout: RungLayout, nodeId: string, handleId: string | null | undefined): WirePoint | undefined {
  const geometry: NodeGeometry | undefined = layout.nodes.get(nodeId)
  const handle = geometry?.handles.find((candidate) => candidate.id === handleId)
  if (geometry === undefined || handle === undefined) return undefined
  return { x: geometry.position.x + handle.x, y: geometry.position.y + handle.y }
}

/** The points without consecutive repeats; both end points are kept as given. */
function withoutRepeats(points: readonly WirePoint[]): WirePoint[] {
  const kept: WirePoint[] = []
  points.forEach((point, index) => {
    const previous = kept.length > 0 ? kept[kept.length - 1] : undefined
    const repeat =
      previous !== undefined && Math.abs(previous.x - point.x) < 1e-9 && Math.abs(previous.y - point.y) < 1e-9
    if (!repeat) kept.push(point)
    else if (index === points.length - 1 && kept.length > 1) kept[kept.length - 1] = point
  })
  return kept
}

/**
 * Orthogonal points of an edge that leaves an opening parallel node or ends on a closing one; undefined for any
 * other edge. dx is a display-only x shift per node id (default 0): each end takes its node's shift, the corner its
 * junction's.
 */
export function parallelEdgeRoute(
  layout: RungLayout,
  edge: LdEdgeEnds,
  dx: (nodeId: string) => number = () => 0,
): readonly WirePoint[] | undefined {
  const { opens, closes } = junctionsOf(layout)
  const closing = closes.get(edge.target)
  const opening = closing === undefined ? opens.get(edge.source) : undefined
  if (closing === undefined && opening === undefined) return undefined
  const source = handlePoint(layout, edge.source, edge.sourceHandle)
  const target = handlePoint(layout, edge.target, edge.targetHandle)
  if (source === undefined || target === undefined) return undefined
  const junction = closing !== undefined ? edge.target : edge.source
  const corner =
    closing !== undefined ? { x: closing.closeX, y: source.y } : { x: opening?.openX ?? source.x, y: target.y }
  const at = (point: WirePoint, id: string): WirePoint => ({ x: point.x + dx(id), y: point.y })
  return withoutRepeats([at(source, edge.source), at(corner, junction), at(target, edge.target)])
}
