import type { RungLadderState } from '@root/frontend/store/slices'
import { toast } from '@root/frontend/utils/toast'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { toInteger } from 'lodash'

import type { BasicNodeData } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { PlaceholderNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { isNodeOfType } from '../../nodes'
import { blockHasBranches, getBranch, isBlockInsideMainParallel } from '../handle-branch'
import { renderPlaceholderElements, searchNearestPlaceholder } from '../placeholder'
import { removeVariableBlock } from '../variable-block'
import {
  type DropContext,
  type DropResult,
  handleBranchCreate,
  handleBranchParallel,
  handleBranchParallelPath,
  handleBranchSerial,
  handleMainParallel,
  handleMainSerial,
  handleRestore,
} from './handlers'

// ---------------------------------------------------------------------------
// Drop classification types & helpers
// ---------------------------------------------------------------------------

type DropAction =
  | { type: 'restore' }
  | { type: 'blocked'; reason: string }
  | { type: 'branch-parallel'; aboveElement: Node }
  | { type: 'main-parallel'; sourceIsBranch: boolean }
  | {
      type: 'branch-serial'
      target: { blockId: string; handleId: string; direction: 'input' | 'output'; insertIndex: number }
    }
  | {
      type: 'branch-parallel-path'
      targetNode: Node
      branchContext: NonNullable<BasicNodeData['branchContext']>
      position: 'left' | 'right'
    }
  | {
      type: 'branch-create'
      target: {
        blockId: string
        handleId: string
        direction: 'input' | 'output'
        handlePosition: { x: number; y: number }
      }
    }
  | { type: 'main-serial'; sourceIsBranch: boolean }

// Reasons surfaced via toast when the user attempts an incompatible drop.
// The branch layout engine can't position a block that's also in a parallel chain
// without creating overlap, so we refuse rather than silently producing a broken diagram.
const BRANCH_BLOCKED_IN_PARALLEL =
  'Cannot add to a handle branch on a block that is in parallel with other elements. Remove the parallel siblings first.'
const PARALLEL_BLOCKED_WITH_BRANCH =
  'Cannot put a block with handle branches in parallel with other elements. Remove the handle branch contacts first.'

/**
 * Pure classifier: inspects the placeholder and node to determine which drop
 * scenario applies without performing any mutations.
 */
function classifyDrop(
  selectedPlaceholder: PlaceholderNode,
  copycatNode: Node,
  draggedNode: Node,
  oldStateRung: RungLadderState,
): DropAction | null {
  // Blocks cannot be dropped on branch handles — the branch layout system
  // is designed for single-handle elements (contacts/coils) only.
  if (draggedNode.type === 'block' && selectedPlaceholder.data.handleBranchTarget) {
    return null
  }

  // Path 1: drop back on original position
  if (selectedPlaceholder.data.relatedNode?.id === copycatNode.id) {
    return { type: 'restore' }
  }

  const sourceIsBranch = !!(draggedNode.data as BasicNodeData).branchContext

  if (isNodeOfType(selectedPlaceholder as Node, 'parallelPlaceholder')) {
    const relatedNode = selectedPlaceholder.data.relatedNode
    const branchCtx = relatedNode && (relatedNode.data as BasicNodeData).branchContext

    if (branchCtx) {
      if (isBlockInsideMainParallel(oldStateRung, branchCtx.blockId)) {
        return { type: 'blocked', reason: BRANCH_BLOCKED_IN_PARALLEL }
      }
      // Path 2: any → branch parallel (supports nested parallels via findAllParallelsDepthAndNodes)
      const branch = getBranch(oldStateRung, branchCtx.blockId, branchCtx.handleId)
      const aboveElement = oldStateRung.nodes.find((n) => n.id === relatedNode.id)
      if (branch && aboveElement) {
        return { type: 'branch-parallel', aboveElement }
      }
      return null // fallback
    }

    // Paths 3 & 4: main parallel (branch or main source).
    // If the related node is a block with handle branches, putting it in parallel would
    // entangle the branch layout with a parallel chain — refuse.
    if (relatedNode && relatedNode.type === 'block' && blockHasBranches(oldStateRung, relatedNode.id)) {
      return { type: 'blocked', reason: PARALLEL_BLOCKED_WITH_BRANCH }
    }
    return { type: 'main-parallel', sourceIsBranch }
  }

  // Serial placeholder
  const serialRelated = selectedPlaceholder.data.relatedNode
  const serialBranchTarget = selectedPlaceholder.data.handleBranchTarget

  if (
    serialRelated &&
    (serialRelated.data as BasicNodeData).branchContext &&
    serialBranchTarget?.insertIndex !== undefined
  ) {
    if (isBlockInsideMainParallel(oldStateRung, serialBranchTarget.blockId)) {
      return { type: 'blocked', reason: BRANCH_BLOCKED_IN_PARALLEL }
    }
    // Path 5: any → branch serial
    return {
      type: 'branch-serial',
      target: {
        blockId: serialBranchTarget.blockId,
        handleId: serialBranchTarget.handleId,
        direction: serialBranchTarget.direction,
        insertIndex: serialBranchTarget.insertIndex,
      },
    }
  }

  if (serialRelated && (serialRelated.data as BasicNodeData).branchContext) {
    // Path 6: any → branch parallel-path
    const ctx = (serialRelated.data as BasicNodeData).branchContext!
    if (isBlockInsideMainParallel(oldStateRung, ctx.blockId)) {
      return { type: 'blocked', reason: BRANCH_BLOCKED_IN_PARALLEL }
    }
    const targetId = serialRelated.id.startsWith('copycat_') ? serialRelated.id.slice(8) : serialRelated.id
    const targetNode = oldStateRung.nodes.find((n) => n.id === targetId)
    if (targetNode) {
      return {
        type: 'branch-parallel-path',
        targetNode,
        branchContext: ctx,
        position: (selectedPlaceholder.data.position as 'left' | 'right') ?? 'left',
      }
    }
    return null // fallback
  }

  if (serialBranchTarget && serialBranchTarget.insertIndex === undefined) {
    if (isBlockInsideMainParallel(oldStateRung, serialBranchTarget.blockId)) {
      return { type: 'blocked', reason: BRANCH_BLOCKED_IN_PARALLEL }
    }
    // Path 7: any → empty block handle (create new branch)
    return {
      type: 'branch-create',
      target: {
        blockId: serialBranchTarget.blockId,
        handleId: serialBranchTarget.handleId,
        direction: serialBranchTarget.direction,
        handlePosition: serialBranchTarget.handlePosition,
      },
    }
  }

  // Paths 8 & 9: main serial (branch or main source)
  return { type: 'main-serial', sourceIsBranch }
}

/**
 * Find the currently selected placeholder node in the rung.
 */
function findSelectedPlaceholder(rung: RungLadderState): {
  selectedPlaceholder: PlaceholderNode | undefined
  selectedPlaceholderIndex: number
} {
  const entry = Object.entries(rung.nodes).find(
    ([, n]) => (n.type === 'placeholder' || n.type === 'parallelPlaceholder') && n.selected,
  )
  if (!entry) return { selectedPlaceholder: undefined, selectedPlaceholderIndex: -1 }
  return {
    selectedPlaceholder: entry[1] as PlaceholderNode,
    selectedPlaceholderIndex: toInteger(entry[0]),
  }
}

/**
 * Prepare the rung state for a drop operation:
 * removes variable blocks, finds copycat node, removes the dragged node from nodes array.
 */
function prepareDropState(
  rung: RungLadderState,
  node: Node,
): {
  preparedNodes: Node[]
  preparedEdges: Edge[]
  copycatNode: Node | undefined
  oldNodeIndex: number
} {
  const { nodes: cleanedNodes, edges: cleanedEdges } = removeVariableBlock(rung)

  const copycatNode = cleanedNodes.filter((n) => n.type !== 'variable').find((n) => n.id === `copycat_${node.id}`)
  const oldNodeIndex = cleanedNodes.findIndex((n) => n.id === node.id)
  const preparedNodes = oldNodeIndex !== -1 ? cleanedNodes.filter((n) => n.id !== node.id) : cleanedNodes

  return { preparedNodes, preparedEdges: cleanedEdges, copycatNode, oldNodeIndex }
}

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

/**
 * Drag and drop function to stop the drag of an element and connect it to the nearest placeholder.
 * Classifies the drop scenario once, then dispatches to a focused handler.
 */
export const onElementDrop = (rung: RungLadderState, oldStateRung: RungLadderState, node: Node): DropResult => {
  const fallback = { nodes: oldStateRung.nodes, edges: oldStateRung.edges }

  // 1. Find selected placeholder
  const { selectedPlaceholder, selectedPlaceholderIndex } = findSelectedPlaceholder(rung)
  if (!selectedPlaceholder) return fallback

  // 2. Prepare state: remove variable blocks, find copycat, remove dragged node
  const { preparedNodes, preparedEdges, copycatNode, oldNodeIndex } = prepareDropState(rung, node)
  if (!copycatNode || oldNodeIndex === -1) return fallback

  // 3. Classify the drop scenario
  const action = classifyDrop(selectedPlaceholder, copycatNode, node, oldStateRung)
  if (!action) return fallback

  // 4. Build shared context for handlers
  const ctx: DropContext = {
    rung,
    oldStateRung,
    node,
    copycatNode,
    selectedPlaceholder,
    oldNodeIndex,
    selectedPlaceholderIndex,
    preparedNodes,
    preparedEdges,
  }

  // 5. Dispatch to the appropriate handler
  switch (action.type) {
    case 'blocked':
      toast({ variant: 'warn', title: 'Action not supported', description: action.reason })
      return fallback

    case 'restore':
      return handleRestore(ctx)

    case 'branch-parallel':
      return handleBranchParallel(oldStateRung, node, action.aboveElement)

    case 'main-parallel':
      return handleMainParallel(ctx, action.sourceIsBranch)

    case 'branch-serial':
      return handleBranchSerial(oldStateRung, node, action.target)

    case 'branch-parallel-path':
      return handleBranchParallelPath(oldStateRung, node, action.targetNode, action.branchContext, action.position)

    case 'branch-create':
      return handleBranchCreate(oldStateRung, node, action.target)

    case 'main-serial':
      return handleMainSerial(ctx, action.sourceIsBranch)
  }
}
