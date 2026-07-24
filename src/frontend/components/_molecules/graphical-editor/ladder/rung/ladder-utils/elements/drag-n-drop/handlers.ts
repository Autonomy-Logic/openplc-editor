import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'

import type { BasicNodeData, HandleBranch } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { PlaceholderNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { disconnectNodes } from '../../edges'
import { removeNode } from '../../nodes'
import { removeElement } from '..'
import { spliceNodeIntoEdgeChain } from '../core'
import { updateDiagramElementsPosition } from '../diagram'
import {
  getBranch,
  insertIntoBranch,
  reconcileBranchNodeIds,
  removeBranchElement,
  removeRailBranchHandle,
  replaceVariableWithBranch,
  startParallelInBranch,
} from '../handle-branch'
import { removeEmptyParallelConnections, startParallelConnection } from '../parallel'
import { removePlaceholderElements } from '../placeholder'
import { appendSerialConnection } from '../serial'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type DropResult = { nodes: Node[]; edges: Edge[]; handleBranches?: HandleBranch[] }

/**
 * Shared context built once in onElementDrop and passed to handlers that need
 * both the current rung state (with copycat/placeholders) and prepared state.
 */
export type DropContext = {
  rung: RungLadderState
  oldStateRung: RungLadderState
  node: Node
  copycatNode: Node
  selectedPlaceholder: PlaceholderNode
  oldNodeIndex: number
  selectedPlaceholderIndex: number
  preparedNodes: Node[]
  preparedEdges: Edge[]
}

// ---------------------------------------------------------------------------
// Shared private helpers
// ---------------------------------------------------------------------------

/**
 * Insert a node into the nodes array at the correct position for the layout algorithm.
 * `updateDiagramElementsPosition` processes nodes in array order and looks up predecessors
 * from already-processed nodes. Appending at the end would cause successors to be processed
 * before this node, making them "invisible" to the layout and getting skipped.
 *
 * Strategy: insert the node just before its edge-chain successor (the target of its outgoing edge).
 * If no successor is found, append at the end (safe for branch-context nodes which skip layout).
 */
function insertNodeInOrder(nodes: Node[], newNode: Node, edges: Edge[]): Node[] {
  const outHandle = (newNode.data as BasicNodeData).outputConnector?.id
  const outEdge = edges.find((e) => e.source === newNode.id && e.sourceHandle === outHandle)
  if (outEdge) {
    const successorIdx = nodes.findIndex((n) => n.id === outEdge.target)
    if (successorIdx !== -1) {
      const result = [...nodes]
      result.splice(successorIdx, 0, newNode)
      return result
    }
  }
  return [...nodes, newNode]
}

/**
 * Remove a branch element and collapse any resulting empty parallels.
 * Wraps removeBranchElement with removeEmptyParallelConnections + reconcileBranchNodeIds.
 */
function removeBranchElementAndCollapse(
  rung: RungLadderState,
  nodeId: string,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } {
  const result = removeBranchElement(rung, nodeId)
  let { nodes: branchNodes, edges: branchEdges } = result
  let handleBranches = result.handleBranches

  // Collapse empty parallels within the branch (e.g. after removing a parallel-path element)
  const cleaned = removeEmptyParallelConnections({ ...rung, nodes: branchNodes, edges: branchEdges })
  branchNodes = cleaned.nodes
  branchEdges = cleaned.edges

  // Reconcile branch nodeIds after parallel collapse may have removed OPEN/CLOSE nodes
  handleBranches = handleBranches
    .map((branch) => ({
      ...branch,
      nodeIds: reconcileBranchNodeIds({ ...rung, nodes: branchNodes, edges: branchEdges, handleBranches }, branch),
    }))
    .filter((branch) => branch.nodeIds.length > 0)

  // Clean up rail handles for branches that were removed (empty after reconciliation)
  const removedBranches = (rung.handleBranches ?? []).filter(
    (b) => !handleBranches.some((nb) => nb.blockId === b.blockId && nb.handleId === b.handleId),
  )
  for (const removed of removedBranches) {
    branchNodes = removeRailBranchHandle(branchNodes, removed.blockId, removed.handleId, removed.direction)
  }

  return { nodes: branchNodes, edges: branchEdges, handleBranches }
}

/**
 * Remove a node from its source context (main-rail or branch).
 * For branch nodes, delegates to removeBranchElementAndCollapse.
 * For main-rail nodes, uses removeNode + disconnectNodes + removeEmptyParallelConnections.
 */
function removeFromSourceContext(
  rung: RungLadderState,
  nodeId: string,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } {
  const element = rung.nodes.find((n) => n.id === nodeId)
  if (!element) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }

  const branchCtx = (element.data as BasicNodeData).branchContext
  if (branchCtx) {
    return removeBranchElementAndCollapse(rung, nodeId)
  }

  // Main-rail: removeNode + disconnectNodes + removeEmptyParallelConnections
  const newNodes = removeNode(rung, nodeId)
  const outEdge = rung.edges.find(
    (e) => e.source === nodeId && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
  )
  if (!outEdge) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }

  const newEdges = disconnectNodes(rung, outEdge.source, outEdge.target)

  const { nodes: cleanedNodes, edges: cleanedEdges } = removeEmptyParallelConnections({
    ...rung,
    nodes: newNodes,
    edges: newEdges,
  })

  return { nodes: cleanedNodes, edges: cleanedEdges, handleBranches: rung.handleBranches ?? [] }
}

