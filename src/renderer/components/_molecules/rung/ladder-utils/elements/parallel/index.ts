import { checkIfElementIsNode, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { BlockNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/block'
import type { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import type { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import { buildEdge, connectNodes, removeEdge } from '../../edges'
import { buildGenericNode, isNodeOfType, removeNode } from '../../nodes'
import { removePlaceholderElements } from '../placeholder'
import {
  getElementPositionBasedOnPlaceholderElement,
  getNodePositionBasedOnPreviousNode,
  getNodesInsideParallel,
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
): { nodes: Node[]; edges: Edge[]; newNode?: Node } => {

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Get the element above the selected placeholder and the edges
   */
  const aboveElement = placeholder.selected.data.relatedNode
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

  /**
   * Recreate the above element
   * After recreate, set the old data to the new element
   */
  const newAboveElementPosition = getNodePositionBasedOnPreviousNode(openParallelElement, aboveElement, 'serial')
  const buildedAboveElement =
    aboveElement.type !== 'block'
      ? buildGenericNode({
          nodeType: aboveElement.type ?? '',
          blockType: aboveElement.data.blockType,
          id: `${aboveElement.type?.toUpperCase()}_${uuidv4()}`,
          ...newAboveElementPosition,
        })
      : nodesBuilder.block({
          id: `${aboveElement.type?.toUpperCase()}_${uuidv4()}`,
          variant: (aboveElement.data as BlockNodeData<object>).variant,
          executionControl: (aboveElement.data as BlockNodeData<object>).executionControl,
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
  newNodes = removeNode({ ...rung, nodes: newNodes }, aboveElement.id)
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
      targetHandle: (newElement.data as BasicNodeData).inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newElement.id,
    closeParallelElement.id,
    'parallel',
    {
      sourceHandle: (newElement.data as BasicNodeData).outputConnector?.id,
      targetHandle: closeParallelElement.data.parallelInputConnector?.id,
    },
  )

  return { nodes: newNodes, edges: newEdges, newNode: newElement }
}

/**
 * Remove empty parallel connections.
 * - If the parallel connection is empty, remove the parallel connection and reconnect the nodes turning the parallel connection into serial.
 * - If the serial connection is empty, remove the serial connection and reconnect the nodes turning the parallel connection into serial.
 * - If the parallel connection is not empty, reconnect the nodes turning the parallel connection into serial.
 *
 * @param rung
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const removeEmptyParallelConnections = (rung: RungState): { nodes: Node[]; edges: Edge[] } => {
  const { nodes, edges } = rung

  let newNodes = [...nodes]
  let newEdges = [...edges]

  nodes.forEach((node) => {
    if (node.type === 'parallel') {
      const parallelNode = node as ParallelNode
      // check if it is an open parallel
      if (parallelNode.data.type === 'close') {
        const closeParallel = parallelNode
        const openParallel = newNodes.find((n) => n.id === closeParallel.data.parallelOpenReference) as ParallelNode

        /**
         * Get the nodes inside the parallel connection
         */
        const { serial: serialNodes, parallel: parallelNodes } = getNodesInsideParallel(
          { ...rung, nodes: newNodes, edges: newEdges },
          closeParallel,
        )

        /**
         * Check if the serial connection is empty
         */
        if (serialNodes.length === 0) {
          const serialEdge = newEdges.find(
            (edge) => edge.source === openParallel.id && edge.sourceHandle === openParallel.data.outputConnector?.id,
          )
          if (!serialEdge) return { nodes: newNodes, edges: newEdges }
          newEdges = removeEdge(newEdges, serialEdge.id)

          const openParallelTarget = newEdges.find((edge) => edge.target === openParallel.id)
          const openParallelSource = newEdges.find((edge) => edge.source === openParallel.id)
          const closeParallelTarget = newEdges.find((edge) => edge.target === closeParallel.id)
          const closeParallelSource = newEdges.find((edge) => edge.source === closeParallel.id)

          if (!openParallelTarget || !openParallelSource || !closeParallelSource || !closeParallelTarget) return

          /**
           * Check if the parallel connection is not empty. If it is not, reconnect nodes turning the parallel connection into serial
           * If it is empty, remove the parallel connection
           */
          if (parallelNodes.length > 0) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges = removeEdge(newEdges, closeParallelTarget.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, openParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: openParallelSource.targetHandle ?? undefined,
              }),
            )
            newEdges.push(
              buildEdge(closeParallelTarget.source, closeParallelSource.target, {
                sourceHandle: closeParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }

          newEdges = removeEdge(newEdges, openParallelTarget.id)
          newEdges = removeEdge(newEdges, closeParallelSource.id)

          newNodes = removeNode({ ...rung, nodes: newNodes }, closeParallel.id)
          newNodes = removeNode({ ...rung, nodes: newNodes }, openParallel.id)

          return { nodes: newNodes, edges: newEdges }
        }

        /**
         * Check if the parallel connection is empty
         * If it is empty, remove the parallel connection
         */
        if (parallelNodes.length === 0) {
          const parallelEdge = newEdges.find(
            (edge) =>
              edge.source === openParallel.id && edge.sourceHandle === openParallel.data.parallelOutputConnector?.id,
          )
          if (!parallelEdge) return { nodes: newNodes, edges: newEdges }
          newEdges = removeEdge(newEdges, parallelEdge.id)

          const openParallelTarget = newEdges.find((edge) => edge.target === openParallel.id)
          const openParallelSource = newEdges.find((edge) => edge.source === openParallel.id)
          const closeParallelTarget = newEdges.find((edge) => edge.target === closeParallel.id)
          const closeParallelSource = newEdges.find((edge) => edge.source === closeParallel.id)

          if (!openParallelTarget || !openParallelSource || !closeParallelSource || !closeParallelTarget) return

          /**
           * Set serial connection between the openParallel and closeParallel
           */
          if (openParallelSource.id === closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, closeParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }
          /**
           * If have other nodes inside the serial connection, reconnect nodes
           */
          if (openParallelSource.id !== closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges = removeEdge(newEdges, closeParallelTarget.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, openParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: openParallelSource.targetHandle ?? undefined,
              }),
            )
            newEdges.push(
              buildEdge(closeParallelTarget.source, closeParallelSource.target, {
                sourceHandle: closeParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }

          newEdges = removeEdge(newEdges, openParallelTarget.id)
          newEdges = removeEdge(newEdges, closeParallelSource.id)

          newNodes = removeNode({ ...rung, nodes: newNodes }, closeParallel.id)
          newNodes = removeNode({ ...rung, nodes: newNodes }, openParallel.id)
        }
      }
    }
  })
  return { nodes: newNodes, edges: newEdges }
}
