import type { FlowState } from '@root/renderer/store/slices'
import type { Edge } from '@xyflow/react'

const buildEdge = (sourceNodeId: string, targetNodeId: string): Edge => {
  return {
    id: `e_${sourceNodeId}_${targetNodeId}`,
    source: sourceNodeId,
    target: targetNodeId,
    type: 'step',
  }
}

const removeEdge = (edges: Edge[], edgeId: string): Edge[] => {
  return edges.filter((edge) => edge.id !== edgeId)
}

export const connectNodes = (rung: FlowState, sourceNodeId: string, targetNodeId: string): Edge[] => {
  // Find the source edge
  const sourceEdge = rung.edges.find((edge) => edge.source === sourceNodeId)

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)
    // Update the target of the source edge
    edges.push(buildEdge(sourceNodeId, targetNodeId))
    // Update the target of the target edge
    edges.push(buildEdge(targetNodeId, sourceEdge.target))
    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId)]
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
