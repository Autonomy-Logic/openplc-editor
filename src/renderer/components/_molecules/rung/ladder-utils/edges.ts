import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { getPreviousElement } from './elements'
import { isNodeOfType } from './nodes'

type ConnectionOptions = {
  sourceHandle?: string
  targetHandle?: string
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

const removeEdge = (edges: Edge[], edgeId: string): Edge[] => {
  return edges.filter((edge) => edge.id !== edgeId)
}

export const connectNodes = (
  rung: FlowState,
  sourceNodeId: string,
  targetNodeId: string,
  type: 'serial' | 'parallel',
  options?: ConnectionOptions,
): Edge[] => {
  console.log('sourceNodeId', sourceNodeId)
  console.log('targetNodeId', targetNodeId)

  // Find the source edge
  const sourceNode = rung.nodes.find((node) => node.id === sourceNodeId) as Node
  const sourceEdge = rung.edges.find(
    (edge) =>
      edge.source === sourceNodeId &&
      (type === 'parallel' && isNodeOfType(sourceNode, 'parallel')
        ? edge.sourceHandle === (sourceNode as ParallelNode).data.parallelOutputConnector?.id
        : edge.sourceHandle === (sourceNode.data as BasicNodeData).outputConnector?.id),
  )

  console.log('sourceEdge', sourceEdge)

  const targetNode = rung.nodes.find((node) => node.id === targetNodeId)
  const targetNodeData = targetNode?.data as BasicNodeData

  /**
   * targetHandle: where the the sourceEdge connects to targetNode
   * sourceHandle: where the targetNode connects to the previous sourceEdge target
   */
  const targetHandle = !options ? targetNodeData.inputConnector?.id : options.targetHandle
  const sourceHandle = !options ? targetNodeData.outputConnector?.id : options.sourceHandle

  console.log('targetHandle', targetHandle)
  console.log('sourceHandle', sourceHandle)

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)
    // Update the target of the source edge
    edges.push(
      buildEdge(sourceNodeId, targetNodeId, {
        sourceHandle: sourceEdge.sourceHandle ?? undefined,
        targetHandle: targetHandle,
      }),
    )
    // Update the target of the target edge
    edges.push(
      buildEdge(targetNodeId, sourceEdge.target, {
        sourceHandle: sourceHandle,
        targetHandle: sourceEdge.targetHandle ?? undefined,
      }),
    )
    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId, { sourceHandle, targetHandle })]
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
    newEdges.push(
      buildEdge(sourceEdge.source, targetEdge.target, {
        sourceHandle: sourceEdge.sourceHandle ?? undefined,
        targetHandle: targetEdge.targetHandle ?? undefined,
      }),
    )
  }

  return newEdges
}

export const disconnectParallel = (rung: FlowState, parallelNodeId: string): { nodes: Node[]; edges: Edge[] } => {
  const selectedParallel = rung.nodes.find((node) => node.id === parallelNodeId) as ParallelNode
  if (!selectedParallel) return { nodes: rung.nodes, edges: rung.edges }

  let openParallel: ParallelNode
  let closeParallel: ParallelNode

  if (selectedParallel.data.type === 'open') {
    openParallel = selectedParallel
    closeParallel = rung.nodes.find((node) => node.id === selectedParallel.data.parallelCloseReference) as ParallelNode
  } else {
    closeParallel = selectedParallel
    openParallel = rung.nodes.find((node) => node.id === selectedParallel.data.parallelOpenReference) as ParallelNode
  }
  console.log('openParallel', openParallel)
  console.log('closeParallel', closeParallel)

  const newNodes = rung.nodes.filter((node) => node.id !== openParallel.id && node.id !== closeParallel.id)

  /**
   * Remove the edges that connect the openParallel and closeParallel
   */
  const openParallelConnection = rung.edges.find(
    (edge) => edge.source === openParallel.id && edge.sourceHandle === openParallel.data.parallelOutputConnector?.id,
  )
  console.log('openParallelConnection', openParallelConnection)
  let newEdges = removeEdge(rung.edges, openParallelConnection?.id ?? '')
  console.log('newEdges', newEdges)
  const closeParallelConnection = rung.edges.find(
    (edge) => edge.target === closeParallel.id && edge.targetHandle === closeParallel.data.parallelInputConnector?.id,
  )
  console.log('closeParallelConnection', closeParallelConnection)
  newEdges = removeEdge(newEdges, closeParallelConnection?.id ?? '')
  console.log('newEdges', newEdges)
  /**
   * Remove the serial connection between the openParallel and closeParallel
   */
  const openSerialConnection = rung.edges.find(
    (edge) => edge.source === openParallel.id && edge.sourceHandle !== openParallel.data.parallelOutputConnector?.id,
  )
  console.log('openSerialConnection', openSerialConnection)
  newEdges = removeEdge(newEdges, openSerialConnection?.id ?? '')
  console.log('newEdges', newEdges)
  const closeSerialConnection = rung.edges.find(
    (edge) => edge.target === closeParallel.id && edge.targetHandle !== closeParallel.data.parallelInputConnector?.id,
  )
  console.log('closeSerialConnection', closeSerialConnection)
  newEdges = removeEdge(newEdges, closeSerialConnection?.id ?? '')
  console.log('newEdges', newEdges)

  /**
   * TODO: Find the nodes inside the parallel and serial to relocate them
   */

  /**
   * Reconnect the node before the openParallel to the node after the closeParallel
   */
  const openTargetConnection = rung.edges.find((edge) => edge.target === openParallel.id)
  const closeSourceConnection = rung.edges.find((edge) => edge.source === closeParallel.id)
  newEdges = removeEdge(newEdges, openTargetConnection?.id ?? '')
  newEdges = removeEdge(newEdges, closeSourceConnection?.id ?? '')
  newEdges = connectNodes(
    {
      ...rung,
      edges: newEdges,
      nodes: newNodes,
    },
    openTargetConnection?.source ?? '',
    closeSourceConnection?.target ?? '',
    'serial',
    {
      sourceHandle: openTargetConnection?.sourceHandle ?? undefined,
      targetHandle: closeSourceConnection?.targetHandle ?? undefined,
    },
  )

  return { nodes: newNodes, edges: newEdges }
}

export const rearrangeConnections = (rung: FlowState): Edge[] => {
  const { nodes } = rung

  const newEdges: Edge[] = []

  nodes.forEach((node, index) => {
    if (node.id === 'left-rail') return

    const prevNode = getPreviousElement(nodes, index)
    const edge = buildEdge(prevNode.id, node.id)

    newEdges.push(edge)
  })

  return newEdges
}
