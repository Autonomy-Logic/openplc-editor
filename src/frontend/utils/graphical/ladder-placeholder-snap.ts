import type { Node } from '@xyflow/react'

import type { Point } from './radial-menu-geometry'

export const LADDER_PLACEHOLDER_SNAP_RADIUS = 24
const FALLBACK_PLACEHOLDER_SIZE = 10

const isPlaceholder = (node: Node): boolean => node.type === 'placeholder' || node.type === 'parallelPlaceholder'

/**
 * Nearest ladder placeholder whose centre lies within `radius` of `flowPoint`
 * (flow coordinates), or `undefined` when none is close enough.
 */
export function findPlaceholderWithinRadius(
  nodes: readonly Node[],
  flowPoint: Point,
  radius: number = LADDER_PLACEHOLDER_SNAP_RADIUS,
): Node | undefined {
  let best: Node | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const node of nodes) {
    if (!isPlaceholder(node)) continue
    const width = node.width ?? node.measured?.width ?? FALLBACK_PLACEHOLDER_SIZE
    const height = node.height ?? node.measured?.height ?? FALLBACK_PLACEHOLDER_SIZE
    const distance = Math.hypot(node.position.x + width / 2 - flowPoint.x, node.position.y + height / 2 - flowPoint.y)
    if (distance <= radius && distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }

  return best
}

/**
 * Marks only the placeholder `targetId` as selected, leaving every other node
 * untouched. Returns the same array when nothing changes.
 */
export function selectOnlyPlaceholder(nodes: Node[], targetId: string | undefined): Node[] {
  const differs = (node: Node) => isPlaceholder(node) && (node.id === targetId) !== Boolean(node.selected)
  if (!nodes.some(differs)) return nodes
  return nodes.map((node) => (differs(node) ? { ...node, selected: node.id === targetId } : node))
}
