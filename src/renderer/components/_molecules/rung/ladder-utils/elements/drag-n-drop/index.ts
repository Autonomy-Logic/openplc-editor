import type { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { toInteger } from 'lodash'

import { removePlaceholderNodes } from '../../elementsOld'
import { isNodeOfType } from '../../nodes'
import { removeElement } from '..'
import { updateDiagramElementsPosition } from '../diagram'
import { startParallelConnection } from '../parallel'
import { renderPlaceholderElements, searchNearestPlaceholder } from '../placeholder'
import { appendSerialConnection } from '../serial'

export const onElementDragStart = (rung: RungState, draggedNode: Node) => {
  /**
   * Check if the dragged node is draggable
   * If not, return the rung as it is
   */
  if (!draggedNode.draggable) return rung

  // Set a new node at the correct place and disconnect the node from the previous one
  const copycatNode = {
    ...draggedNode,
    id: `copycat_${draggedNode.id}`,
    draggable: false,
    dragging: false,
    selectable: false,
    selected: false,
  }

  /**
   * Find the index of the dragged node
   * If the node is not found, return the rung as it is
   */
  const nodeIndex = rung.nodes.findIndex((n) => n.id === draggedNode.id)
  if (nodeIndex === -1) return rung

  let newNodes = [...rung.nodes]
  newNodes.splice(nodeIndex, 0, copycatNode)

  /**
   * Find the edges that are connected to the dragged node
   */
  const newEdges = [...rung.edges]
  rung.edges.forEach((edge, index) => {
    if (edge.source === draggedNode.id) {
      newEdges[index] = { ...edge, source: copycatNode.id, id: `copycat_${edge.id}` }
    }
    if (edge.target === draggedNode.id) {
      newEdges[index] = { ...edge, target: copycatNode.id, id: `copycat_${edge.id}` }
    }
  })

  /**
   * Render the placeholder nodes
   */
  newNodes = renderPlaceholderElements({ ...rung, nodes: newNodes, edges: newEdges })

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Drag and drop function to drag an element to a new position
 *
 * @param rung The current rung state
 * @param reactFlowInstance The react flow instance
 *
 * @returns The nearest placeholder node
 */
export const onElementDragOver = (
  rung: RungState,
  reactFlowInstance: ReactFlowInstance,
  position: { x: number; y: number },
) => {
  return searchNearestPlaceholder(rung, reactFlowInstance, position)
}

/**
 * Drag and drop function to stop the drag of an element and connect it to the nearest placeholder
 *
 * @param rung The current rung state
 * @param node The node to be connected
 *
 * @returns The new nodes and edges
 */
export const onElementDrop = (
  rung: RungState,
  oldStateRung: RungState,
  node: Node,
): { nodes: Node[]; edges: Edge[] } => {
  /**
   * Find the selected placeholder
   * If not found, return the old rung as it is (remove the placeholder nodes)
   */
  const [selectedPlaceholderIndex, selectedPlaceholder] = Object.entries(rung.nodes).find(
    (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
  ) ?? [undefined, undefined]
  if (!selectedPlaceholder || !selectedPlaceholderIndex)
    return { nodes: oldStateRung.nodes, edges: oldStateRung.edges }

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Find the copycat node
   * If not found, return the old rung as it is
   */
  const copycatNode = newNodes.find((n) => n.id === `copycat_${node.id}`)
  if (!copycatNode) return { nodes: oldStateRung.nodes, edges: oldStateRung.edges }

  /**
   * Remove the old node and the copycat node
   * If the old node is not found, return the old rung as it is
   */
  const oldNodeIndex = newNodes.findIndex((n) => n.id === node.id)
  if (oldNodeIndex === -1) return { nodes: oldStateRung.nodes, edges: oldStateRung.edges }
  newNodes = newNodes.filter((n) => n.id !== node.id)

  // Check if the selected placeholder is the same as the copycat node
  if ((selectedPlaceholder as PlaceholderNode).data.relatedNode?.id === copycatNode.id) {
    newNodes[newNodes.indexOf(copycatNode)] = {
      ...node,
      id: node.id,
      dragging: false,
    }
    newEdges.forEach((edge, index) => {
      if (edge.source === copycatNode.id) {
        newEdges[index] = { ...edge, source: node.id, id: edge.id.replace('copycat_', '') }
      }
      if (edge.target === copycatNode.id) {
        newEdges[index] = { ...edge, target: node.id, id: edge.id.replace('copycat_', '') }
      }
    })
    // Remove the placeholder nodes
    newNodes = removePlaceholderNodes(newNodes)

    /**
     * After adding the new element, update the diagram with the new rung
     */
    newNodes = updateDiagramElementsPosition(
      { ...rung, nodes: newNodes, edges: newEdges },
      rung.defaultBounds as [number, number],
    )
    return { nodes: newNodes, edges: newEdges }
  }

  /**
   * Check if the selected placeholder is a parallel placeholder
   * If it is, create a new parallel junction and add the new element to it
   * If it is not, add the new element to the selected placeholder
   */
  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      {
        selected: selectedPlaceholder as PlaceholderNode,
        index:
          oldNodeIndex < toInteger(selectedPlaceholderIndex)
            ? toInteger(selectedPlaceholderIndex) - 1
            : toInteger(selectedPlaceholderIndex),
      },
      node,
    )
    newEdges = parallelEdges
    newNodes = parallelNodes
  } else {
    const { nodes: serialNodes, edges: serialEdges } = appendSerialConnection(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      {
        selected: selectedPlaceholder as PlaceholderNode,
        index:
          oldNodeIndex < toInteger(selectedPlaceholderIndex)
            ? toInteger(selectedPlaceholderIndex) - 1
            : toInteger(selectedPlaceholderIndex),
      },
      node,
    )
    newEdges = serialEdges
    newNodes = serialNodes
  }

  // If the selected placeholder is not the same as the copycat node, remove the copycat node and the old one
  const { nodes: removedCopycatNodes, edges: removedCopycatEdges } = removeElement(
    { ...rung, nodes: newNodes, edges: newEdges },
    copycatNode,
  )
  newNodes = removedCopycatNodes
  newEdges = removedCopycatEdges

  return { nodes: newNodes, edges: newEdges }
}
