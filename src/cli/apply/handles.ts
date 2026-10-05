/**
 * Check that every edge names a handle the node it points at actually declares.
 *
 * React Flow drops an edge whose handle id is not on the node, logs a warning
 * and renders the diagram without that wire. Nothing else catches it: the
 * transpilers walk node/edge topology rather than handle ids, so the generated
 * ST is correct while the diagram is visibly broken.
 */

import type { Edge, Node } from '@xyflow/react'

interface Handle {
  id?: string | null
  type?: string
}

function handlesOf(node: Node): Handle[] {
  const data = node.data as { handles?: Handle[] } | undefined
  return data?.handles ?? []
}

/** One message per unresolved end, in the spec's own vocabulary. */
export function unresolvedHandles(nodes: readonly Node[], edges: readonly Edge[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const problems: string[] = []

  for (const edge of edges) {
    for (const [nodeId, handleId, direction] of [
      [edge.source, edge.sourceHandle, 'source'],
      [edge.target, edge.targetHandle, 'target'],
    ] as const) {
      const node = byId.get(nodeId)
      if (!node) {
        problems.push(`edge "${edge.id}" names a node "${nodeId}" that is not in the rung`)
        continue
      }
      const handles = handlesOf(node)
      // A node builder that declares no handles at all is a different failure —
      // reporting every edge against it would bury the real one.
      if (handles.length === 0) continue
      if (handles.some((handle) => handle.id === handleId)) continue

      const declared = handles.map((handle) => String(handle.id)).join(', ')
      problems.push(
        `edge "${edge.id}": ${direction} node "${nodeId}" has no handle "${String(handleId)}" (it has: ${declared})`,
      )
    }
  }
  return problems
}
