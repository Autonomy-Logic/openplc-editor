import type { CustomHandleProps } from '@root/renderer/components/_atoms/react-flow/custom-nodes/handle'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { getDefaultNodeStyle, isNodeOfType } from '../../nodes'

/**
 * Get the previous element by searching with edge in the rung
 *
 * @param rung: RungState
 * @param node: Node
 *
 * @returns obj: { serial: Node[], parallel: Node[] }
 */
export const getPreviousElementsByEdge = (
  rung: RungState,
  node: Node,
): { nodes: { serial: Node[]; parallel: Node[] }; edges: Edge[] } => {
  const { edges } = rung
  const lastNodes: { nodes: { serial: Node[]; parallel: Node[] }; edges: Edge[] } = {
    nodes: { serial: [], parallel: [] },
    edges: [],
  }

  // Get the connected edges to the node
  const connectedEdges = edges.filter((e) => e.target === node.id)
  // If there is no connected edges, return the last nodes
  if (connectedEdges.length === 0) {
    return lastNodes
  }

  connectedEdges.forEach((e) => {
    // Find the source of the edge
    const n = rung.nodes.find((n) => n.id === e.source)
    /**
     * If the node is undefined or an variable, skip it
     */
    if (!n || n.type === 'variable') return

    /**
     * If there is a parallel node, check if it is an open or close parallel
     * If it is a close parallel, add it to the parallel nodes
     */
    if (
      isNodeOfType(node, 'parallel') &&
      (node as ParallelNode).data.type === 'close' &&
      e.targetHandle === (node as ParallelNode).data.parallelInputConnector?.id
    ) {
      lastNodes.nodes.parallel.push(n)
      return
    }

    lastNodes.nodes.serial.push(n)
  })
  lastNodes.edges = connectedEdges

  return lastNodes
}

/**
 * Get the previous node when adding a new element
 * It works when removing the placeholder and variables elements
 *
 * @param rung: RungState
 * @param nodeIndex: number
 *
 * @returns Node
 */
export const getPreviousElement = (rung: RungState, nodeIndex: number): Node => {
  const nodesWithNoPlaceholderAndVariables = rung.nodes.filter(
    (n) => n.type !== 'placeholder' && n.type !== 'parallelPlaceholder' && n.type !== 'variable',
  )
  return nodesWithNoPlaceholderAndVariables[nodeIndex - 1]
}

/**
 * Get the node position based on the placeholder node
 *
 * @param placeholderNode
 * @param newElement
 *
 * @returns obj: { posX, posY, handleX, handleY }
 */
export const getElementPositionBasedOnPlaceholderElement = (
  placeholderNode: Node,
  newElement: Node | string,
): {
  posX: number
  posY: number
  handleX: number
  handleY: number
} => {
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const placeholderHandles = placeholderNode.data.handles as CustomHandleProps[]
  const placeholderHandle = placeholderHandles[0]

  const position = {
    posX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    posY: placeholderHandle.glbPosition.y - newNodeStyle.handle.y,
    handleX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    handleY: placeholderHandle.glbPosition.y,
  }

  return position
}

/**
 * Get the node position based on the previous node
 *
 * @param previousElement
 * @param newElement
 * @param type: 'serial' | 'parallel'
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getNodePositionBasedOnPreviousNode = (
  previousElement: Node,
  newElement: string | Node,
  type: 'serial' | 'parallel',
): {
  posX: number
  posY: number
  handleX: number
  handleY: number
} => {
  const previousElementOutputHandle = (
    type === 'parallel'
      ? (previousElement as ParallelNode).data.parallelOutputConnector
      : previousElement.data.outputConnector
  ) as CustomHandleProps
  const previousElementStyle = getDefaultNodeStyle({ node: previousElement })
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const gap = previousElementStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const position = {
    posX: previousElement.position.x + previousElementStyle.width + gap,
    posY:
      previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? previousElement.position.y
        : previousElementOutputHandle.glbPosition.y - offsetY,
    handleX: previousElement.position.x + previousElementStyle.width + gap,
    handleY: previousElementOutputHandle.glbPosition.y,
  }

  return position
}
