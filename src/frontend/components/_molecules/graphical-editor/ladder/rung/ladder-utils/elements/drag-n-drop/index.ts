import type { RungLadderState } from '@root/frontend/store/slices'
import type { HandleBranch } from '@root/middleware/shared/ports/types'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { toInteger } from 'lodash'

import { PlaceholderNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { isNodeOfType } from '../../nodes'
import { removeElement } from '..'
import { updateDiagramElementsPosition } from '../diagram'
import { startParallelConnection } from '../parallel'
import { removePlaceholderElements } from '../placeholder'
import { renderPlaceholderElements, searchNearestPlaceholder } from '../placeholder'
import { appendSerialConnection } from '../serial'
import { removeVariableBlock } from '../variable-block'

export const onElementDragStart = (rung: RungLadderState, draggedNode: Node) => {
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
  rung: RungLadderState,
  reactFlowInstance: ReactFlowInstance,
  position: { x: number; y: number },
) => {
  return searchNearestPlaceholder(rung, reactFlowInstance, position)
}

type DropClassification = 'restore' | 'parallel' | 'serial'

type DropContext = {
  rung: RungLadderState
  selectedPlaceholder: PlaceholderNode
  selectedPlaceholderIndex: number
  copycatNode: Node
  draggedNode: Node
  oldNodeIndex: number
}

type DropResult = { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] }

/**
 * Pick which drop scenario applies. The classifier owns the decision so each
 * handler stays focused on its own state mutation.
 */
const classifyDrop = (placeholder: PlaceholderNode, copycatNodeId: string): DropClassification => {
  if (placeholder.data.relatedNode?.id === copycatNodeId) return 'restore'
  if (isNodeOfType(placeholder, 'parallelPlaceholder')) return 'parallel'
  return 'serial'
}

/**
 * Index passed to serial / parallel connectors must account for the soon-to-be-removed
 * dragged node when it sits before the placeholder in the node list.
 */
const computeAdjustedIndex = (oldNodeIndex: number, selectedPlaceholderIndex: number): number =>
  oldNodeIndex < selectedPlaceholderIndex ? selectedPlaceholderIndex - 1 : selectedPlaceholderIndex

/**
 * Common setup: strip transient variable nodes, locate the placeholder + copycat,
 * verify the dragged node is still in the rung. Returns null when any precondition
 * fails — caller falls back to the pre-drag state.
 */
const prepareDropContext = (rung: RungLadderState, draggedNode: Node): DropContext | null => {
  const [selectedPlaceholderIndex, selectedPlaceholder] = Object.entries(rung.nodes).find(
    ([, n]) => (n.type === 'placeholder' || n.type === 'parallelPlaceholder') && n.selected,
  ) ?? [undefined, undefined]
  if (!selectedPlaceholder || selectedPlaceholderIndex === undefined) return null

  const { nodes: nodesAfterVariableCleanup, edges: edgesAfterVariableCleanup } = removeVariableBlock(rung)
  let nodes = nodesAfterVariableCleanup
  const edges = edgesAfterVariableCleanup

  const copycatNode = nodes.filter((n) => n.type !== 'variable').find((n) => n.id === `copycat_${draggedNode.id}`)
  if (!copycatNode) return null

  const oldNodeIndex = nodes.findIndex((n) => n.id === draggedNode.id)
  if (oldNodeIndex === -1) return null
  nodes = nodes.filter((n) => n.id !== draggedNode.id)

  return {
    rung: { ...rung, nodes, edges },
    selectedPlaceholder: selectedPlaceholder as PlaceholderNode,
    selectedPlaceholderIndex: toInteger(selectedPlaceholderIndex),
    copycatNode,
    draggedNode,
    oldNodeIndex,
  }
}

/**
 * Drop landed on the same placeholder the dragged node started from: replace the
 * copycat with the original node, restore edge ids, and re-run layout.
 */
const handleRestoreDrop = (ctx: DropContext): DropResult => {
  const { rung, copycatNode, draggedNode } = ctx
  const nodes = [...rung.nodes]
  nodes[nodes.indexOf(copycatNode)] = { ...draggedNode, id: draggedNode.id, dragging: false }

  const edges = rung.edges.map((edge) => {
    if (edge.source === copycatNode.id) {
      return { ...edge, source: draggedNode.id, id: edge.id.replace('copycat_', '') }
    }
    if (edge.target === copycatNode.id) {
      return { ...edge, target: draggedNode.id, id: edge.id.replace('copycat_', '') }
    }
    return edge
  })

  const restoredNodes = removePlaceholderElements(nodes)
  const layoutResult = updateDiagramElementsPosition(
    { ...rung, nodes: restoredNodes, edges },
    rung.defaultBounds as [number, number],
  )
  return { ...layoutResult, handleBranches: rung.handleBranches }
}

/**
 * Insert the dragged node into a parallel branch starting at the selected
 * placeholder, then drop the copycat. `removeElement` re-runs layout for us.
 */
const handleParallelDrop = (ctx: DropContext): DropResult => {
  const { rung, selectedPlaceholder, selectedPlaceholderIndex, oldNodeIndex, draggedNode, copycatNode } = ctx
  const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(
    rung,
    {
      selected: selectedPlaceholder,
      index: computeAdjustedIndex(oldNodeIndex, selectedPlaceholderIndex),
    },
    draggedNode,
  )
  return removeElement({ ...rung, nodes: parallelNodes, edges: parallelEdges }, copycatNode)
}

/**
 * Splice the dragged node serially at the selected placeholder, then drop the
 * copycat. `removeElement` re-runs layout for us.
 */
const handleSerialDrop = (ctx: DropContext): DropResult => {
  const { rung, selectedPlaceholder, selectedPlaceholderIndex, oldNodeIndex, draggedNode, copycatNode } = ctx
  const { nodes: serialNodes, edges: serialEdges } = appendSerialConnection(
    rung,
    {
      selected: selectedPlaceholder,
      index: computeAdjustedIndex(oldNodeIndex, selectedPlaceholderIndex),
    },
    draggedNode,
  )
  return removeElement({ ...rung, nodes: serialNodes, edges: serialEdges }, copycatNode)
}

/**
 * Drag and drop function to stop the drag of an element and connect it to the nearest placeholder
 *
 * @param rung The current rung state
 * @param node The node to be connected
 *
 * @returns The new nodes and edges
 */
export const onElementDrop = (rung: RungLadderState, oldStateRung: RungLadderState, node: Node): DropResult => {
  const ctx = prepareDropContext(rung, node)
  if (!ctx) return { nodes: oldStateRung.nodes, edges: oldStateRung.edges, handleBranches: oldStateRung.handleBranches }

  switch (classifyDrop(ctx.selectedPlaceholder, ctx.copycatNode.id)) {
    case 'restore':
      return handleRestoreDrop(ctx)
    case 'parallel':
      return handleParallelDrop(ctx)
    case 'serial':
      return handleSerialDrop(ctx)
  }
}
