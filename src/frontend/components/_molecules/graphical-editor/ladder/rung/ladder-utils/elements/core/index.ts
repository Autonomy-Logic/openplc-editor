import type { Edge, Node } from '@xyflow/react'

import type { BasicNodeData, ParallelNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge } from '../../edges'

/**
 * Splice an existing edge and insert a new node in its place.
 * Removes `oldEdge` and creates two new edges:
 *   oldEdge.source[sourceHandle] → newNode[inputHandle]
 *   newNode[outputHandle] → oldEdge.target[targetHandle]
 */
export function spliceEdgeAndInsertNode(
  edges: Edge[],
  oldEdge: Edge,
  newNodeId: string,
  newNodeInputHandle: string,
  newNodeOutputHandle: string,
): Edge[] {
  const filtered = edges.filter((e) => e.id !== oldEdge.id)

  filtered.push(
    buildEdge(oldEdge.source, newNodeId, {
      sourceHandle: oldEdge.sourceHandle ?? undefined,
      targetHandle: newNodeInputHandle,
    }),
  )
  filtered.push(
    buildEdge(newNodeId, oldEdge.target, {
      sourceHandle: newNodeOutputHandle,
      targetHandle: oldEdge.targetHandle ?? undefined,
    }),
  )

  return filtered
}

/**
 * Find an edge connected to an anchor node and splice a new node into the chain.
 * Handles both left (insert before anchor) and right (insert after anchor) positions.
 *
 * - `left`: finds the edge targeting the anchor, inserts newNode before anchor
 * - `right`: finds the edge sourced from anchor's outputConnector, inserts newNode after anchor
 *
 * Returns the updated edges array, or `null` if no matching edge was found.
 */
export function spliceNodeIntoEdgeChain(
  edges: Edge[],
  anchorNodeId: string,
  anchorNode: Node,
  position: 'left' | 'right',
  newNode: Node,
): Edge[] | null {
  const newData = newNode.data as BasicNodeData
  const inputHandle = newData.inputConnector?.id ?? 'input'
  const outputHandle = newData.outputConnector?.id ?? 'output'

  if (position === 'left') {
    const edgeToSplit = edges.find((e) => e.target === anchorNodeId)
    if (!edgeToSplit) return null
    return spliceEdgeAndInsertNode(edges, edgeToSplit, newNode.id, inputHandle, outputHandle)
  }

  // position === 'right'
  const anchorData = anchorNode.data as BasicNodeData
  const edgeToSplit = edges.find((e) => e.source === anchorNodeId && e.sourceHandle === anchorData.outputConnector?.id)
  if (!edgeToSplit) return null

  const filtered = edges.filter((e) => e.id !== edgeToSplit.id)
  filtered.push(
    buildEdge(anchorNodeId, newNode.id, {
      sourceHandle: edgeToSplit.sourceHandle ?? undefined,
      targetHandle: inputHandle,
    }),
  )
  filtered.push(
    buildEdge(newNode.id, edgeToSplit.target, {
      sourceHandle: outputHandle,
      targetHandle: edgeToSplit.targetHandle ?? undefined,
    }),
  )

  return filtered
}

/**
 * Wire a parallel (OPEN/CLOSE) structure around an existing element.
 *
 * Creates the 6-edge pattern:
 *   predecessor → OPEN → aboveElement → CLOSE → successor   (serial path)
 *                 OPEN → newElement    → CLOSE               (parallel path)
 *
 * Returns the IDs of edges to remove and the new edges to add.
 *
 * Optional `openTargetHandle` / `closeSourceHandle` override the OPEN's receiving
 * handle and CLOSE's sending handle for nested parallel cases.
 */
export function wireParallelAroundElement(params: {
  incomingEdge: Edge
  outgoingEdge: Edge
  openParallel: Node
  closeParallel: Node
  aboveElement: Node
  newElement: Node
  openTargetHandle?: string
  closeSourceHandle?: string
}): {
  edgesToRemove: string[]
  edgesToAdd: Edge[]
} {
  const { incomingEdge, outgoingEdge, openParallel, closeParallel, aboveElement, newElement } = params

  const openData = openParallel.data as ParallelNode['data']
  const closeData = closeParallel.data as ParallelNode['data']
  const aboveData = aboveElement.data as BasicNodeData
  const newData = newElement.data as BasicNodeData

  const edgesToRemove = [incomingEdge.id, outgoingEdge.id]
  const edgesToAdd: Edge[] = []

  // 1. Predecessor → OPEN (preserves boundary sourceHandle from incoming edge)
  edgesToAdd.push(
    buildEdge(incomingEdge.source, openParallel.id, {
      sourceHandle: incomingEdge.sourceHandle ?? undefined,
      targetHandle: params.openTargetHandle ?? openData.inputConnector?.id,
    }),
  )

  // 2. Serial: OPEN → aboveElement
  edgesToAdd.push(
    buildEdge(openParallel.id, aboveElement.id, {
      sourceHandle: openData.outputConnector?.id,
      targetHandle: aboveData.inputConnector?.id,
    }),
  )

  // 3. Serial: aboveElement → CLOSE
  edgesToAdd.push(
    buildEdge(aboveElement.id, closeParallel.id, {
      sourceHandle: aboveData.outputConnector?.id,
      targetHandle: closeData.inputConnector?.id,
    }),
  )

  // 4. Parallel: OPEN → newElement
  edgesToAdd.push(
    buildEdge(openParallel.id, newElement.id, {
      sourceHandle: openData.parallelOutputConnector?.id,
      targetHandle: newData.inputConnector?.id,
    }),
  )

  // 5. Parallel: newElement → CLOSE
  edgesToAdd.push(
    buildEdge(newElement.id, closeParallel.id, {
      sourceHandle: newData.outputConnector?.id,
      targetHandle: closeData.parallelInputConnector?.id,
    }),
  )

  // 6. CLOSE → successor (preserves boundary targetHandle from outgoing edge)
  edgesToAdd.push(
    buildEdge(closeParallel.id, outgoingEdge.target, {
      sourceHandle: params.closeSourceHandle ?? closeData.outputConnector?.id,
      targetHandle: outgoingEdge.targetHandle ?? undefined,
    }),
  )

  return { edgesToRemove, edgesToAdd }
}
