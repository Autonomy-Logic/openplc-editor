import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { isNodeOfType } from '../nodes'
import { startParallelConnection } from './parallel'
import { appendSerialConnection } from './serial'

export const addNewElement = <T>(
  rung: RungState,
  newNode: {
    elementType: string
    blockVariant?: T
  },
): { nodes: Node[]; edges: Edge[] } => {
  console.log('Adding new element to rung:', newNode)

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  /**
   * Search for the selected placeholder in the rung
   * If no placeholder is selected, return the rung as it is without any changes
   */
  const [selectedPlaceholderIndex, selectedPlaceholder] = Object.entries(rung.nodes).find(
    (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
  ) ?? [undefined, undefined]
  if (!selectedPlaceholder || !selectedPlaceholderIndex) return { nodes: rung.nodes, edges: rung.edges }

  /**
   * Check if the selected placeholder is a parallel placeholder
   * If it is, create a new parallel junction and add the new element to it
   * If it is not, add the new element to the selected placeholder
   */
  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    console.log('Parallel Placeholder')
    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(
      rung,
      {
        index: parseInt(selectedPlaceholderIndex),
        selected: selectedPlaceholder as PlaceholderNode,
      },
      newNode,
    )
    newNodes = parallelNodes
    newEdges = parallelEdges
  } else {
    console.log('Normal Placeholder')
    const { nodes: serialNodes, edges: serialEdges } = appendSerialConnection(
      rung,
      {
        index: parseInt(selectedPlaceholderIndex),
        selected: selectedPlaceholder as PlaceholderNode,
      },
      newNode,
    )
    newNodes = serialNodes
    newEdges = serialEdges
  }

  /**
   * After adding the new element, update the diagram with the new rung
   */

  /**
   * Return the updated rung
   */
  return { nodes: newNodes, edges: newEdges }
}

const removeElement = () => {}
export const removeElements = () => {
  removeElement()
}
