import { checkIfElementIsNode, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import { connectNodes } from '../../edges'
import { buildGenericNode, isNodeOfType } from '../../nodes'
import { removePlaceholderElements } from '../placeholder'
import {
  getElementPositionBasedOnPlaceholderElement,
  getNodePositionBasedOnPreviousNode,
  getPreviousElementsByEdge,
} from '../utils'

/**
 * Start a parallel connection. The node will be created based on the node type, so it is going to be a new "clean" node
 *
 * @param rung
 * @param node - The node to be inserted in the parallel connection
 *    @param node.newElementType - The type of the new node
 *    @param node.blockType - The block type of the new node
 * @param placeholder - The placeholder node that will be replaced by the new node
 *    @param placeholder.selectedPlaceholder - The placeholder node
 *    @param placeholder.selectedPlaceholderIndex - The index of the placeholder node
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const startParallelConnection = <T>(
  rung: RungState,
  placeholder: { index: number; selected: PlaceholderNode },
  node: Node | { elementType: string; blockVariant?: T },
): { nodes: Node[]; edges: Edge[] } => {
  console.log('\tstartParallelConnection:', rung, placeholder, node)

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Get the element above the selected placeholder and the edges
   */
  const aboveElement = placeholder.selected.data.relatedNode as Node
  if (!aboveElement) return { nodes: newNodes, edges: newEdges }
  const aboveElementTargetEdges = newEdges.filter((edge) => edge.target === aboveElement.id)
  const aboveElementSourceEdges = newEdges.filter((edge) => edge.source === aboveElement.id)
  if (!aboveElementTargetEdges || !aboveElementSourceEdges) return { nodes: newNodes, edges: newEdges }

  /**
   * Build the parallel open node based on the node that antecede the above node
   * or the above node itself
   */
  const openParallelPosition = getNodePositionBasedOnPreviousNode(
    newNodes.find((node) => node.id === aboveElementTargetEdges[0].source) ?? aboveElement,
    'parallel',
    'serial',
  )
  const openParallelElement = nodesBuilder.parallel({
    id: `PARALLEL_OPEN_${uuidv4()}`,
    type: 'open',
    posX: openParallelPosition.posX,
    posY: openParallelPosition.posY,
    handleX: openParallelPosition.handleX,
    handleY: openParallelPosition.handleY,
  })

  /**
   * Build the new element node
   */
  let newElement: Node<BasicNodeData> = {} as Node<BasicNodeData>
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
    }) as Node<BasicNodeData>
  } else {
    newElement = node as Node<BasicNodeData>
  }

  /**
   * Recreate the above element
   * After recreate, set the old data to the new element
   */
  const newAboveElementPosition = getNodePositionBasedOnPreviousNode(openParallelElement, aboveElement, 'serial')
  const buildedAboveElement = buildGenericNode({
    nodeType: aboveElement.type ?? '',
    blockType: aboveElement.data.blockType,
    id: `${aboveElement.type?.toUpperCase()}_${uuidv4()}`,
    ...newAboveElementPosition,
  })
  const newAboveElement = {
    ...buildedAboveElement,
    position: { x: newAboveElementPosition.posX, y: newAboveElementPosition.posY },
    data: {
      ...aboveElement.data,
      handles: buildedAboveElement.data.handles,
      inputConnector: buildedAboveElement.data.inputConnector,
      outputConnector: buildedAboveElement.data.outputConnector,
    },
  }
  console.log('\tnewAboveElement:', newAboveElement)

  /**
   * Build the close parallel node
   */
  const closeParallelPositionSerial = getNodePositionBasedOnPreviousNode(newElement, 'parallel', 'serial')
  const closeParallelPositionParallel = getNodePositionBasedOnPreviousNode(placeholder.selected, 'parallel', 'serial')
  const closeParallelElement = nodesBuilder.parallel({
    id: `PARALLEL_CLOSE_${uuidv4()}`,
    type: 'close',
    posX:
      closeParallelPositionSerial.posX > closeParallelPositionParallel.posX
        ? closeParallelPositionSerial.posX
        : closeParallelPositionParallel.posX,
    posY: closeParallelPositionSerial.posY,
    handleX:
      closeParallelPositionSerial.handleX > closeParallelPositionParallel.handleX
        ? closeParallelPositionSerial.handleX
        : closeParallelPositionParallel.handleX,
    handleY: closeParallelPositionSerial.handleY,
  })

  /**
   * Add reference between the open parallel and the close parallel node
   */
  openParallelElement.data.parallelCloseReference = closeParallelElement.id
  closeParallelElement.data.parallelOpenReference = openParallelElement.id

  /**
   * Get the related node of the placeholder
   */
  const relatedNode = placeholder.selected.data.relatedNode as Node
  const { nodes: relatedElementPreviousElements, edges: relatedElementPreviousEdges } = getPreviousElementsByEdge(
    { ...rung, nodes: newNodes, edges: newEdges },
    relatedNode,
  )
  if (!relatedElementPreviousElements || !relatedElementPreviousEdges) return { nodes: newNodes, edges: newEdges }

  /**
   * Insert the new element node
   */
  // first insert the new element
  newNodes.splice(placeholder.index, 1, openParallelElement, newAboveElement, newElement, closeParallelElement)
  // then remove the old above node
  console.log('\toldAboveElement:', aboveElement)
  newNodes = newNodes.filter((node) => node.id !== aboveElement.id)
  // finally remove the placeholder nodes
  newNodes = removePlaceholderElements(newNodes)

  /**
   * Create the new edges
   */
  // clear old edges of the above node
  newEdges = newEdges.filter((edge) => edge.source !== aboveElement.id && edge.target !== aboveElement.id)

  // serial connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    aboveElementTargetEdges[0].source,
    openParallelElement.id,
    relatedElementPreviousElements.serial.length > 0 &&
      isNodeOfType(relatedElementPreviousElements.serial[0], 'parallel') &&
      (relatedElementPreviousElements.serial[0] as ParallelNode).data.type === 'open' &&
      relatedElementPreviousEdges[0].sourceHandle ===
        (relatedElementPreviousElements.serial[0] as ParallelNode).data.parallelOutputConnector?.id
      ? 'parallel'
      : 'serial',
    {
      sourceHandle: aboveElementTargetEdges[0].sourceHandle ?? undefined,
      targetHandle: openParallelElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelElement.id,
    newAboveElement.id,
    'serial',
    {
      sourceHandle: openParallelElement.data.outputConnector?.id,
      targetHandle: newAboveElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newAboveElement.id,
    closeParallelElement.id,
    'serial',
    {
      sourceHandle: newAboveElement.data.outputConnector?.id,
      targetHandle: closeParallelElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    closeParallelElement.id,
    aboveElementSourceEdges[0].target,
    'serial',
    {
      sourceHandle: closeParallelElement.data.outputConnector?.id,
      targetHandle: aboveElementSourceEdges[0].targetHandle ?? undefined,
    },
  )

  // parallel connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelElement.id,
    newElement.id,
    'parallel',
    {
      sourceHandle: openParallelElement.data.parallelOutputConnector?.id,
      targetHandle: newElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newElement.id,
    closeParallelElement.id,
    'parallel',
    {
      sourceHandle: newElement.data.outputConnector?.id,
      targetHandle: closeParallelElement.data.parallelInputConnector?.id,
    },
  )

  return { nodes: newNodes, edges: newEdges }
}