/**
 * Remove a node from its source context and build a new RungLadderState.
 * Used by all cross-context handlers.
 */
function removeAndBuildRung(
  oldStateRung: RungLadderState,
  nodeId: string,
): { rungAfterRemove: RungLadderState; handleBranches: HandleBranch[] } {
  const removed = removeFromSourceContext(oldStateRung, nodeId)
  return {
    rungAfterRemove: {
      ...oldStateRung,
      nodes: removed.nodes,
      edges: removed.edges,
      handleBranches: removed.handleBranches,
    },
    handleBranches: removed.handleBranches,
  }
}

/**
 * Run layout and return a DropResult.
 */
function layoutAndReturn(
  oldStateRung: RungLadderState,
  nodes: Node[],
  edges: Edge[],
  handleBranches?: HandleBranch[],
): DropResult {
  const { nodes: diagramNodes, edges: diagramEdges } = updateDiagramElementsPosition(
    {
      ...oldStateRung,
      nodes,
      edges,
      ...(handleBranches && { handleBranches }),
    },
    oldStateRung.defaultBounds as [number, number],
    // `nodes` may have had its variable nodes stripped by prepareDropState;
    // the pre-drop rung still holds them, so pass it as the identity source
    // to keep variable-node ids stable across the rebuild.
    oldStateRung.nodes,
  )
  return { nodes: diagramNodes, edges: diagramEdges, handleBranches }
}

// ---------------------------------------------------------------------------
// Handler functions — one per drop action type
// ---------------------------------------------------------------------------

/**
 * Path 1: Drop back on original position (restore).
 */
export function handleRestore(ctx: DropContext): DropResult {
  const resultNodes = [...ctx.preparedNodes]
  const resultEdges = [...ctx.preparedEdges]

  resultNodes[resultNodes.indexOf(ctx.copycatNode)] = {
    ...ctx.node,
    id: ctx.node.id,
    dragging: false,
  }
  resultEdges.forEach((edge, index) => {
    if (edge.source === ctx.copycatNode.id) {
      resultEdges[index] = { ...edge, source: ctx.node.id, id: edge.id.replace('copycat_', '') }
    }
    if (edge.target === ctx.copycatNode.id) {
      resultEdges[index] = { ...edge, target: ctx.node.id, id: edge.id.replace('copycat_', '') }
    }
  })

  const cleanedNodes = removePlaceholderElements(resultNodes)

  return layoutAndReturn(ctx.rung, cleanedNodes, resultEdges)
}

/**
 * Path 2: any → branch parallel.
 */
export function handleBranchParallel(oldStateRung: RungLadderState, node: Node, aboveElement: Node): DropResult {
  const { rungAfterRemove } = removeAndBuildRung(oldStateRung, node.id)
  const parallel = startParallelInBranch(rungAfterRemove, aboveElement, node)
  return layoutAndReturn(oldStateRung, parallel.nodes, parallel.edges, parallel.handleBranches)
}

/**
 * Paths 3 & 4: main parallel (branch source or main source).
 */
export function handleMainParallel(ctx: DropContext, sourceIsBranch: boolean): DropResult {
  if (sourceIsBranch) {
    // Path 3: branch → main-rail parallel
    const { rungAfterRemove, handleBranches } = removeAndBuildRung(ctx.oldStateRung, ctx.node.id)
    const movedNode = { ...ctx.node, data: { ...ctx.node.data, branchContext: undefined } }

    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(
      rungAfterRemove,
      { selected: ctx.selectedPlaceholder, index: 0 },
      movedNode,
    )

    return layoutAndReturn(ctx.oldStateRung, parallelNodes, parallelEdges, handleBranches)
  }

  // Path 4: main → main parallel (copycat-aware)
  const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(
    { ...ctx.rung, nodes: ctx.preparedNodes, edges: ctx.preparedEdges },
    {
      selected: ctx.selectedPlaceholder,
      index:
        ctx.oldNodeIndex < ctx.selectedPlaceholderIndex
          ? ctx.selectedPlaceholderIndex - 1
          : ctx.selectedPlaceholderIndex,
    },
    ctx.node,
  )

  // Remove the copycat node. `parallelNodes` derives from preparedNodes
  // (variables stripped) — pass the pre-drop rung as identity source so the
  // variable-node rebuild keeps stable ids.
  const { nodes: cleanedNodes, edges: cleanedEdges } = removeElement(
    { ...ctx.rung, nodes: parallelNodes, edges: parallelEdges },
    ctx.copycatNode,
    ctx.oldStateRung.nodes,
  )

  return { nodes: cleanedNodes, edges: cleanedEdges }
}

/**
 * Path 5: any → branch serial.
 */
