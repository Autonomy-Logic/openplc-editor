import type { RungLadderState } from '@root/frontend/store/slices'
import type { HandleBranch } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import type { BasicNodeData, PlaceholderNode } from '../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { toast } from '../../../../../../_features/[app]/toast/use-toast'
import { disconnectNodes } from '../edges'
import { isNodeOfType, removeNode } from '../nodes'
import { updateDiagramElementsPosition } from './diagram'
import {
  addPathToBranchParallel,
  getBranch,
  insertIntoBranch,
  insertIntoBranchParallelPath,
  reconcileAllBranchNodeIds,
  removeAllBranchesForBlock,
  removeBranchElement,
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
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
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
    return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges, handleBranches: rung.handleBranches }

  /**
   * Handle-branch placeholder routing. Three flavors:
   *   - `handleBranchTarget` without `insertIndex` AND default placeholder
   *     type → "create" placeholder over the existing Variable node slot.
   *     Routes to `replaceVariableWithBranch`.
   *   - `handleBranchTarget` with `insertIndex` AND default placeholder type
   *     → "splice" placeholder inside an existing branch's serial spine.
   *     Routes to `insertIntoBranch`.
   *   - `handleBranchTarget` with `insertIndex` AND `parallelPlaceholder`
   *     type → "parallel-create" placeholder under a spine element. Routes
   *     to `startParallelInBranch`. The placeholder's `relatedNode` is the
   *     spine element being parallelized.
   */
  const branchTarget = (selectedPlaceholder as PlaceholderNode).data.handleBranchTarget
  if (branchTarget) {
    if (typeof newNode !== 'object' || !('elementType' in newNode)) {
      return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges, handleBranches: rung.handleBranches }
    }

    // Function blocks aren't supported inside handle branches — branch
    // elements must be single-handle (contacts / coils). Reject the drop
    // with a toast and clear the placeholders.
    if (newNode.elementType === 'block') {
      toast({
        title: 'Cannot add block to handle branch',
        description: 'Handle branches only accept contacts and coils.',
        variant: 'fail',
      })
      return { nodes: removePlaceholderElements(rung.nodes), edges: rung.edges, handleBranches: rung.handleBranches }
    }

    const isParallelInBranch = selectedPlaceholder.type === 'parallelPlaceholder'
    const aboveElementId = isParallelInBranch
      ? ((selectedPlaceholder).data.relatedNode?.id ?? '')
      : ''

    // If the parallel-placeholder's spine element is already wrapped by an
    // OPEN/CLOSE pair, add another OR-path to that existing parallel
    // instead of starting a fresh OPEN/CLOSE pair (no nested parallels in
    // branches, per design).
    //
    // "Inside an existing parallel" means: there is an unmatched OPEN
    // before the target's index. Closed parallels (OPEN…CLOSE before the
    // target) don't count — a spine element sitting AFTER a CLOSE is on
    // the spine, not inside the parallel.
    const branch = getBranch(rung, branchTarget.blockId, branchTarget.handleId, branchTarget.direction)
    const existingParallel =
      isParallelInBranch && branch
        ? branch.nodeIds.findIndex((id) => id === aboveElementId)
        : -1
    let isInsideExistingParallel = false
    if (existingParallel !== -1 && branch) {
      let depth = 0
      for (let i = 0; i < existingParallel; i++) {
        const n = rung.nodes.find((n) => n.id === branch.nodeIds[i])
        if (n?.type !== 'parallel') continue
        const ptype = (n.data as { type?: string }).type
        if (ptype === 'open') depth++
        else if (ptype === 'close') depth--
      }
      isInsideExistingParallel = depth > 0
    }

    // `parallelPathSplice` placeholders chain serial elements WITHIN an
    // existing OR-path. Detect first; the rest of the routing tree is
    // unchanged.
    const result = branchTarget.parallelPathSplice
      ? insertIntoBranchParallelPath(rung, {
          blockId: branchTarget.blockId,
          handleId: branchTarget.handleId,
          direction: branchTarget.direction,
          predecessorId: branchTarget.parallelPathSplice.predecessorId,
          successorId: branchTarget.parallelPathSplice.successorId,
          newElementType: newNode.elementType,
        })
      : isParallelInBranch && isInsideExistingParallel
        ? addPathToBranchParallel(rung, {
            blockId: branchTarget.blockId,
            handleId: branchTarget.handleId,
            direction: branchTarget.direction,
            spineNodeId: aboveElementId,
            newElementType: newNode.elementType,
          })
        : isParallelInBranch
          ? startParallelInBranch(rung, {
              blockId: branchTarget.blockId,
              handleId: branchTarget.handleId,
              direction: branchTarget.direction,
              aboveElementId,
              newElementType: newNode.elementType,
            })
          : branchTarget.insertIndex === undefined
            ? replaceVariableWithBranch(rung, {
                blockId: branchTarget.blockId,
                handleId: branchTarget.handleId,
                direction: branchTarget.direction,
                newElementType: newNode.elementType,
              })
            : insertIntoBranch(rung, {
                blockId: branchTarget.blockId,
                handleId: branchTarget.handleId,
                direction: branchTarget.direction,
                insertIndex: branchTarget.insertIndex,
                newElementType: newNode.elementType,
              })

    const layoutResult = updateDiagramElementsPosition(
      {
        ...rung,
        nodes: result.nodes,
        edges: result.edges,
        handleBranches: result.handleBranches,
      },
      rung.defaultBounds as [number, number],
    )

    return {
      nodes: removePlaceholderElements(layoutResult.nodes),
      edges: layoutResult.edges,
      handleBranches: result.handleBranches,
      newNode: result.newNode,
    }
  }

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
  return { nodes: newNodes, edges: newEdges, handleBranches: rung.handleBranches, newNode: newNodeData }
}

