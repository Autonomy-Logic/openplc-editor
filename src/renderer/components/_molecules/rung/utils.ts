import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import { CustomHandleProps } from '../../_atoms/react-flow/custom-nodes/handle'

/**
 * EDGES
 */
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

/**
 * NODES
 */

export const changePowerRailBounds = ({
  rung,
  nodes,
  gapNodes,
  defaultBounds,
}: {
  rung: FlowState
  nodes: Node[]
  gapNodes: number
  defaultBounds: [number, number]
}): Node | undefined => {
  const rightPowerRailNode = rung.nodes.find((node) => node.id === 'right-rail') as Node
  if (!rightPowerRailNode) return undefined

  const handles = rightPowerRailNode.data.handles as CustomHandleProps[]
  const nodeBounds = getNodesBounds(nodes)

  // If the width of the nodes is greater than the default bounds, update the right power rail node
  if (nodeBounds.width + gapNodes > defaultBounds[0]) {
    const newRail = {
      ...rightPowerRailNode,
      position: { x: nodeBounds.width + gapNodes, y: rightPowerRailNode.position.y },
      data: {
        ...rightPowerRailNode.data,
        handles: handles.map((handle) => ({ ...handle, x: nodeBounds.width + gapNodes })),
      },
    }
    return newRail
  }

  // If the width of the nodes is less than the default bounds, update the right power rail node to the default bounds
  const newRail = {
    ...rightPowerRailNode,
    position: { x: defaultBounds[0] - (rightPowerRailNode.width ?? 0), y: rightPowerRailNode.position.y },
    data: {
      ...rightPowerRailNode.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - (rightPowerRailNode.width ?? 0) })),
    },
  }

  return newRail
}