export function handleBranchSerial(
  oldStateRung: RungLadderState,
  node: Node,
  target: { blockId: string; handleId: string; direction: 'input' | 'output'; insertIndex: number },
): DropResult {
  const { rungAfterRemove } = removeAndBuildRung(oldStateRung, node.id)

  // Adjust insertIndex if the removed node was before the insertion point in nodeIds
  const branch = getBranch(oldStateRung, target.blockId, target.handleId)
  const removedNodeIndex = branch?.nodeIds.indexOf(node.id) ?? -1
  let adjustedInsertIndex =
    removedNodeIndex !== -1 && removedNodeIndex < target.insertIndex ? target.insertIndex - 1 : target.insertIndex

  // Clamp to valid range: parallel collapse may have removed OPEN/CLOSE nodes,
  // shrinking nodeIds below the original insertIndex.
  const branchAfterRemove = getBranch(rungAfterRemove, target.blockId, target.handleId)
  if (branchAfterRemove) {
    adjustedInsertIndex = Math.min(adjustedInsertIndex, branchAfterRemove.nodeIds.length)
  }

  const inserted = insertIntoBranch(
    rungAfterRemove,
    {
      blockId: target.blockId,
      handleId: target.handleId,
      direction: target.direction,
      insertIndex: adjustedInsertIndex,
    },
    node,
  )

  return layoutAndReturn(oldStateRung, inserted.nodes, inserted.edges, inserted.handleBranches)
}

/**
 * Path 6: any → branch parallel-path (splice into edge chain within branch).
 */
export function handleBranchParallelPath(
  oldStateRung: RungLadderState,
  node: Node,
  targetNode: Node,
  branchContext: NonNullable<BasicNodeData['branchContext']>,
  position: 'left' | 'right',
): DropResult {
  const { rungAfterRemove, handleBranches } = removeAndBuildRung(oldStateRung, node.id)
  const movedNode = { ...node, data: { ...node.data, branchContext } }

  const splicedEdges = spliceNodeIntoEdgeChain(rungAfterRemove.edges, targetNode.id, targetNode, position, movedNode)

  if (!splicedEdges) {
    return { nodes: oldStateRung.nodes, edges: oldStateRung.edges }
  }

  const newNodes = insertNodeInOrder(rungAfterRemove.nodes, movedNode, splicedEdges)
  return layoutAndReturn(oldStateRung, newNodes, splicedEdges, handleBranches)
}

/**
 * Path 7: any → empty block handle (create new branch).
 */
export function handleBranchCreate(
  oldStateRung: RungLadderState,
  node: Node,
  target: {
    blockId: string
    handleId: string
    direction: 'input' | 'output'
    handlePosition: { x: number; y: number }
  },
): DropResult {
  const { rungAfterRemove } = removeAndBuildRung(oldStateRung, node.id)
  const result = replaceVariableWithBranch(rungAfterRemove, target, node)
  return layoutAndReturn(oldStateRung, result.nodes, result.edges, result.handleBranches)
}

/**
 * Paths 8 & 9: main serial (branch source or main source).
 */
export function handleMainSerial(ctx: DropContext, sourceIsBranch: boolean): DropResult {
  if (sourceIsBranch) {
    // Path 8: branch → main-rail serial
    const { rungAfterRemove, handleBranches } = removeAndBuildRung(ctx.oldStateRung, ctx.node.id)
    const movedNode = { ...ctx.node, data: { ...ctx.node.data, branchContext: undefined } }

    const mainRelated = ctx.selectedPlaceholder.data.relatedNode
    if (!mainRelated) return { nodes: ctx.oldStateRung.nodes, edges: ctx.oldStateRung.edges }

    const position = ctx.selectedPlaceholder.data.position as 'left' | 'right'

    const splicedEdges = spliceNodeIntoEdgeChain(
      rungAfterRemove.edges,
      mainRelated.id,
      mainRelated,
      position,
      movedNode,
    )

    if (!splicedEdges) return { nodes: ctx.oldStateRung.nodes, edges: ctx.oldStateRung.edges }

    const newNodes = insertNodeInOrder(rungAfterRemove.nodes, movedNode, splicedEdges)
    return layoutAndReturn(ctx.oldStateRung, newNodes, splicedEdges, handleBranches)
  }

  // Path 9: main → main serial (copycat-aware)
  const { nodes: serialNodes, edges: serialEdges } = appendSerialConnection(
    { ...ctx.rung, nodes: ctx.preparedNodes, edges: ctx.preparedEdges },
    {
      selected: ctx.selectedPlaceholder,
      index:
        ctx.oldNodeIndex < ctx.selectedPlaceholderIndex
          ? ctx.selectedPlaceholderIndex - 1
          : ctx.selectedPlaceholderIndex,
    },
    ctx.node,
  )

  // Remove the copycat node. `serialNodes` derives from preparedNodes
  // (variables stripped) — pass the pre-drop rung as identity source so the
  // variable-node rebuild keeps stable ids.
  const { nodes: cleanedNodes, edges: cleanedEdges } = removeElement(
    { ...ctx.rung, nodes: serialNodes, edges: serialEdges },
    ctx.copycatNode,
    ctx.oldStateRung.nodes,
  )

  return { nodes: cleanedNodes, edges: cleanedEdges }
}
