import { checkIfElementIsNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import type { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import { connectNodes } from '../../edges'
import { buildGenericNode, isNodeOfType } from '../../nodes'
import { removePlaceholderElements } from '../placeholder'
import { getElementPositionBasedOnPlaceholderElement, getPreviousElement, getPreviousElementsByEdge } from '../utils'

export const appendSerialConnection = <T>(
  rung: RungState,
  placeholder: {
    index: number
    selected: PlaceholderNode
  },
  node: Node | { elementType: string; blockVariant?: T },
): { nodes: Node[]; edges: Edge[]; newNode?: Node } => {
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Build the new element correctly
   */
  let newElement: Node = {} as Node
  if (!checkIfElementIsNode(node)) {
    const newElementPosition = getElementPositionBasedOnPlaceholderElement(
      placeholder.selected as Node,
      node.elementType,
    )
    newElement = buildGenericNode({
      nodeType: node.elementType,
      blockType: node.blockVariant,
      id: `${node.elementType.toUpperCase()}_${uuidv4()}`,
      ...newElementPosition,
    })
  } else {
    newElement = node
  }

  newNodes.splice(placeholder.index, 1, newElement)
  newNodes = removePlaceholderElements(newNodes)


  /**
   * Get the related element of the placeholder
   *   If there is no related element, return the new nodes and edges
   * Get the previous elements (based on the related node)
   */
  const relatedNode = placeholder.selected.data.relatedNode as Node
  const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdge(
    { ...rung, nodes: newNodes, edges: newEdges },
    relatedNode,
  )
  if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

  /**
   * Get the previous node
   */
  let previousNode = getPreviousElement(
    { ...rung, nodes: newNodes, edges: newEdges },
    newNodes.findIndex((n) => n.id === newElement.id),
  )

  /**
   * If the related node is a parallel, check if it is an open or close parallel
   *    If it is an open parallel, check if the new element is being added to the left
   *    If it is, connect the new element to the parallel node
   * If it is not a parallel, connect the new element to the previous node
   */
  if (
    // Check if there is serial previous nodes
    relatedNodePreviousNodes.serial.length > 0 &&
    // Check if the node is a open parallel node
    isNodeOfType(relatedNodePreviousNodes.serial[0], 'parallel') &&
    (relatedNodePreviousNodes.serial[0] as ParallelNode).data.type === 'open' &&
    // If it is, check if the new element is being added to the left
    placeholder.selected.data.position === 'left' &&
    // If it is, check if the new element is being added to the parallel output connector
    relatedNodePreviousEdges[0].sourceHandle ===
      (relatedNodePreviousNodes.serial[0] as ParallelNode).data.parallelOutputConnector?.id
  ) {
    previousNode = relatedNodePreviousNodes.serial[0]
    newEdges = connectNodes({ ...rung, nodes: newNodes, edges: newEdges }, previousNode.id, newElement.id, 'parallel')
  } else {
    newEdges = connectNodes({ ...rung, nodes: newNodes, edges: newEdges }, previousNode.id, newElement.id, 'serial')
  }

  return { nodes: newNodes, edges: newEdges, newNode: newElement }
}
