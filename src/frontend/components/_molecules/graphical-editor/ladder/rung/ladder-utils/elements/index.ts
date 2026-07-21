import type { RungLadderState } from '@root/frontend/store/slices'
import { toast } from '@root/frontend/utils/toast'
import type { Edge, Node } from '@xyflow/react'

import type {
  BasicNodeData,
  HandleBranch,
  PlaceholderNode,
} from '../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { disconnectNodes } from '../edges'
import { isNodeOfType, removeNode } from '../nodes'
import { updateDiagramElementsPosition } from './diagram'
import {
  blockHasBranches,
  getBranch,
  insertIntoBranch,
  isBlockInsideMainParallel,
  reconcileBranchNodeIds,
  removeBranchElement,
  removeRailBranchHandle,
  replaceVariableWithBranch,
  startParallelInBranch,
} from './handle-branch'
import { removeEmptyParallelConnections } from './parallel'
import { startParallelConnection } from './parallel'
import { removePlaceholderElements } from './placeholder'
import { appendSerialConnection } from './serial'

// Same guard messages used by drag-n-drop's classifyDrop. Kept here as constants so the
// click-to-add path surfaces identical wording.
const BRANCH_BLOCKED_IN_PARALLEL =
  'Cannot add to a handle branch on a block that is in parallel with other elements. Remove the parallel siblings first.'
const PARALLEL_BLOCKED_WITH_BRANCH =
  'Cannot put a block with handle branches in parallel with other elements. Remove the handle branch contacts first.'
const blockedToast = (reason: string) => toast({ variant: 'warn', title: 'Action not supported', description: reason })

export const addNewElement = <T>(
  rung: RungLadderState,
  newNode:
    | {
        elementType: string
        blockVariant?: T
      }
    | Node,
): { nodes: Node[]; edges: Edge[]; newNode?: Node; handleBranches?: HandleBranch[] } => {
  let newNodeData: Node | undefined
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]
  let handleBranches: HandleBranch[] | undefined

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
    const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode

    if (relatedNode && (relatedNode.data as BasicNodeData).branchContext) {
      // Branch parallel: route to startParallelInBranch.
      // Supports nested parallels — calculateBranchElementPositions uses
      // findAllParallelsDepthAndNodes to recursively position deeper levels.
      const ctx = (relatedNode.data as BasicNodeData).branchContext!
      if (isBlockInsideMainParallel(rung, ctx.blockId)) {
        blockedToast(BRANCH_BLOCKED_IN_PARALLEL)
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }
      const branch = getBranch(rung, ctx.blockId, ctx.handleId)
      if (!branch) {
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }

      const result = startParallelInBranch(rung, relatedNode, newNode)
      newNodes = result.nodes
      newEdges = result.edges
      newNodeData = result.newNode
      handleBranches = result.handleBranches
    } else {
      // Main-line parallel. If the related node is a block with handle branches, refuse —
      // wrapping it in OPEN/CLOSE would entangle the branch layout with a parallel chain.
      if (relatedNode && relatedNode.type === 'block' && blockHasBranches(rung, relatedNode.id)) {
        blockedToast(PARALLEL_BLOCKED_WITH_BRANCH)
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }
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
    }
  } else if ((selectedPlaceholder.data as BasicNodeData).handleBranchTarget) {
    const target = (selectedPlaceholder.data as BasicNodeData).handleBranchTarget!
    if ('elementType' in newNode) {
      const elementType = (newNode as { elementType: string }).elementType

      // Blocks cannot be placed on branch handles — the branch layout system
      // is designed for single-handle elements (contacts/coils) only.
      if (elementType === 'block') {
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }
      if (isBlockInsideMainParallel(rung, target.blockId)) {
        blockedToast(BRANCH_BLOCKED_IN_PARALLEL)
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }
      if (target.insertIndex !== undefined) {
        // Insert into existing branch at specified position
        const result = insertIntoBranch(
          rung,
          {
            blockId: target.blockId,
            handleId: target.handleId,
            direction: target.direction,
            insertIndex: target.insertIndex,
          },
          elementType,
        )
        newNodes = result.nodes
        newEdges = result.edges
        newNodeData = result.newNode
        handleBranches = result.handleBranches
      } else {
        // Create new branch (replace variable node)
        const result = replaceVariableWithBranch(rung, target, elementType)
        newNodes = result.nodes
        newEdges = result.edges
        newNodeData = result.newNode
        handleBranches = result.handleBranches
      }
    }
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

    // When the placeholder is anchored to a parallel-path branch element (a branch
    // contact NOT in branch.nodeIds), appendSerialConnection inserts the new node
    // into the nested edge chain but doesn't know to tag it as a branch element.
    // Without branchContext, the layout treats the new node as main-rail content,
    // and getPreviousElementsByEdge skips its (branch) predecessor — leaving it
    // without a valid position and dropped from the final node list. Propagate
    // branchContext from the related node so the layout recognises it as part of
    // the branch. The drag-drop equivalent (handleBranchParallelPath) does the same.
    const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode
    const relatedBranchCtx = relatedNode && (relatedNode.data as BasicNodeData).branchContext
    if (relatedBranchCtx && serialNewNode) {
      newNodes = serialNodes.map((n) =>
        n.id === serialNewNode.id ? { ...n, data: { ...n.data, branchContext: relatedBranchCtx } } : n,
      )
      newNodeData = newNodes.find((n) => n.id === serialNewNode.id)
    } else {
      newNodes = serialNodes
      newNodeData = serialNewNode
    }
    newEdges = serialEdges
  }

  /**
   * After adding the new element, update the diagram with the new rung
   */
  const { nodes: updatedDiagramNodes, edges: updatedDiagramEdges } = updateDiagramElementsPosition(
    {
      ...rung,
      nodes: newNodes,
      edges: newEdges,
      ...(handleBranches && { handleBranches }),
    },
    rung.defaultBounds as [number, number],
  )

  newNodes = updatedDiagramNodes
  newEdges = updatedDiagramEdges

  /**
   * Return the updated rung
   */
  return { nodes: newNodes, edges: newEdges, newNode: newNodeData, handleBranches }
}

