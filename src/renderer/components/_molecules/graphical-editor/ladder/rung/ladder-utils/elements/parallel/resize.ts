import type { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import type { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { buildEdge, removeEdge } from '../../edges'
import { updateDiagramElementsPosition } from '../diagram'
import { getNodesInsideParallel } from '../utils'

/**
 * Handle the resize of a parallel node (close parallel only)
 * This function updates the position of the close parallel node and reconnects edges
 * based on which elements should be inside vs. outside the branch
 *
 * @param rung - The current rung state
 * @param closeParallelNode - The close parallel node being resized
 * @param newX - The new X position for the close parallel node
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const resizeParallelBranch = (
  rung: RungLadderState,
  closeParallelNode: ParallelNode,
  newX: number,
): { nodes: Node[]; edges: Edge[] } => {
  const newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  const openParallelNode = newNodes.find((n) => n.id === closeParallelNode.data.parallelOpenReference) as ParallelNode
  if (!openParallelNode) return { nodes: newNodes, edges: newEdges }

  console.log('[resizeParallelBranch] before', {
    openX: openParallelNode.position.x,
    openWidth: openParallelNode.width,
    closeX: closeParallelNode.position.x,
    newX,
  })

  const { serial: serialNodes, parallel: parallelNodes } = getNodesInsideParallel(
    { ...rung, nodes: newNodes, edges: newEdges },
    closeParallelNode,
  )

  console.log('[resizeParallelBranch] candidates', {
    serial: serialNodes.map((n) => ({ id: n.id, x: n.position.x, width: n.width })),
    parallel: parallelNodes.map((n) => ({ id: n.id, x: n.position.x, width: n.width })),
  })

  const minX = openParallelNode.position.x + (openParallelNode.width ?? 0) + 50
  const constrainedX = Math.max(minX, newX)

  console.log('[resizeParallelBranch] constraints', {
    minX,
    constrainedX,
    wasConstrained: constrainedX !== newX,
  })

  const closeParallelIndex = newNodes.findIndex((n) => n.id === closeParallelNode.id)
  if (closeParallelIndex === -1) return { nodes: newNodes, edges: newEdges }

  newNodes[closeParallelIndex] = {
    ...closeParallelNode,
    position: {
      x: constrainedX,
      y: closeParallelNode.position.y,
    },
  }

  const allNodesInRange = [...serialNodes, ...parallelNodes]
  const nodesInsideBranch: Node[] = []
  const nodesOutsideBranch: Node[] = []

  allNodesInRange.forEach((node) => {
    const nodeRightEdge = node.position.x + (node.width ?? 0)
    if (nodeRightEdge < constrainedX) {
      nodesInsideBranch.push(node)
    } else {
      nodesOutsideBranch.push(node)
    }
  })

  console.log('[resizeParallelBranch] classification', {
    inside: nodesInsideBranch.map((n) => ({ id: n.id, rightEdge: n.position.x + (n.width ?? 0) })),
    outside: nodesOutsideBranch.map((n) => ({ id: n.id, rightEdge: n.position.x + (n.width ?? 0) })),
  })

  const edgesToRemove = newEdges.filter(
    (edge) => edge.target === closeParallelNode.id || edge.source === closeParallelNode.id,
  )
  edgesToRemove.forEach((edge) => {
    newEdges = removeEdge(newEdges, edge.id)
  })

  if (serialNodes.length > 0) {
    const lastSerialNode = serialNodes[serialNodes.length - 1]
    if (nodesInsideBranch.includes(lastSerialNode)) {
      newEdges.push(
        buildEdge(lastSerialNode.id, closeParallelNode.id, {
          sourceHandle: (lastSerialNode.data as BasicNodeData).outputConnector?.id,
          targetHandle: closeParallelNode.data.inputConnector?.id,
        }),
      )
    } else {
      newEdges.push(
        buildEdge(openParallelNode.id, lastSerialNode.id, {
          sourceHandle: openParallelNode.data.outputConnector?.id,
          targetHandle: (lastSerialNode.data as BasicNodeData).inputConnector?.id,
        }),
      )
    }
  } else {
    newEdges.push(
      buildEdge(openParallelNode.id, closeParallelNode.id, {
        sourceHandle: openParallelNode.data.outputConnector?.id,
        targetHandle: closeParallelNode.data.inputConnector?.id,
      }),
    )
  }

  if (parallelNodes.length > 0) {
    const lastParallelNode = parallelNodes[parallelNodes.length - 1]
    if (nodesInsideBranch.includes(lastParallelNode)) {
      newEdges.push(
        buildEdge(lastParallelNode.id, closeParallelNode.id, {
          sourceHandle: (lastParallelNode.data as BasicNodeData).outputConnector?.id,
          targetHandle: closeParallelNode.data.parallelInputConnector?.id,
        }),
      )
    } else {
      newEdges.push(
        buildEdge(openParallelNode.id, lastParallelNode.id, {
          sourceHandle: openParallelNode.data.parallelOutputConnector?.id,
          targetHandle: (lastParallelNode.data as BasicNodeData).inputConnector?.id,
        }),
      )
    }
  } else {
    newEdges.push(
      buildEdge(openParallelNode.id, closeParallelNode.id, {
        sourceHandle: openParallelNode.data.parallelOutputConnector?.id,
        targetHandle: closeParallelNode.data.parallelInputConnector?.id,
      }),
    )
  }

  const originalEdgesAfterClose = rung.edges.filter((edge) => edge.source === closeParallelNode.id)
  if (originalEdgesAfterClose.length > 0) {
    const nextNodeId = originalEdgesAfterClose[0].target
    newEdges.push(
      buildEdge(closeParallelNode.id, nextNodeId, {
        sourceHandle: closeParallelNode.data.outputConnector?.id,
        targetHandle: originalEdgesAfterClose[0].targetHandle ?? undefined,
      }),
    )
  }

  const { nodes: updatedNodes, edges: updatedEdges } = updateDiagramElementsPosition(
    { ...rung, nodes: newNodes, edges: newEdges },
    rung.defaultBounds as [number, number],
  )

  return { nodes: updatedNodes, edges: updatedEdges }
}
