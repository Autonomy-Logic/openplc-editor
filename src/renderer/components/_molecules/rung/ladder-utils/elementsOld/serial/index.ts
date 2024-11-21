import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { RungState } from '@root/renderer/store/slices'
import { Edge, Node } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import { connectNodes } from '../../edges'
import { buildGenericNode, isNodeOfType } from '../../nodes'
import { removePlaceholderNodes } from '../index'
import { getNodePositionBasedOnPlaceholderNode, getPreviousElement, getPreviousElementsByEdges } from '../utils'

/**
 * Append a serial connection by node type. The node will be created based on the node type, so it is going to be a new "clean" node
 *
 * @param rung
 * @param node
 *    @param node.newElementType
 *    @param node.blockType
 * @param placeholder
 *    @param placeholder.selectedPlaceholder
 *    @param placeholder.selectedPlaceholderIndex
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const appendSerialConnectionByNodeType = <T>(
  rung: RungState,
  node: { newElementType: string; blockType: T | undefined },
  placeholder: { selectedPlaceholder: Node; selectedPlaceholderIndex: string },
): { nodes: Node[]; edges: Edge[] } => {
  const { selectedPlaceholder, selectedPlaceholderIndex } = placeholder

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  const newElelementPosition = getNodePositionBasedOnPlaceholderNode(selectedPlaceholder, node.newElementType)
  const newElement = buildGenericNode({
    nodeType: node.newElementType,
    blockType: node.blockType,
    id: `${node.newElementType.toUpperCase()}_${uuidv4()}`,
    ...newElelementPosition,
  })
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, newElement)
  newNodes = removePlaceholderNodes(newNodes)

  // get the related node
  const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode as Node
  const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdges(
    { ...rung, nodes: newNodes },
    relatedNode,
  )
  if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

  // find the previous node
  let previousNode: Node = getPreviousElement(
    newNodes,
    newNodes.findIndex((n) => n.id === newElement.id),
  )

  // if the related node is a parallel, check if it is an open or close parallel
  if (
    relatedNodePreviousNodes.length > 0 &&
    isNodeOfType(relatedNodePreviousNodes[0], 'parallel') &&
    (relatedNodePreviousNodes[0] as ParallelNode).data.type === 'open' &&
    selectedPlaceholder.data.position === 'left' &&
    relatedNodePreviousEdges[0].sourceHandle ===
      (relatedNodePreviousNodes[0] as ParallelNode).data.parallelOutputConnector?.id
  ) {
    previousNode = relatedNodePreviousNodes[0]
    newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'parallel')
  } else {
    newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'serial')
  }

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Append a serial connection keeping the node. The node will be kept and the connection will be made with the selected placeholder
 *
 * @param rung
 * @param node
 * @param placeholder
 *    @param placeholder.selectedPlaceholder
 *    @param placeholder.selectedPlaceholderIndex
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const appendSerialConnectionKeepingTheNode = (
  rung: RungState,
  node: Node,
  placeholder: { selectedPlaceholder: Node; selectedPlaceholderIndex: string },
): { nodes: Node[]; edges: Edge[] } => {
  const { selectedPlaceholder, selectedPlaceholderIndex } = placeholder

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  const newElement = node
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, newElement)
  newNodes = removePlaceholderNodes(newNodes)

  // get the related node
  const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode as Node
  const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdges(
    { ...rung, nodes: newNodes },
    relatedNode,
  )
  if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

  // find the previous node
  let previousNode: Node = getPreviousElement(
    newNodes,
    newNodes.findIndex((n) => n.id === newElement.id),
  )

  // if the related node is a parallel, check if it is an open or close parallel
  if (
    relatedNodePreviousNodes.length > 0 &&
    isNodeOfType(relatedNodePreviousNodes[0], 'parallel') &&
    (relatedNodePreviousNodes[0] as ParallelNode).data.type === 'open' &&
    selectedPlaceholder.data.position === 'left' &&
    relatedNodePreviousEdges[0].sourceHandle ===
      (relatedNodePreviousNodes[0] as ParallelNode).data.parallelOutputConnector?.id
  ) {
    previousNode = relatedNodePreviousNodes[0]
    newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'parallel')
  } else {
    newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'serial')
  }

  return { nodes: newNodes, edges: newEdges }
}