export const removeElement = (
  rung: RungLadderState,
  element: Node,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  /**
   * Branch-element removal: delegate to the handle-branch module's
   * `removeBranchElement`. After it runs, collapse any now-empty OPEN/CLOSE
   * pairs (in case the user removed the only element on a branch's
   * parallel-path) and reconcile each branch's `nodeIds` with the live
   * edge graph (the OPEN/CLOSE pair that just collapsed left dangling
   * references in the spine).
   */
  if (
    (element.type === 'contact' || element.type === 'coil' || element.type === 'parallel') &&
    element.data.branchContext
  ) {
    const removed = removeBranchElement(rung, element)
    const collapsed = removeEmptyParallelConnections({
      ...rung,
      nodes: removed.nodes,
      edges: removed.edges,
      handleBranches: removed.handleBranches,
    })
    const reconciledHandleBranches = reconcileAllBranchNodeIds({
      ...rung,
      nodes: collapsed.nodes,
      edges: collapsed.edges,
      handleBranches: removed.handleBranches,
    })
    const layoutResult = updateDiagramElementsPosition(
      { ...rung, nodes: collapsed.nodes, edges: collapsed.edges, handleBranches: reconciledHandleBranches },
      rung.defaultBounds as [number, number],
    )
    return { nodes: layoutResult.nodes, edges: layoutResult.edges, handleBranches: reconciledHandleBranches }
  }

  /**
   * Block deletion cascade: remove every branch element on this block first,
   * so the main-rung path doesn't leave orphan branch elements with edges to
   * a non-existent block.
   */
  let workingHandleBranches = rung.handleBranches
  let workingNodesIn = rung.nodes
  let workingEdgesIn = rung.edges
  if (element.type === 'block') {
    const branchResult = removeAllBranchesForBlock(rung, element.id)
    workingNodesIn = branchResult.nodes
    workingEdgesIn = branchResult.edges
    workingHandleBranches = branchResult.handleBranches
  }
  const workingRung: RungLadderState = {
    ...rung,
    nodes: workingNodesIn,
    edges: workingEdgesIn,
    handleBranches: workingHandleBranches,
  }

  /**
   * Remove the selected element from the rung
   */
  let newNodes = removeNode(workingRung, element.id)

  /**
   * Disconnect the element from the rung
   */
  const edgeToRemove = workingRung.edges.find(
    (e) => e.source === element.id && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
  )
  if (!edgeToRemove) {
    return { nodes: workingRung.nodes, edges: workingRung.edges, handleBranches: workingHandleBranches }
  }
  let newEdges = disconnectNodes(workingRung, edgeToRemove.source, edgeToRemove.target)

  /**
   * Check if there is empty parallel connections
   * If there is, remove them
   */
  const { nodes: checkedParallelNodes, edges: checkedParallelEdges } = removeEmptyParallelConnections({
    ...workingRung,
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
      ...workingRung,
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
  return { nodes: newNodes, edges: newEdges, handleBranches: workingHandleBranches }
}

export const removeElements = (
  rung: RungLadderState,
  nodesToRemove: Node[],
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  if (!nodesToRemove || nodesToRemove.length === 0)
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  let workingRung: RungLadderState = { ...rung }
  for (const node of nodesToRemove) {
    const { nodes, edges, handleBranches } = removeElement(workingRung, node)
    workingRung = { ...workingRung, nodes, edges, handleBranches }
  }

  return { nodes: workingRung.nodes, edges: workingRung.edges, handleBranches: workingRung.handleBranches }
}
