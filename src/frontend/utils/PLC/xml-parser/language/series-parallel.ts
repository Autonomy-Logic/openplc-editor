// PLCopen LD flattens a rung into point-to-point connections: a branch is only a fan-out
// followed by a fan-in. The ladder editor needs the series/parallel nesting back, so the
// connection graph is reduced to a series-parallel expression here.

export type SeriesParallel<T> =
  | { kind: 'wire' }
  | { kind: 'leaf'; value: T }
  | { kind: 'series'; items: SeriesParallel<T>[] }
  | { kind: 'parallel'; branches: SeriesParallel<T>[] }

export const SOURCE = Symbol('series-parallel-source')
export const SINK = Symbol('series-parallel-sink')

export interface SeriesParallelWire {
  from: string | typeof SOURCE
  to: string | typeof SINK
}

export type SeriesParallelResult<T> = { ok: true; expr: SeriesParallel<T> } | { ok: false; reason: string }

interface GraphEdge<T> {
  from: string
  to: string
  expr: SeriesParallel<T>
}

// The reduction is roughly cubic in the rung size; past this a rung keeps its XML layout instead.
export const MAX_REDUCIBLE_ELEMENTS = 200

const SOURCE_VERTEX = '\u0000source'
const SINK_VERTEX = '\u0000sink'

function series<T>(a: SeriesParallel<T>, b: SeriesParallel<T>): SeriesParallel<T> {
  if (a.kind === 'wire') return b
  if (b.kind === 'wire') return a
  const items = [...(a.kind === 'series' ? a.items : [a]), ...(b.kind === 'series' ? b.items : [b])]
  return { kind: 'series', items }
}

function parallel<T>(branches: SeriesParallel<T>[]): SeriesParallel<T> {
  return { kind: 'parallel', branches: branches.flatMap((b) => (b.kind === 'parallel' ? b.branches : [b])) }
}

const children = <T>(expr: SeriesParallel<T>): SeriesParallel<T>[] =>
  expr.kind === 'series' ? expr.items : expr.kind === 'parallel' ? expr.branches : []

function leaves<T>(expr: SeriesParallel<T>): T[] {
  return expr.kind === 'leaf' ? [expr.value] : children(expr).flatMap(leaves)
}

function hasBypass<T>(expr: SeriesParallel<T>): boolean {
  return (
    (expr.kind === 'parallel' && expr.branches.some((branch) => branch.kind === 'wire')) ||
    children(expr).some(hasBypass)
  )
}

// Branches are ordered by `rank` (lowest first) so the top branch of the drawing stays on top.
function sortBranches<T>(expr: SeriesParallel<T>, rank: (value: T) => number): SeriesParallel<T> {
  switch (expr.kind) {
    case 'wire':
    case 'leaf':
      return expr
    case 'series':
      return { kind: 'series', items: expr.items.map((item) => sortBranches(item, rank)) }
    case 'parallel': {
      const branchRank = (b: SeriesParallel<T>) => Math.min(...leaves(b).map(rank))
      const branches = expr.branches.map((b) => sortBranches(b, rank))
      return { kind: 'parallel', branches: branches.sort((a, b) => branchRank(a) - branchRank(b)) }
    }
  }
}

/**
 * Reduce a two-terminal graph of elements (each one a series edge from its input to its
 * output) and wires into one series-parallel expression, or say why it is not one.
 */
export function reduceSeriesParallel<T>(
  elements: { id: string; value: T }[],
  wires: SeriesParallelWire[],
  rank: (value: T) => number,
): SeriesParallelResult<T> {
  if (elements.length > MAX_REDUCIBLE_ELEMENTS) {
    return { ok: false, reason: `the rung has more than ${MAX_REDUCIBLE_ELEMENTS} elements` }
  }
  const inVertex = (id: string) => `in:${id}`
  const outVertex = (id: string) => `out:${id}`

  let edges: GraphEdge<T>[] = elements.map(({ id, value }) => ({
    from: inVertex(id),
    to: outVertex(id),
    expr: { kind: 'leaf', value },
  }))
  const seenWires = new Set<string>()
  for (const wire of wires) {
    const from = wire.from === SOURCE ? SOURCE_VERTEX : outVertex(wire.from)
    const to = wire.to === SINK ? SINK_VERTEX : inVertex(wire.to)
    const key = `${from}\u0000${to}`
    if (seenWires.has(key)) continue
    seenWires.add(key)
    edges.push({ from, to, expr: { kind: 'wire' } })
  }

  for (let changed = true; changed; ) {
    changed = false

    const grouped = new Map<string, GraphEdge<T>[]>()
    for (const edge of edges) {
      const key = `${edge.from}\u0000${edge.to}`
      grouped.set(key, [...(grouped.get(key) ?? []), edge])
    }
    if ([...grouped.values()].some((group) => group.length > 1)) {
      edges = [...grouped.values()].map((group) =>
        group.length === 1
          ? group[0]
          : { from: group[0].from, to: group[0].to, expr: parallel(group.map((e) => e.expr)) },
      )
      changed = true
    }

    const vertices = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
    for (const vertex of vertices) {
      if (vertex === SOURCE_VERTEX || vertex === SINK_VERTEX) continue
      const incoming = edges.filter((edge) => edge.to === vertex)
      const outgoing = edges.filter((edge) => edge.from === vertex)
      if (incoming.length !== 1 || outgoing.length !== 1) continue
      const [a] = incoming
      const [b] = outgoing
      if (a === b) continue
      edges = [
        ...edges.filter((edge) => edge !== a && edge !== b),
        { from: a.from, to: b.to, expr: series(a.expr, b.expr) },
      ]
      changed = true
      break
    }
  }

  if (edges.length !== 1 || edges[0].from !== SOURCE_VERTEX || edges[0].to !== SINK_VERTEX) {
    return { ok: false, reason: 'the rung is not a series-parallel network from the left rail to the right rail' }
  }
  const { expr } = edges[0]
  if (hasBypass(expr)) return { ok: false, reason: 'a parallel branch has no element on it' }
  return { ok: true, expr: sortBranches(expr, rank) }
}
