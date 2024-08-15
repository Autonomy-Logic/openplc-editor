import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge } from '@xyflow/react'

type ConnectionOptions = {
  sourceHandle?: string
  targetHandle?: string
}

const buildEdge = (sourceNodeId: string, targetNodeId: string, options?: ConnectionOptions): Edge => {
  return {
    id: `e_${sourceNodeId}_${targetNodeId}`,
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: options?.sourceHandle,
    targetHandle: options?.targetHandle,
  }
}

const removeEdge = (edges: Edge[], edgeId: string): Edge[] => {
  return edges.filter((edge) => edge.id !== edgeId)
}

export const connectNodes = (
  rung: FlowState,
  sourceNodeId: string,
  targetNodeId: string,
  options?: ConnectionOptions,
): Edge[] => {
  // Find the source edge
  const sourceEdge = rung.edges.find(
    (edge) => edge.source === sourceNodeId && edge.sourceHandle === options?.sourceHandle,
  )

  const targetNode = rung.nodes.find((node) => node.id === targetNodeId)
  const targetNodeData = targetNode?.data as BasicNodeData

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)
    // Update the target of the source edge
    edges.push(
      buildEdge(sourceNodeId, targetNodeId, {
        sourceHandle: options?.sourceHandle,
        targetHandle: targetNodeData.inputConnector?.id ?? undefined,
      }),
    )
    // Update the target of the target edge
    edges.push(
      buildEdge(targetNodeId, sourceEdge.target, {
        sourceHandle: targetNodeData.outputConnector?.id ?? undefined,
        targetHandle: sourceEdge.targetHandle ?? undefined,
      }),
    )
    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId, options)]
}

export const disconnectNodes = (rung: FlowState, sourceNodeId: string, targetNodeId: string): Edge[] => {
  // sourceEdge -> edge that connect the source node
  // targetEdge -> edge that connect the target node
  const sourceEdge = rung.edges.find((edge) => edge.target === sourceNodeId)
  const targetEdge = rung.edges.find((edge) => edge.target === targetNodeId)

  if (!sourceEdge) return rung.edges

  let newEdges = removeEdge(rung.edges, sourceEdge.id)

  if (targetEdge) {
    newEdges = removeEdge(newEdges, targetEdge.id)
    newEdges.push(buildEdge(sourceEdge.source, targetEdge.target))
  }

  return newEdges
}