export const removeElement = (
  rung: RungLadderState,
  element: Node,
  /** Fallback identity source for the variable-node rebuild — pass the
   *  pre-strip node set when `rung.nodes` had its variable nodes removed
   *  earlier in the pipeline (see updateVariableBlockPosition). */
  previousNodes?: Node[],
): { nodes: Node[]; edges: Edge[]; handleBranches?: HandleBranch[] } => {
  let newNodes: Node[]
  let newEdges: Edge[]
  let handleBranches: HandleBranch[] | undefined

  const branchContext = (element.data as BasicNodeData).branchContext

  if (branchContext) {
    /**
     * Branch element: delegate node/edge cleanup to removeBranchElement
     */
    const result = removeBranchElement(rung, element.id)
    newNodes = result.nodes
    newEdges = result.edges
    handleBranches = result.handleBranches
  } else {
    /**
     * Regular element: remove node and disconnect edges
     */
    newNodes = removeNode(rung, element.id)

    const edgeToRemove = rung.edges.find(
      (e) => e.source === element.id && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
    )
    if (!edgeToRemove) return { nodes: rung.nodes, edges: rung.edges }
    newEdges = disconnectNodes(rung, edgeToRemove.source, edgeToRemove.target)

    /**
     * When removing a block, also clean up all associated branch elements.
     * Branch elements (contacts/coils on secondary handles) and their edges
     * would be left floating since disconnectNodes only bridges the main chain.
     */
    if (element.type === 'block' && rung.handleBranches?.length) {
      const blockBranches = rung.handleBranches.filter((b) => b.blockId === element.id)
      if (blockBranches.length > 0) {
        // Collect all branch node IDs: serial-spine nodes from nodeIds
        // plus parallel-path nodes identified by branchContext
        const branchNodeIds = new Set<string>()
        for (const branch of blockBranches) {
          for (const nodeId of branch.nodeIds) {
            branchNodeIds.add(nodeId)
          }
        }
        for (const node of newNodes) {
          const ctx = (node.data as BasicNodeData).branchContext
          if (ctx && ctx.blockId === element.id) {
            branchNodeIds.add(node.id)
          }
        }

        // Remove branch nodes and their connected edges
        newNodes = newNodes.filter((n) => !branchNodeIds.has(n.id))
        newEdges = newEdges.filter((e) => !branchNodeIds.has(e.source) && !branchNodeIds.has(e.target))

        // Remove rail branch handles
        for (const branch of blockBranches) {
          newNodes = removeRailBranchHandle(newNodes, branch.blockId, branch.handleId, branch.direction)
        }

        // Remove HandleBranch entries for this block
        handleBranches = (rung.handleBranches ?? []).filter((b) => b.blockId !== element.id)
      }
    }
  }

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
   * Reconcile branch nodeIds after parallel collapse may have removed OPEN/CLOSE nodes
   * or promoted parallel-path elements to the serial spine.
   */
  if (handleBranches) {
    handleBranches = handleBranches
      .map((branch) => ({
        ...branch,
        nodeIds: reconcileBranchNodeIds({ ...rung, nodes: newNodes, edges: newEdges, handleBranches }, branch),
      }))
      .filter((branch) => branch.nodeIds.length > 0)

    // If a branch was removed (empty after reconciliation), clean up its rail handle
    const removedBranches = (rung.handleBranches ?? []).filter(
      (b) => !handleBranches!.some((nb) => nb.blockId === b.blockId && nb.handleId === b.handleId),
    )
    for (const removed of removedBranches) {
      newNodes = removeRailBranchHandle(newNodes, removed.blockId, removed.handleId, removed.direction)
    }
  }

  /**
   * After removing the element, update the diagram with the new rung
   */
  const { nodes: updatedDiagramNodes, edges: updatedDiagramEdges } = updateDiagramElementsPosition(
    {
      ...rung,
      nodes: newNodes,
      edges: newEdges,
      ...(handleBranches && { handleBranches }),
    },
    rung.defaultBounds as [number, number],
    previousNodes,
  )
  newNodes = updatedDiagramNodes
  newEdges = updatedDiagramEdges

  /**
   * Return the updated rung
   */
  return { nodes: newNodes, edges: newEdges, handleBranches }
}

export const removeElements = (
  rung: RungLadderState,
  nodesToRemove: Node[],
): { nodes: Node[]; edges: Edge[]; handleBranches?: HandleBranch[] } => {
  if (!nodesToRemove || nodesToRemove.length === 0) return { nodes: rung.nodes, edges: rung.edges }

  const state = { ...rung }
  let handleBranchesChanged = false
  for (const node of nodesToRemove) {
    // Skip if node was already removed (e.g., branch element cleaned up when its parent block was deleted)
    if (!state.nodes.find((n) => n.id === node.id)) continue

    const { nodes, edges, handleBranches } = removeElement(state, node)
    state.nodes = nodes
    state.edges = edges
    if (handleBranches) {
      state.handleBranches = handleBranches
      handleBranchesChanged = true
    }
  }

  return {
    nodes: state.nodes,
    edges: state.edges,
    ...(handleBranchesChanged && { handleBranches: state.handleBranches }),
  }
}
