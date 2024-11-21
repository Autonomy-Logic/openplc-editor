import { CustomHandleProps } from '@root/renderer/components/_atoms/react-flow/custom-nodes/handle'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { RungState } from '@root/renderer/store/slices'
import { Edge, Node } from '@xyflow/react'

import { getDefaultNodeStyle } from '../../nodes'

/**
 * Get the previous element in the rung
 *
 * @param nodes
 * @param nodeIndex
 *
 * @returns { Node | undefined }
 */
export const getPreviousElement = (nodes: Node[], nodeIndex?: number) => {
  return nodes[(nodeIndex ?? nodes.length - 1) - 1]
}

/**
 * Get the previous elements by edges
 *
 * @param rung
 * @param node
 *
 * @returns { nodes, edges }
 */
export const getPreviousElementsByEdges = (
  rung: RungState,
  node: Node,
): { nodes: Node[] | undefined; edges: Edge[] | undefined } => {
  const edges = rung.edges.filter((edge) => edge.target === node.id)
  if (!edges) return { nodes: undefined, edges: undefined }
  const previousNodes = rung.nodes.filter((n) => edges.map((edge) => edge.source).includes(n.id))
  if (!previousNodes) return { nodes: undefined, edges: edges }
  return { nodes: previousNodes, edges: edges }
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
) => {
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

/**
 * Get the node position based on the placeholder node
 *
 * @param placeholderNode
 * @param newElement
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getNodePositionBasedOnPlaceholderNode = (placeholderNode: Node, newElement: string | Node) => {
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
 * Get the placeholder position based on the node
 *
 * @param node
 * @param side: 'left' | 'bottom' | 'right'
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getPlaceholderPositionBasedOnNode = (node: Node, side: 'left' | 'bottom' | 'right') => {
  switch (side) {
    case 'left':
      return {
        posX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY: ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'right':
      return {
        posX:
          node.position.x +
          getDefaultNodeStyle({ node }).width +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x +
          getDefaultNodeStyle({ node }).width +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width,
        handleY: ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'bottom':
      return {
        posX:
          node.position.x +
          getDefaultNodeStyle({ node }).width / 2 -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          node.position.y +
          (node?.height ?? 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
        handleX:
          node.position.x +
          getDefaultNodeStyle({ node }).width / 2 -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY:
          node.position.y +
          (node?.height ?? 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
      }
  }
}
