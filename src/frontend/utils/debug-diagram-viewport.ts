/** Axis-aligned rectangle, in screen or flow coordinates. */
export type ViewRect = { x: number; y: number; width: number; height: number }

/** Geometry of an FBD node as the flow stores it. */
export type FbdNodeGeometry = {
  id: string
  type?: string
  position: { x: number; y: number }
  width?: number | null
  height?: number | null
  measured?: { width?: number; height?: number }
}

/** Ends of an FBD wire. */
export type FbdEdgeEnds = { source: string; target: string }

const overlaps = (a: ViewRect, b: ViewRect): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height

const nodeRect = (node: FbdNodeGeometry): ViewRect => ({
  x: node.position.x,
  y: node.position.y,
  width: node.measured?.width ?? node.width ?? 0,
  height: node.measured?.height ?? node.height ?? 0,
})

const union = (a: ViewRect, b: ViewRect): ViewRect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

const isPassThrough = (node: FbdNodeGeometry | undefined): boolean =>
  node?.type === 'connector' || node?.type === 'continuation'

/** Part of the flow inside a pane of `width` x `height` px under the xyflow viewport transform. */
export function flowViewRect(
  viewport: { x: number; y: number; zoom: number },
  width: number,
  height: number,
): ViewRect {
  const zoom = viewport.zoom || 1
  return { x: -viewport.x / zoom, y: -viewport.y / zoom, width: width / zoom, height: height / zoom }
}

/**
 * Ids, in node order, of the FBD nodes whose values the part of the diagram inside `view` shows: the nodes it
 * overlaps and the sources of the wires it overlaps, traced back through connectors and continuations, whose wire
 * colour comes from their inputs. A wire's extent is taken as the box around both of its nodes.
 */
export function fbdNodesInView(nodes: FbdNodeGeometry[], edges: FbdEdgeEnds[], view: ViewRect): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rects = new Map(nodes.map((node) => [node.id, nodeRect(node)]))
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = incoming.get(edge.target)
    if (sources) sources.push(edge.source)
    else incoming.set(edge.target, [edge.source])
  }

  const needed = new Set<string>()
  for (const node of nodes) if (overlaps(rects.get(node.id)!, view)) needed.add(node.id)

  const pending: string[] = []
  for (const edge of edges) {
    const source = rects.get(edge.source)
    const target = rects.get(edge.target)
    if (source && target && overlaps(union(source, target), view)) pending.push(edge.source)
  }
  for (const id of needed) if (isPassThrough(byId.get(id))) pending.push(id)

  const traced = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (traced.has(id)) continue
    traced.add(id)
    needed.add(id)
    if (isPassThrough(byId.get(id))) pending.push(...(incoming.get(id) ?? []))
  }

  return nodes.filter((node) => needed.has(node.id)).map((node) => node.id)
}

/** Ids, in item order, of the items whose vertical extent overlaps [top, bottom]. */
export function idsInVerticalView(
  items: Array<{ id: string; top: number; bottom: number }>,
  top: number,
  bottom: number,
): string[] {
  return items.filter((item) => item.bottom >= top && item.top <= bottom && bottom > top).map((item) => item.id)
}
