import { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { isNodeOfType } from './nodes'

type ConnectionOptions = {
  sourceHandle?: string
  targetHandle?: string
}

export const checkIfConnectedInParallel = (
  rung: RungLadderState,
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
  rung: RungLadderState,
  sourceNodeId: string,
  targetNodeId: string,
  type: 'serial' | 'parallel',
  options?: ConnectionOptions,
): Edge[] => {
  // Find the source edge
  const sourceNode = rung.nodes.find((node) => node.id === sourceNodeId) as Node
  const sourceEdge = rung.edges.find((edge) => {
    return (
      edge.source === sourceNodeId &&
      (type === 'parallel' && isNodeOfType(sourceNode, 'parallel')
        ? edge.sourceHandle === (sourceNode as ParallelNode).data.parallelOutputConnector?.id
        : isNodeOfType(sourceNode, 'parallel') && sourceNode.data.type === 'close'
          ? edge.sourceHandle === (sourceNode as ParallelNode).data.outputConnector?.id ||
            (sourceNode as ParallelNode).data.parallelOutputConnector?.id
          : edge.sourceHandle === (sourceNode.data as BasicNodeData).outputConnector?.id)
    )
  })

  const targetNode = rung.nodes.find((node) => node.id === targetNodeId)
  const targetNodeData = targetNode?.data as BasicNodeData

  /**
   * targetHandle: where the the sourceEdge connects to targetNode
   * sourceHandle: where the targetNode connects to the previous sourceEdge target
   */
  const targetHandle = !options ? targetNodeData.inputConnector?.id : options.targetHandle
  const sourceHandle = !options ? targetNodeData.outputConnector?.id : options.sourceHandle

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)

    // If source node is a parallel and the operation type is serial, lets check if we need to update the source handle
    let newSourceHandle = sourceEdge.sourceHandle ?? undefined
    if (type === 'serial' && isNodeOfType(sourceNode, 'parallel')) {
      newSourceHandle = (sourceNode as ParallelNode).data.outputConnector?.id
    }

    // Update the target of the source edge
    edges.push(
      buildEdge(sourceNodeId, targetNodeId, {
        sourceHandle: newSourceHandle,
        targetHandle: targetHandle,
      }),
    )

    // Find the target edge node (target node connected to the source edge) to check if it is a parallel
    const sourceEdgeNodeTarget = rung.nodes.find((node) => node.id === sourceEdge?.target)

    // Update the target of the target edge
    if (
      sourceEdgeNodeTarget &&
      isNodeOfType(sourceEdgeNodeTarget, 'parallel') &&
      (sourceEdgeNodeTarget as ParallelNode).data.type === 'open'
    ) {
      const newTargetHandle = (sourceEdgeNodeTarget as ParallelNode).data.inputConnector?.id

      edges.push(
        buildEdge(targetNodeId, sourceEdge.target, {
          sourceHandle: sourceHandle,
          targetHandle: newTargetHandle,
        }),
      )
    } else {
      edges.push(
        buildEdge(targetNodeId, sourceEdge.target, {
          sourceHandle: sourceHandle,
          targetHandle: sourceEdge.targetHandle ?? undefined,
        }),
      )
    }

    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId, { sourceHandle, targetHandle })]
}

export const disconnectNodes = (
  rung: RungLadderState,
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
