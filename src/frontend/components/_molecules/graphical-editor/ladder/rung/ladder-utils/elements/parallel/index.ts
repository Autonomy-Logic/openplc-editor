import type { RungLadderState } from '@root/frontend/store/slices'
import { newGraphicalEditorNodeID } from '@root/frontend/utils/new-graphical-editor-node-id'
import type { Edge, Node } from '@xyflow/react'

import { checkIfElementIsNode, nodesBuilder } from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type {
  BasicNodeData,
  ParallelNode,
  PlaceholderNode,
} from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge, removeEdge } from '../../edges'
import { buildGenericNode, isNodeOfType, removeNode } from '../../nodes'
import { wireParallelAroundElement } from '../core'
import { removePlaceholderElements } from '../placeholder'
import {
  getElementPositionBasedOnPlaceholderElement,
  getNodePositionBasedOnPreviousNode,
  getNodesInsideParallel,
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
  rung: RungLadderState,
  placeholder: { index: number; selected: PlaceholderNode },
  node: Node | { elementType: string; blockVariant?: T },
): { nodes: Node[]; edges: Edge[]; newNode?: Node } => {
  let newNodes = [...rung.nodes]
  const newEdges = [...rung.edges]

  /**
   * Get the element above the selected placeholder and its edges
   */
  const aboveElement = placeholder.selected.data.relatedNode
  if (!aboveElement) return { nodes: newNodes, edges: newEdges }

  const aboveData = aboveElement.data as BasicNodeData
  const incomingEdge = newEdges.find((edge) => edge.target === aboveElement.id)
  const outgoingEdge = newEdges.find(
    (edge) => edge.source === aboveElement.id && edge.sourceHandle === aboveData.outputConnector?.id,
  )
  if (!incomingEdge || !outgoingEdge) return { nodes: newNodes, edges: newEdges }

  /**
   * Build the parallel open node
   */
  const openParallelPosition = getNodePositionBasedOnPreviousNode(
    newNodes.find((node) => node.id === incomingEdge.source) ?? aboveElement,
    'parallel',
    'serial',
  )
  const openParallelElement = nodesBuilder.parallel({
    id: newGraphicalEditorNodeID('PARALLEL_OPEN'),
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
      id: newGraphicalEditorNodeID(node.elementType.toUpperCase()),
      ...newElementPosition,
    })
  } else {
    newElement = node
  }

  /**
   * Build the close parallel node
   */
  const closeParallelPositionSerial = getNodePositionBasedOnPreviousNode(newElement, 'parallel', 'serial')
  const closeParallelPositionParallel = getNodePositionBasedOnPreviousNode(placeholder.selected, 'parallel', 'serial')
  const closeParallelElement = nodesBuilder.parallel({
    id: newGraphicalEditorNodeID('PARALLEL_CLOSE'),
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
   * Insert nodes: OPEN before aboveElement, newElement+CLOSE after aboveElement
   * (no rebuild — original aboveElement is preserved with its ID and data)
   */
  const aboveIdx = newNodes.findIndex((n) => n.id === aboveElement.id)
  newNodes.splice(aboveIdx, 0, openParallelElement)
  // aboveElement shifted to aboveIdx+1, insert newElement+closeParallel after it
  newNodes.splice(aboveIdx + 2, 0, newElement, closeParallelElement)
  newNodes = removePlaceholderElements(newNodes)

  /**
   * Detect nested parallel for handle overrides
   */
  const predecessorNode = newNodes.find((n) => n.id === incomingEdge.source)
  const openTargetHandle =
    predecessorNode &&
    isNodeOfType(predecessorNode, 'parallel') &&
    (predecessorNode as ParallelNode).data?.type === 'open' &&
    incomingEdge.sourceHandle === (predecessorNode as ParallelNode).data?.parallelOutputConnector?.id
      ? openParallelElement.data.parallelInputConnector?.id
      : undefined

  const successorNode = newNodes.find((n) => n.id === outgoingEdge.target)
  const closeSourceHandle =
    successorNode &&
    isNodeOfType(successorNode, 'parallel') &&
    (successorNode as ParallelNode).data?.type === 'close' &&
    outgoingEdge.targetHandle === (successorNode as ParallelNode).data?.parallelInputConnector?.id
      ? closeParallelElement.data.parallelOutputConnector?.id
      : undefined

  /**
   * Wire parallel edges via shared core utility
   */
  const { edgesToRemove, edgesToAdd } = wireParallelAroundElement({
    incomingEdge,
    outgoingEdge,
    openParallel: openParallelElement as Node,
    closeParallel: closeParallelElement as Node,
    aboveElement,
    newElement,
    openTargetHandle,
    closeSourceHandle,
  })

  const resultEdges = [...newEdges.filter((e) => !edgesToRemove.includes(e.id)), ...edgesToAdd]

  return { nodes: newNodes, edges: resultEdges, newNode: newElement }
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
export const removeEmptyParallelConnections = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
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
