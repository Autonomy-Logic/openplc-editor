import type { RungLadderState } from '@root/frontend/store/slices'
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
  getBranch,
  insertIntoBranch,
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
      // Branch parallel: route to startParallelInBranch
      const ctx = (relatedNode.data as BasicNodeData).branchContext!
      const branch = getBranch(rung, ctx.blockId, ctx.handleId)

      // Only allow parallels on serial-spine elements (elements in nodeIds).
      // Parallel-path elements (not in nodeIds) would create nested parallels — not supported.
      if (!branch || !branch.nodeIds.includes(relatedNode.id)) {
        return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges }
      }

      const result = startParallelInBranch(rung, relatedNode, newNode)
      newNodes = result.nodes
      newEdges = result.edges
      newNodeData = result.newNode
      handleBranches = result.handleBranches
    } else {
      // Main-line parallel — existing startParallelConnection logic (unchanged)
      const {
        nodes: parallelNodes,
        edges: parallelEdges,
        newNode: parallelNewNode,
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
      newNodeData = parallelNewNode
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
