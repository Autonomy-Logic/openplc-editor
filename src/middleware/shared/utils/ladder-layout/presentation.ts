import { LADDER_STYLE } from './style'
import type { RungLayout } from './types'

/** How the rungs of one LD POU are shown on one canvas: display-only, never stored. */
export interface PouPresentation {
  /** X of the shared right rail in rung canvas coordinates. */
  railX: number
  /** Canvas width of every rung: railX + padR. */
  widthPx: number
  /** Display-only x shift per node id: the right rails and the trailing outputs. */
  dxByNode: ReadonlyMap<string, number>
}

/**
 * The presentation of a POU's rungs in an editor `viewportWidthPx` wide: one right rail for every rung, 24 px from the
 * editor's right edge when every rung fits after the gutter, else right after the widest rung; each rung's right rail
 * and trailing outputs shift to it.
 */
export function presentPou(
  layouts: readonly RungLayout[],
  viewportWidthPx: number,
  style: typeof LADDER_STYLE = LADDER_STYLE,
): PouPresentation {
  const widest = layouts.reduce((width, layout) => Math.max(width, layout.size.width), 0)
  const railX = Math.max(viewportWidthPx - style.gutter - style.padR, widest)
  const dxByNode = new Map<string, number>()
  for (const layout of layouts) {
    const dx = railX - layout.size.width
    const shifted =
      layout.rightRailId === undefined ? layout.trailingOutputIds : [...layout.trailingOutputIds, layout.rightRailId]
    for (const id of shifted) dxByNode.set(id, dx)
  }
  return { railX, widthPx: railX + style.padR, dxByNode }
}

/**
 * The presentation of one rung of the POU: the same rail, with only this rung's shifts. Node ids are unique per rung,
 * not per POU, so each rung body must use its own map.
 */
export function rungPresentation(p: PouPresentation, layout: RungLayout): PouPresentation {
  const dx = p.railX - layout.size.width
  const ids =
    layout.rightRailId === undefined ? layout.trailingOutputIds : [...layout.trailingOutputIds, layout.rightRailId]
  return { ...p, dxByNode: new Map(ids.map((id) => [id, dx])) }
}

/** The display shift of node `nodeId`: its entry in the presentation, 0 when it has none. */
export function displayShift(p: PouPresentation, nodeId: string): number {
  return p.dxByNode.get(nodeId) ?? 0
}

/** Copies of `nodes` at their displayed positions; a node with no shift is returned as it is. The input is not changed. */
export function toDisplayNodes<T extends { id: string; position: { x: number; y: number } }>(
  nodes: readonly T[],
  p: PouPresentation,
): T[] {
  return nodes.map((node) => {
    const dx = displayShift(p, node.id)
    return dx === 0 ? node : { ...node, position: { x: node.position.x + dx, y: node.position.y } }
  })
}

/** The canonical position of node `nodeId` drawn at `pos`: the display shift taken back off x. */
export function toCanonicalPosition(
  nodeId: string,
  pos: { x: number; y: number },
  p: PouPresentation,
): { x: number; y: number } {
  return { x: pos.x - displayShift(p, nodeId), y: pos.y }
}
