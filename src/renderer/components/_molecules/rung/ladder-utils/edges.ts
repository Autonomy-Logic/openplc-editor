import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { isNodeOfType } from './nodes'

type ConnectionOptions = {
  sourceHandle?: string
  targetHandle?: string
}

export const checkIfConnectedInParallel = (
  rung: FlowState,
  node: Node,
): { parentNode: Node; connectedInParallel: boolean } => {
  const connectedInParallel = rung.edges.filter((edge) => edge.target === node.id)
  const sourceNode = rung.nodes.find((node) => node.id === connectedInParallel[0].source) as Node
  return { parentNode: sourceNode, connectedInParallel: isNodeOfType(sourceNode, 'parallel') }
}

export const buildEdge = (sourceNodeId: string, targetNodeId: string, options?: ConnectionOptions): Edge => {
  return {
    id: `e_${sourceNodeId}_${targetNodeId}__${options?.sourceHandle}_${options?.targetHandle}`,
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle: options?.sourceHandle,
    targetHandle: options?.targetHandle,
  }
}

export const removeEdge = (edges: Edge[], edgeId: string): Edge[] => {
  return edges.filter((edge) => edge.id !== edgeId)
}

export const connectNodes = (
  rung: FlowState,
  sourceNodeId: string,
  targetNodeId: string,
  type: 'serial' | 'parallel',
  options?: ConnectionOptions,
): Edge[] => {
  // Find the source edge
  const sourceNode = rung.nodes.find((node) => node.id === sourceNodeId) as Node
  const sourceEdge = rung.edges.find(
    (edge) =>
      edge.source === sourceNodeId &&
      (type === 'parallel' && isNodeOfType(sourceNode, 'parallel')
        ? edge.sourceHandle === (sourceNode as ParallelNode).data.parallelOutputConnector?.id
        : edge.sourceHandle === (sourceNode.data as BasicNodeData).outputConnector?.id),
  )

  // console.log('sourceNode', sourceNode)
  // console.log('sourceEdge', sourceEdge)

  const targetNode = rung.nodes.find((node) => node.id === targetNodeId)
  const targetNodeData = targetNode?.data as BasicNodeData

  // console.log('targetNode', targetNode)

  /**
   * targetHandle: where the the sourceEdge connects to targetNode
   * sourceHandle: where the targetNode connects to the previous sourceEdge target
   */
  const targetHandle = !options ? targetNodeData.inputConnector?.id : options.targetHandle
  const sourceHandle = !options ? targetNodeData.outputConnector?.id : options.sourceHandle

  // console.log('target sourceHandle', sourceHandle)
  // console.log('target targetHandle', targetHandle)

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)
    // console.log('edges after remove source edge', edges)
    // Update the target of the source edge
    edges.push(
      buildEdge(sourceNodeId, targetNodeId, {
        sourceHandle: sourceEdge.sourceHandle ?? undefined,
        targetHandle: targetHandle,
      }),
    )
    // console.log('edges after update the target of the source edge', edges)
    // Update the target of the target edge
    edges.push(
      buildEdge(targetNodeId, sourceEdge.target, {
        sourceHandle: sourceHandle,
        targetHandle: sourceEdge.targetHandle ?? undefined,
      }),
    )
    // console.log('edges after update the target of the target edge', edges)
    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId, { sourceHandle, targetHandle })]
}

export const disconnectNodes = (
  rung: FlowState,
  sourceNodeId: string,
  targetNodeId: string,
  _options?: ConnectionOptions,
): Edge[] => {
  // sourceEdge -> edge that connect the source node
  // targetEdge -> edge that connect the target node
  const sourceEdge = rung.edges.find((edge) => edge.target === sourceNodeId)
  const targetEdge = rung.edges.find((edge) => edge.target === targetNodeId && edge.source === sourceNodeId)

  if (!sourceEdge) return rung.edges

  let newEdges = removeEdge(rung.edges, sourceEdge.id)

  if (targetEdge) {
    newEdges = removeEdge(newEdges, targetEdge.id)
    newEdges.push(
      buildEdge(sourceEdge.source, targetEdge.target, {
        sourceHandle: sourceEdge.sourceHandle ?? undefined,
        targetHandle: targetEdge.targetHandle ?? undefined,
      }),
    )
  }

  return newEdges
}
