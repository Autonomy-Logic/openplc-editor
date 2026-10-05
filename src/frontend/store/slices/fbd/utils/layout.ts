/**
 * Place an FBD graph on the canvas.
 *
 * Unlike ladder, FBD has no recovery path: `addFBDFlow` never touches geometry,
 * and there is no solver to hand the job to. On a free-form canvas that is the
 * right default — "arranged differently" is a legitimate state for a diagram a
 * person laid out — but it means a caller building a graph from a description
 * has to place it, and a graph with everything at the origin is unreadable.
 *
 * The rule is signal flow: a node sits to the right of everything that feeds it.
 * Column is the longest path from a source, so a block waits for its deepest
 * input rather than its first; row is order of appearance, which keeps the
 * result stable and predictable for the caller that wrote the list.
 *
 * Pure: no store, no React, no measurement.
 */

/** A node to place. Only its identity and its edges matter here. */
export interface LayoutNode {
  id: string
}

export interface LayoutConnection {
  from: string
  to: string
}

export interface LayoutOptions {
  /** Horizontal distance between columns. */
  columnPitch?: number
  /** Vertical distance between rows. */
  rowPitch?: number
  originX?: number
  originY?: number
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>
  /** Edges dropped from the depth walk to break a cycle. */
  brokenCycles: LayoutConnection[]
}

const DEFAULT_COLUMN_PITCH = 260
const DEFAULT_ROW_PITCH = 120

export function layoutFbdGraph(
  nodes: readonly LayoutNode[],
  connections: readonly LayoutConnection[],
  options: LayoutOptions = {},
): LayoutResult {
  const columnPitch = options.columnPitch ?? DEFAULT_COLUMN_PITCH
  const rowPitch = options.rowPitch ?? DEFAULT_ROW_PITCH
  const originX = options.originX ?? 0
  const originY = options.originY ?? 0

  const known = new Set(nodes.map((node) => node.id))
  const incoming = new Map<string, string[]>()
  for (const node of nodes) incoming.set(node.id, [])
  for (const connection of connections) {
    if (!known.has(connection.from) || !known.has(connection.to)) continue
    incoming.get(connection.to)?.push(connection.from)
  }

  const column = new Map<string, number>()
  const brokenCycles: LayoutConnection[] = []
  const visiting = new Set<string>()

  /**
   * Longest path back to a source.
   *
   * Feedback is legal in FBD — a latch feeding its own reset is an ordinary
   * diagram, not an error — so a cycle is broken at the edge that closes it and
   * reported, never thrown.
   */
  const depthOf = (id: string): number => {
    const cached = column.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0

    visiting.add(id)
    let deepest = 0
    for (const producer of incoming.get(id) ?? []) {
      if (visiting.has(producer)) {
        brokenCycles.push({ from: producer, to: id })
        continue
      }
      deepest = Math.max(deepest, depthOf(producer) + 1)
    }
    visiting.delete(id)

    column.set(id, deepest)
    return deepest
  }

  for (const node of nodes) depthOf(node.id)

  // Row is first appearance within a column, so the caller's ordering survives.
  const nextRow = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    const col = column.get(node.id) ?? 0
    const row = nextRow.get(col) ?? 0
    nextRow.set(col, row + 1)
    positions.set(node.id, { x: originX + col * columnPitch, y: originY + row * rowPitch })
  }

  return { positions, brokenCycles }
}
