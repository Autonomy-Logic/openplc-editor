import type { PlaceholderNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { disconnectNodes } from '../edges'
import { isNodeOfType, removeNode } from '../nodes'
import { updateDiagramElementsPosition } from './diagram'
import { removeEmptyParallelConnections } from './parallel'
import { startParallelConnection } from './parallel'
import { removePlaceholderElements } from './placeholder'
import { appendSerialConnection } from './serial'

export const addNewElement = <T>(
  rung: RungLadderState,
  newNode:
    | {
        elementType: string
        blockVariant?: T
      }
    | Node,
): { nodes: Node[]; edges: Edge[]; newNode?: Node } => {
  let newNodeData: Node | undefined
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Search for the selected placeholder in the rung
   * If no placeholder is selected, return the rung as it is without any changes
   */
  const [selectedPlaceholderIndex, selectedPlaceholder] = Object.entries(rung.nodes).find(
    (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
  ) ?? [undefined, undefined]
  if (!selectedPlaceholder || !selectedPlaceholderIndex)
    return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }

  /**
   * Check if the selected placeholder is a parallel placeholder
   * If it is, create a new parallel junction and add the new element to it
   * If it is not, add the new element to the selected placeholder
   */
  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    const {
      nodes: parallelNodes,
      edges: parallelEdges,
      newNode: parellelNewNode,
    } = startParallelConnection(
      rung,
      {
        index: parseInt(selectedPlaceholderIndex),
        selected: selectedPlaceholder as PlaceholderNode,
      },
      newNode,
    )
    newNodes = parallelNodes
    newEdges = parallelEdges
    newNodeData = parellelNewNode
  } else {
    const {
      nodes: serialNodes,
      edges: serialEdges,
      newNode: serialNewNode,
    } = appendSerialConnection(
      rung,
      {
        index: parseInt(selectedPlaceholderIndex),
        selected: selectedPlaceholder as PlaceholderNode,
      },
      newNode,
    )
    newNodes = serialNodes
    newEdges = serialEdges
    newNodeData = serialNewNode
  }

  /**
   * After adding the new element, update the diagram with the new rung
   */
  const { nodes: updatedDiagramNodes, edges: updatedDiagramEdges } = updateDiagramElementsPosition(
    {
      ...rung,
      nodes: newNodes,
      edges: newEdges,
    },
    rung.defaultBounds as [number, number],
  )

  newNodes = updatedDiagramNodes
  newEdges = updatedDiagramEdges

  /**
   * Return the updated rung
   */
  return { nodes: newNodes, edges: newEdges, newNode: newNodeData }
}

export const removeElement = (rung: RungLadderState, element: Node): { nodes: Node[]; edges: Edge[] } => {
  /**
   * Remove the selected element from the rung
   */
  let newNodes = removeNode(rung, element.id)

  /**
   * Disconnect the element from the rung
   */
  const edgeToRemove = rung.edges.find(
    (e) => e.source === element.id && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
  )
  if (!edgeToRemove) return { nodes: rung.nodes, edges: rung.edges }
  let newEdges = disconnectNodes(rung, edgeToRemove.source, edgeToRemove.target)

  /**
   * Check if there is empty parallel connections
   * If there is, remove them
   */
  const { nodes: checkedParallelNodes, edges: checkedParallelEdges } = removeEmptyParallelConnections({
    ...rung,
    nodes: newNodes,
    edges: newEdges,
  })
  newNodes = checkedParallelNodes
  newEdges = checkedParallelEdges

  /**
   * After adding the new element, update the diagram with the new rung
   */
  const { nodes: updatedDiagramNodes, edges: updatedDiagramEdges } = updateDiagramElementsPosition(
    {
      ...rung,
      nodes: newNodes,
      edges: newEdges,
    },
    rung.defaultBounds as [number, number],
  )
  newNodes = updatedDiagramNodes
  newEdges = updatedDiagramEdges

  /**
   * Return the updated rung
   */
  return { nodes: newNodes, edges: newEdges }
}

export const removeElements = (rung: RungLadderState, nodesToRemove: Node[]): { nodes: Node[]; edges: Edge[] } => {
  if (!nodesToRemove || nodesToRemove.length === 0) return { nodes: rung.nodes, edges: rung.edges }

  const RungLadderState = { ...rung }
  for (const node of nodesToRemove) {
    const { nodes, edges } = removeElement(RungLadderState, node)
    RungLadderState.nodes = nodes
    RungLadderState.edges = edges
  }

  return { nodes: RungLadderState.nodes, edges: RungLadderState.edges }
}
