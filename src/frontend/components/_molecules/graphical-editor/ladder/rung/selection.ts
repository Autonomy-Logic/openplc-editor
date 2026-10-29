import type { Node } from '@xyflow/react'

// By id: local copies carry extra fields, and a rewrite clears the other rungs' selection, looping between them.
export const isSameSelection = (local: Node[], stored: Node[] | undefined): boolean => {
  const storedIds = new Set((stored ?? []).map((node) => node.id))
  return local.length === storedIds.size && local.every((node) => storedIds.has(node.id))
}

// The stored selection tracks which nodes are selected; their current data lives in the rung's nodes.
export const resolveSelectedNodes = <T extends Node>(rung: { nodes: T[]; selectedNodes?: Node[] }): T[] => {
  const selectedIds = new Set((rung.selectedNodes ?? []).map((node) => node.id))
  return rung.nodes.filter((node) => selectedIds.has(node.id))
}
