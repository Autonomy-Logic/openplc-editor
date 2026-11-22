import type { RungLadderState } from '@root/frontend/store/slices'
import { findRailId, getBranch } from '@root/middleware/shared/utils/ladder-layout'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import { blockParameterSide } from '../../../../../../../../utils/graphical/in-out-pin-rules'
import { buildHandle } from '../../../../../../../_atoms/graphical-editor/ladder/handle'
// Import from node-builders directly (not the atoms barrel) — the barrel
// re-exports the LD React components, which import the store, which would
// create a circular load chain back through `removeElements` → `slice.ts`.
import { checkIfElementIsNode, nodesBuilder } from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type {
  BasicNodeData,
  BlockVariant,
  HandleBranch,
  ParallelNode,
} from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge, disconnectNodes, removeEdge } from '../../edges'
import { buildGenericNode, removeNode } from '../../nodes'
import { spliceEdgeAndInsertNode, wireParallelAroundElement } from '../core'
import { findAllParallelsDepthAndNodes, findParallelsInRung, getNodesInsideParallel } from '../utils'

export { getBranch, hasBranchOnHandle } from '@root/middleware/shared/utils/ladder-layout'

/**
 * Check if a block has any handle branches.
 */
export function blockHasBranches(rung: RungLadderState, blockId: string): boolean {
  return rung.handleBranches?.some((b) => b.blockId === blockId) ?? false
}

/**
 * Walk every branch in the rung and collect the parallel-path nodes that belong to
 * the deepest nested parallel region of each branch.
 *
 * Main-rail's getDeepestNodesInsideParallels uses node array order as a proxy for
 * nesting depth, which works because main-rail OPEN/CLOSE pairs are inserted in
 * nesting order. Branch parallels don't honor that order — nested OPEN/CLOSE pairs
 * are appended at creation time, so the outer CLOSE often appears BEFORE the nested
 * OPEN in `rung.nodes`. The depth-aware lookup below uses findAllParallelsDepthAndNodes,
 * which derives depth from the parallel structure itself rather than from array order.
 */
export function getDeepestBranchParallelNodes(rung: RungLadderState): Set<string> {
  const result = new Set<string>()
  if (!rung.handleBranches?.length) return result
  for (const branch of rung.handleBranches) {
    for (const id of branch.nodeIds) {
      const n = rung.nodes.find((nd) => nd.id === id)
      if (!n || n.type !== 'parallel' || (n as ParallelNode).data.type !== 'open') continue
      const regions = Object.values(findAllParallelsDepthAndNodes(rung, n as ParallelNode))
      if (regions.length === 0) continue
      const maxDepth = regions.reduce((m, r) => Math.max(m, r.depth), -1)
      for (const r of regions) {
        if (r.depth !== maxDepth) continue
        for (const node of r.nodes.parallel) result.add(node.id)
      }
    }
  }
  return result
}

/**
 * Every parallel-path or serial-chain node inside any branch parallel, at any depth.
 * Branch-aware counterpart to getNodesInsideAllParallels.
 */
export function getNodesInsideAllBranchParallels(rung: RungLadderState): Set<string> {
  const result = new Set<string>()
  if (!rung.handleBranches?.length) return result
  for (const branch of rung.handleBranches) {
    for (const id of branch.nodeIds) {
      const n = rung.nodes.find((nd) => nd.id === id)
      if (!n || n.type !== 'parallel' || (n as ParallelNode).data.type !== 'open') continue
      const regions = Object.values(findAllParallelsDepthAndNodes(rung, n as ParallelNode))
      for (const r of regions) {
        for (const node of r.nodes.parallel) result.add(node.id)
        for (const node of r.nodes.serial) result.add(node.id)
      }
    }
  }
  return result
}

/**
 * Check whether `blockId` sits inside the serial chain of any parallel OPEN/CLOSE pair.
 *
 * A block in parallel with other main-rail content has a layout dependency the branch
 * machinery can't satisfy cleanly: growing the block to fit branches changes the parallel-
 * path Y of its siblings (or vice versa), so the diagram ends up with overlapping content
 * regardless of which side we re-solve from. Used as a guard before allowing branch ops.
 */
export function isBlockInsideMainParallel(rung: RungLadderState, blockId: string): boolean {
  const parallels = findParallelsInRung(rung)
  for (const openNode of parallels) {
    const closeNode = rung.nodes.find((n) => n.id === openNode.data.parallelCloseReference)
    if (!closeNode) continue
    const { serial } = getNodesInsideParallel(rung, closeNode)
    if (serial.some((n) => n.id === blockId)) return true
  }
  return false
}

/**
 * Determine if a contact or coil can be placed on a given block handle.
 * Only BOOL-compatible handles support element branches.
 */
export function canPlaceElementOnHandle(handleVariableType: BlockVariant['variables'][0]): boolean {
  const typeDef = handleVariableType.type
  if (typeDef.definition === 'base-type' && typeDef.value.toUpperCase() === 'BOOL') return true
  if (typeDef.definition === 'generic-type') {
    const v = typeDef.value.toUpperCase()
    if (v === 'ANY' || v === 'ANY_BIT') return true
  }
  return false
}

/**
 * Add a dynamic branch handle to a power rail node.
 * For input branches: adds a source handle to the left rail.
 * For output branches: adds a target handle to the right rail.
 */
export function addRailBranchHandle(
  nodes: Node[],
  blockId: string,
  handleId: string,
  direction: 'input' | 'output',
  handleY: number,
): Node[] {
  const railId = findRailId(nodes, direction === 'input' ? 'left' : 'right')
  if (!railId) return nodes
  const rail = nodes.find((n) => n.id === railId)
  if (!rail) return nodes

  const railData = rail.data as BasicNodeData
  const branchHandleId = `branch_${blockId}_${handleId}`

  // Don't add if handle already exists
  if (railData.handles.some((h) => h.id === branchHandleId)) return nodes

  const isLeftRail = direction === 'input'
  const newHandle = buildHandle({
    id: branchHandleId,
    position: isLeftRail ? Position.Right : Position.Left,
    type: isLeftRail ? 'source' : 'target',
    isConnectable: false,
    glbX: railData.handles[0]?.glbPosition.x ?? 0,
    glbY: handleY,
    relX: railData.handles[0]?.relPosition.x ?? 0,
    relY: handleY - rail.position.y,
    style: isLeftRail ? { top: handleY - rail.position.y, right: -3 } : { top: handleY - rail.position.y, left: -3 },
  })

  return nodes.map((n) => {
    if (n.id !== railId) return n
    const data = n.data as BasicNodeData
    return {
      ...n,
      data: {
        ...data,
        handles: [...data.handles, newHandle],
        ...(isLeftRail
          ? { outputHandles: [...(data.outputHandles ?? []), newHandle] }
          : { inputHandles: [...(data.inputHandles ?? []), newHandle] }),
      },
    }
  })
}

/**
 * Remove a dynamic branch handle from a power rail node.
 * Inverse of addRailBranchHandle.
 */
export function removeRailBranchHandle(
  nodes: Node[],
  blockId: string,
  handleId: string,
  direction: 'input' | 'output',
): Node[] {
  const railId = findRailId(nodes, direction === 'input' ? 'left' : 'right')
  if (!railId) return nodes
  const branchHandleId = `branch_${blockId}_${handleId}`

  return nodes.map((n) => {
    if (n.id !== railId) return n
    const data = n.data as BasicNodeData
    const newHandles = data.handles.filter((h) => h.id !== branchHandleId)
    return {
      ...n,
      data: {
        ...data,
        handles: newHandles,
        inputHandles: newHandles.filter((h) => h.type === 'target'),
        outputHandles: newHandles.filter((h) => h.type === 'source'),
      },
    }
  })
}

/**
 * Register a new handle branch in the rung's handleBranches metadata.
 */
export function addHandleBranch(handleBranches: HandleBranch[] | undefined, branch: HandleBranch): HandleBranch[] {
  return [...(handleBranches ?? []), branch]
}

/**
 * Insert a new element at a specified position within an existing branch.
 * Composes shared primitives: buildGenericNode, buildEdge.
 *
 * For a branch with nodeIds = [A, B]:
 *   insertIndex=0 → splits edge from rail → A, inserts before A
 *   insertIndex=1 → splits edge from A → B, inserts between A and B
 *   insertIndex=2 → splits edge from B → block, inserts after B
 */
export function insertIntoBranch(
  rung: RungLadderState,
  target: {
    blockId: string
    handleId: string
    direction: 'input' | 'output'
    insertIndex: number
  },
  nodeOrType: string | Node,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode: Node } {
  const branch = getBranch(rung, target.blockId, target.handleId)
  if (!branch) {
    throw new Error(`No branch found for block ${target.blockId} handle ${target.handleId}`)
  }

  // Resolve actual rail node id (suffixed with rung id on this architecture).
  const isInput = target.direction === 'input'
  const railId = findRailId(rung.nodes, isInput ? 'left' : 'right')
  if (!railId) {
    throw new Error(`Could not find ${isInput ? 'left' : 'right'} rail in rung`)
  }

  // Step 1: Build or use existing element node
  const newElement: Node =
    typeof nodeOrType === 'string'
      ? (buildGenericNode({
          nodeType: nodeOrType,
          id: `${nodeOrType.toUpperCase()}_${uuidv4()}`,
          posX: 0,
          posY: 0,
          handleX: 0,
          handleY: 0,
        }) as Node)
      : { ...nodeOrType, data: { ...nodeOrType.data } }

  // Set branch context marker
  ;(newElement.data as BasicNodeData).branchContext = {
    blockId: target.blockId,
    handleId: target.handleId,
    direction: target.direction,
  }

  // Step 2: Find the edge to split based on insertIndex
  const branchHandleId = `branch_${target.blockId}_${target.handleId}`
  const { nodeIds } = branch
  const idx = target.insertIndex

  // Helper to resolve the actual output handle ID for a node in the branch spine.
  // Parallel OPEN/CLOSE nodes use 'output-right', regular nodes use 'output'.
  const resolveOutputHandle = (nodeId: string): string => {
    const n = rung.nodes.find((nd) => nd.id === nodeId)
    return (n?.data as BasicNodeData | undefined)?.outputConnector?.id ?? 'output'
  }
  // Helper to resolve the actual input handle ID for a node in the branch spine.
  const resolveInputHandle = (nodeId: string): string => {
    const n = rung.nodes.find((nd) => nd.id === nodeId)
    return (n?.data as BasicNodeData | undefined)?.inputConnector?.id ?? 'input'
  }

  let sourceId: string
  let sourceHandle: string | undefined
  let targetId: string
  let targetHandle: string | undefined

  if (isInput) {
    // Input branch: rail → nodeIds[0] → ... → nodeIds[n-1] → block
    sourceId = idx === 0 ? railId : nodeIds[idx - 1]
    sourceHandle = idx === 0 ? branchHandleId : resolveOutputHandle(nodeIds[idx - 1])
    targetId = idx === nodeIds.length ? target.blockId : nodeIds[idx]
    targetHandle = idx === nodeIds.length ? target.handleId : resolveInputHandle(nodeIds[idx])
  } else {
    // Output branch: block → nodeIds[0] → ... → nodeIds[n-1] → rail
    sourceId = idx === 0 ? target.blockId : nodeIds[idx - 1]
    sourceHandle = idx === 0 ? target.handleId : resolveOutputHandle(nodeIds[idx - 1])
    targetId = idx === nodeIds.length ? railId : nodeIds[idx]
    targetHandle = idx === nodeIds.length ? branchHandleId : resolveInputHandle(nodeIds[idx])
  }

  // Find the existing edge between sourceId/sourceHandle → targetId/targetHandle
  const oldEdge = rung.edges.find(
    (e) =>
      e.source === sourceId &&
      e.target === targetId &&
      e.sourceHandle === sourceHandle &&
      e.targetHandle === targetHandle,
  )

  // Step 3: Remove old edge, create two new edges via shared core utility
  if (!oldEdge) {
    console.warn(
      `insertIntoBranch: expected edge ${sourceId}[${sourceHandle}] → ${targetId}[${targetHandle}] not found — branch metadata may be stale`,
    )
  }
  const newEdges = oldEdge
    ? spliceEdgeAndInsertNode(rung.edges, oldEdge, newElement.id, 'input', 'output')
    : [...rung.edges]

  // Step 4: Splice new element ID into branch's nodeIds
  const newNodeIds = [...nodeIds]
  newNodeIds.splice(idx, 0, newElement.id)

  const handleBranches = (rung.handleBranches ?? []).map((b) =>
    b.blockId === target.blockId && b.handleId === target.handleId ? { ...b, nodeIds: newNodeIds } : b,
  )

  // Step 5: Add element to nodes array
  const newNodes = [...rung.nodes, newElement]

  return { nodes: newNodes, edges: newEdges, handleBranches, newNode: newElement }
}

/**
 * Remove a branch element from its branch.
 * Handles edge reconnection, metadata cleanup, and rail handle removal.
 *
 * - Multi-element branch: splices nodeId out, uses disconnectNodes to bridge edges.
 * - Last element: removes both edges without bridging, removes rail handle and branch entry.
 *   The Variable node is restored automatically by updateVariableBlockPosition in the layout pass.
 */
export function removeBranchElement(
  rung: RungLadderState,
  elementId: string,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } {
  const element = rung.nodes.find((n) => n.id === elementId)
  if (!element) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  const ctx = (element.data as BasicNodeData).branchContext
  if (!ctx) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  const branch = getBranch(rung, ctx.blockId, ctx.handleId)
  if (!branch) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  let newNodes = removeNode(rung, elementId)
  let newEdges: Edge[]
  let newHandleBranches: HandleBranch[]

  if (branch.nodeIds.length === 1) {
    // Last element in branch: remove both edges without bridging
    const incomingEdge = rung.edges.find((e) => e.target === elementId)
    const outgoingEdge = rung.edges.find(
      (e) => e.source === elementId && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
    )

    newEdges = [...rung.edges]
    if (incomingEdge) newEdges = removeEdge(newEdges, incomingEdge.id)
    if (outgoingEdge) newEdges = removeEdge(newEdges, outgoingEdge.id)

    // Remove rail branch handle
    newNodes = removeRailBranchHandle(newNodes, ctx.blockId, ctx.handleId, ctx.direction)

    // Remove the HandleBranch entry entirely
    newHandleBranches = (rung.handleBranches ?? []).filter(
      (b) => !(b.blockId === ctx.blockId && b.handleId === ctx.handleId),
    )
  } else {
    // Multi-element branch: bridge edges around the removed element via disconnectNodes
    const outgoingEdge = rung.edges.find(
      (e) => e.source === elementId && e.sourceHandle === (element.data as BasicNodeData).outputConnector?.id,
    )
    if (outgoingEdge) {
      newEdges = disconnectNodes(rung, elementId, outgoingEdge.target)
    } else {
      newEdges = [...rung.edges]
    }

    // Splice nodeId out of the branch
    newHandleBranches = (rung.handleBranches ?? []).map((b) =>
      b.blockId === ctx.blockId && b.handleId === ctx.handleId
        ? { ...b, nodeIds: b.nodeIds.filter((id) => id !== elementId) }
        : b,
    )
  }

  return { nodes: newNodes, edges: newEdges, handleBranches: newHandleBranches }
}

/**
 * Replace a Variable node on a block handle with a branch element (contact or coil).
 * Composes shared primitives: buildGenericNode, buildEdge.
 */
export function replaceVariableWithBranch(
  rung: RungLadderState,
  target: {
    blockId: string
    handleId: string
    direction: 'input' | 'output'
    handlePosition: { x: number; y: number }
  },
  nodeOrType: string | Node,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode: Node } {
  // Step 1: Build or use existing element node
  const newElement: Node =
    typeof nodeOrType === 'string'
      ? (buildGenericNode({
          nodeType: nodeOrType,
          id: `${nodeOrType.toUpperCase()}_${uuidv4()}`,
          posX: 0,
          posY: 0,
          handleX: 0,
          handleY: 0,
        }) as Node)
      : { ...nodeOrType, data: { ...nodeOrType.data } }

  // Set branch context marker
  ;(newElement.data as BasicNodeData).branchContext = {
    blockId: target.blockId,
    handleId: target.handleId,
    direction: target.direction,
  }

  // Step 2: Remove existing Variable node and its edge
  const isInput = target.direction === 'input'
  const varEdge = isInput
    ? rung.edges.find((e) => e.target === target.blockId && e.targetHandle === target.handleId)
    : rung.edges.find((e) => e.source === target.blockId && e.sourceHandle === target.handleId)
  const varNode = varEdge
    ? rung.nodes.find((n) => n.id === (isInput ? varEdge.source : varEdge.target) && n.type === 'variable')
    : undefined

  let newNodes = rung.nodes.filter((n) => n.id !== varNode?.id)
  let newEdges = rung.edges.filter((e) => e.id !== varEdge?.id)

  // Step 3: Add branch handle to rail — addRailBranchHandle (branch-specific)
  newNodes = addRailBranchHandle(newNodes, target.blockId, target.handleId, target.direction, target.handlePosition.y)

  // Step 4: Create edges — REUSE buildEdge
  // Resolve the actual rail node id (the prefix `left-rail` / `right-rail`
  // is followed by `-{rungId}` in the current architecture).
  const railId = findRailId(newNodes, isInput ? 'left' : 'right')
  if (!railId) {
    return { nodes: newNodes, edges: newEdges, handleBranches: rung.handleBranches ?? [], newNode: newElement }
  }
  const branchHandleId = `branch_${target.blockId}_${target.handleId}`

  if (isInput) {
    // Input branch: rail → element → block handle
    const edge1 = buildEdge(railId, newElement.id, {
      sourceHandle: branchHandleId,
      targetHandle: 'input',
    })
    const edge2 = buildEdge(newElement.id, target.blockId, {
      sourceHandle: 'output',
      targetHandle: target.handleId,
    })
    newEdges = [...newEdges, edge1, edge2]
  } else {
    // Output branch: block handle → element → rail
    const edge1 = buildEdge(target.blockId, newElement.id, {
      sourceHandle: target.handleId,
      targetHandle: 'input',
    })
    const edge2 = buildEdge(newElement.id, railId, {
      sourceHandle: 'output',
      targetHandle: branchHandleId,
    })
    newEdges = [...newEdges, edge1, edge2]
  }

  // Step 5: Register branch metadata — addHandleBranch (branch-specific)
  const handleBranches = addHandleBranch(rung.handleBranches, {
    blockId: target.blockId,
    handleId: target.handleId,
    direction: target.direction,
    nodeIds: [newElement.id],
  })

  // Step 6: Add element to nodes array
  newNodes = [...newNodes, newElement]

  return { nodes: newNodes, edges: newEdges, handleBranches, newNode: newElement }
}

/**
 * Create a parallel (OR-branch) within an existing handle branch.
 *
 * Wraps the `aboveElement` in an OPEN/CLOSE parallel pair and places the new
 * element on the parallel path. The serial spine (nodeIds) gains OPEN and CLOSE;
 * the new parallel-path element is intentionally NOT added to nodeIds.
 *
 * Composes shared primitives: nodesBuilder.parallel, buildGenericNode, buildEdge.
 */
export function startParallelInBranch(
  rung: RungLadderState,
  aboveElement: Node,
  newNode: { elementType: string; blockVariant?: unknown } | Node,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } {
  const ctx = (aboveElement.data as BasicNodeData).branchContext
  if (!ctx) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  const branch = getBranch(rung, ctx.blockId, ctx.handleId)
  if (!branch) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  const aboveIndex = branch.nodeIds.indexOf(aboveElement.id)

  // Step 1: Find predecessor and successor edges of the above element
  const incomingEdge = rung.edges.find((e) => e.target === aboveElement.id)
  const outgoingEdge = rung.edges.find(
    (e) => e.source === aboveElement.id && e.sourceHandle === (aboveElement.data as BasicNodeData).outputConnector?.id,
  )

  if (!incomingEdge || !outgoingEdge) {
    console.warn('startParallelInBranch: could not find edges for aboveElement', aboveElement.id)
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches ?? [] }
  }

  // Step 2: Build OPEN parallel — REUSE nodesBuilder.parallel
  const openParallel = nodesBuilder.parallel({
    id: `PARALLEL_OPEN_${uuidv4()}`,
    type: 'open',
    posX: 0,
    posY: 0,
    handleX: 0,
    handleY: 0,
  }) as Node
  ;(openParallel.data as BasicNodeData).branchContext = {
    blockId: ctx.blockId,
    handleId: ctx.handleId,
    direction: ctx.direction,
  }

  // Step 3: Build new element — REUSE buildGenericNode or accept pre-built node
  let newElement: Node
  if (!checkIfElementIsNode(newNode)) {
    newElement = buildGenericNode({
      nodeType: (newNode as { elementType: string }).elementType,
      id: `${(newNode as { elementType: string }).elementType.toUpperCase()}_${uuidv4()}`,
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
    }) as Node
  } else {
    newElement = newNode
  }
  ;(newElement.data as BasicNodeData).branchContext = {
    blockId: ctx.blockId,
    handleId: ctx.handleId,
    direction: ctx.direction,
  }

  // Step 4: Build CLOSE parallel — REUSE nodesBuilder.parallel
  const closeParallel = nodesBuilder.parallel({
    id: `PARALLEL_CLOSE_${uuidv4()}`,
    type: 'close',
    posX: 0,
    posY: 0,
    handleX: 0,
    handleY: 0,
  }) as Node
  ;(closeParallel.data as BasicNodeData).branchContext = {
    blockId: ctx.blockId,
    handleId: ctx.handleId,
    direction: ctx.direction,
  }
  openParallel.data.parallelCloseReference = closeParallel.id
  closeParallel.data.parallelOpenReference = openParallel.id

  // Step 5: Rewire edges via shared core utility.
  // For nested parallels (predecessor is a parent OPEN's parallel-down output, or successor
  // is a parent CLOSE's parallel-up input), route through the top handles so the edges run
  // as straight verticals. Matches startParallelConnection's handling on the main rail.
  const predecessorNode = rung.nodes.find((n) => n.id === incomingEdge.source)
  const openTargetHandle =
    predecessorNode &&
    predecessorNode.type === 'parallel' &&
    (predecessorNode as ParallelNode).data.type === 'open' &&
    incomingEdge.sourceHandle === (predecessorNode as ParallelNode).data.parallelOutputConnector?.id
      ? (openParallel.data as ParallelNode['data']).parallelInputConnector?.id
      : undefined

  const successorNode = rung.nodes.find((n) => n.id === outgoingEdge.target)
  const closeSourceHandle =
    successorNode &&
    successorNode.type === 'parallel' &&
    (successorNode as ParallelNode).data.type === 'close' &&
    outgoingEdge.targetHandle === (successorNode as ParallelNode).data.parallelInputConnector?.id
      ? (closeParallel.data as ParallelNode['data']).parallelOutputConnector?.id
      : undefined

  const { edgesToRemove, edgesToAdd } = wireParallelAroundElement({
    incomingEdge,
    outgoingEdge,
    openParallel: openParallel,
    closeParallel: closeParallel,
    aboveElement,
    newElement,
    openTargetHandle,
    closeSourceHandle,
  })
  const newEdges = [...rung.edges.filter((e) => !edgesToRemove.includes(e.id)), ...edgesToAdd]

  // Step 6: Update HandleBranch.nodeIds (outer serial spine only).
  // - If aboveElement is on the outer spine, insert OPEN/CLOSE around it there.
  // - If aboveElement is a parallel-path element (aboveIndex === -1), the new
  //   OPEN/CLOSE belong to a nested region inside some parent OPEN's parallel chain.
  //   They are discovered automatically by findAllParallelsDepthAndNodes via the
  //   rewired edges, so branch.nodeIds (which only tracks the outer spine) must NOT
  //   change.
  let newNodeIds = branch.nodeIds
  if (aboveIndex !== -1) {
    newNodeIds = [...branch.nodeIds]
    newNodeIds.splice(aboveIndex, 0, openParallel.id)
    // aboveElement is now at aboveIndex+1, insert CLOSE after it
    newNodeIds.splice(aboveIndex + 2, 0, closeParallel.id)
  }

  // Step 7: Build return value
  const newNodes = [...rung.nodes, openParallel, newElement, closeParallel]
  const newHandleBranches = (rung.handleBranches ?? []).map((b) =>
    b.blockId === branch.blockId && b.handleId === branch.handleId ? { ...b, nodeIds: newNodeIds } : b,
  )

  return { nodes: newNodes, edges: newEdges, handleBranches: newHandleBranches, newNode: newElement }
}

/**
 * Reconcile handle branches when a block's type/variant changes.
 *
 * For each existing branch on the old block:
 * - If the handle no longer exists or is no longer BOOL-compatible → remove all branch elements
 * - If the handle is preserved and still BOOL-compatible → remap IDs from old block to new block
 *
 * Must be called BEFORE main connector edge remapping in handleBlockSubmit,
 * so that branch edges get correct IDs and the main remapping loop won't find them.
 */
/**
 * Whether a branch can stay attached after its block's variant changed.
 *
 * Three things have to hold, and all three are load-bearing:
 *  - the pin still exists under the same name;
 *  - it is still on the SAME SIDE of the block. A `VAR_IN_OUT` parameter keeps its name and its
 *    type but has only an input-side pin now, so an output branch on it has nothing left to
 *    attach to — matching on name alone would remap the branch onto a handle that is no longer
 *    rendered, leaving a coil wired to nothing;
 *  - it is still BOOL-compatible, so a ladder element can sit on it at all.
 */
export function branchSurvivesBlockChange(
  branch: Pick<HandleBranch, 'handleId' | 'direction'>,
  newVariables: BlockVariant['variables'],
): boolean {
  const newVariable = newVariables.find((v) => v.name === branch.handleId)
  if (!newVariable) return false
  if (blockParameterSide(newVariable) !== branch.direction) return false
  return canPlaceElementOnHandle(newVariable)
}

export function reconcileBranches(
  rung: RungLadderState,
  oldBlockId: string,
  newBlockId: string,
  newVariables: BlockVariant['variables'],
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } {
  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]
  const handleBranches = [...(rung.handleBranches ?? [])]

  const blockBranches = handleBranches.filter((b) => b.blockId === oldBlockId)
  if (blockBranches.length === 0) {
    return { nodes: newNodes, edges: newEdges, handleBranches }
  }

  const branchesToRemove: HandleBranch[] = []
  const branchesToKeep: HandleBranch[] = []

  for (const branch of blockBranches) {
    if (branchSurvivesBlockChange(branch, newVariables)) {
      branchesToKeep.push(branch)
    } else {
      branchesToRemove.push(branch)
    }
  }

  // --- Remove dead branches ---
  for (const branch of branchesToRemove) {
    // Collect all nodes for this branch (serial spine + parallel-path)
    const branchNodeIds = new Set<string>(branch.nodeIds)
    for (const node of newNodes) {
      const ctx = (node.data as BasicNodeData).branchContext
      if (ctx && ctx.blockId === oldBlockId && ctx.handleId === branch.handleId) {
        branchNodeIds.add(node.id)
      }
    }

    // Remove nodes and connected edges
    newNodes = newNodes.filter((n) => !branchNodeIds.has(n.id))
    newEdges = newEdges.filter((e) => !branchNodeIds.has(e.source) && !branchNodeIds.has(e.target))

    // Remove rail branch handle
    newNodes = removeRailBranchHandle(newNodes, oldBlockId, branch.handleId, branch.direction)
  }

  // Filter out removed branch metadata
  const removedKeys = new Set(branchesToRemove.map((b) => `${b.blockId}_${b.handleId}`))
  let updatedHandleBranches = handleBranches.filter((b) => !removedKeys.has(`${b.blockId}_${b.handleId}`))

  // --- Remap surviving branches ---
  for (const branch of branchesToKeep) {
    const oldBranchHandleId = `branch_${oldBlockId}_${branch.handleId}`
    const newBranchHandleId = `branch_${newBlockId}_${branch.handleId}`

    // Update branchContext.blockId on all branch nodes
    newNodes = newNodes.map((n) => {
      const ctx = (n.data as BasicNodeData).branchContext
      if (ctx && ctx.blockId === oldBlockId && ctx.handleId === branch.handleId) {
        return {
          ...n,
          data: {
            ...n.data,
            branchContext: { ...ctx, blockId: newBlockId },
          },
        }
      }
      return n
    })

    // Remap rail branch handle: remove old ID, add new ID at same Y position.
    // Resolve the actual rail node id by prefix on the new architecture.
    const railId = findRailId(newNodes, branch.direction === 'input' ? 'left' : 'right')
    const rail = railId ? newNodes.find((n) => n.id === railId) : undefined
    const railData = rail?.data as BasicNodeData | undefined
    const oldRailHandle = railData?.handles.find((h) => h.id === oldBranchHandleId)
    const handleY = oldRailHandle?.glbPosition.y ?? 0

    newNodes = removeRailBranchHandle(newNodes, oldBlockId, branch.handleId, branch.direction)
    newNodes = addRailBranchHandle(newNodes, newBlockId, branch.handleId, branch.direction, handleY)

    // Remap edges that reference oldBlockId with branch handles.
    // Also update edge IDs so the main connector remapping loop won't find them.
    newEdges = newEdges.map((e) => {
      let updated = e
      let changed = false

      // Edge from element → old block (input branch)
      if (e.target === oldBlockId && e.targetHandle === branch.handleId) {
        updated = { ...updated, target: newBlockId }
        changed = true
      }
      // Edge from old block → element (output branch)
      if (e.source === oldBlockId && e.sourceHandle === branch.handleId) {
        updated = { ...updated, source: newBlockId }
        changed = true
      }
      // Edge from rail with old branch handle ID
      if (e.sourceHandle === oldBranchHandleId) {
        updated = { ...updated, sourceHandle: newBranchHandleId }
        changed = true
      }
      // Edge to rail with old branch handle ID
      if (e.targetHandle === oldBranchHandleId) {
        updated = { ...updated, targetHandle: newBranchHandleId }
        changed = true
      }

      if (changed) {
        // Rebuild ID deterministically from source/target/handles instead of string
        // replacement, which could match unrelated substrings in UUID-based IDs.
        updated = {
          ...updated,
          id: `reactflow__edge-${updated.source}${updated.sourceHandle ?? ''}-${updated.target}${updated.targetHandle ?? ''}`,
        }
      }
      return updated
    })

    // Update HandleBranch.blockId
    updatedHandleBranches = updatedHandleBranches.map((b) =>
      b.blockId === oldBlockId && b.handleId === branch.handleId ? { ...b, blockId: newBlockId } : b,
    )
  }

  return { nodes: newNodes, edges: newEdges, handleBranches: updatedHandleBranches }
}

/**
 * Convenience wrapper around reconcileBranches for block-change handlers.
 * Reconciles branches if any exist on the old block, otherwise returns undefined.
 * Callers can use the result to update nodes/edges/handleBranches in one step.
 */
export function reconcileBranchesIfNeeded(
  rung: RungLadderState,
  oldBlockId: string,
  newBlockId: string,
  newVariables: BlockVariant['variables'],
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } | undefined {
  if (!rung.handleBranches?.some((b) => b.blockId === oldBlockId)) return undefined
  return reconcileBranches(rung, oldBlockId, newBlockId, newVariables)
}

/**
 * Rebuild a branch's nodeIds by traversing the serial spine from rail to block
 * (or block to rail for output branches). Called after removeEmptyParallelConnections
 * may have removed OPEN/CLOSE nodes, promoting parallel-path elements to the serial spine.
 *
 * Traversal is preferred over simple filtering because:
 * - Filtering wouldn't add parallel-path elements promoted to the serial spine
 * - Traversal discovers the actual edge-connected chain
 */
export function reconcileBranchNodeIds(rung: RungLadderState, branch: HandleBranch): string[] {
  const branchHandleId = `branch_${branch.blockId}_${branch.handleId}`
  const isInput = branch.direction === 'input'

  // Resolve actual rail node id by prefix (suffixed with rung id on this arch).
  const leftRailId = findRailId(rung.nodes, 'left')
  const rightRailId = findRailId(rung.nodes, 'right')
  let currentId = isInput ? (leftRailId ?? '') : branch.blockId
  let currentHandle = isInput ? branchHandleId : branch.handleId
  const nodeIds: string[] = []
  const visited = new Set<string>()

  // If a rail id couldn't be resolved (defensive), return the existing nodeIds unchanged
  if (isInput && !leftRailId) return branch.nodeIds
  if (!isInput && !rightRailId) return branch.nodeIds

  while (true) {
    const edge = rung.edges.find((e) => e.source === currentId && e.sourceHandle === currentHandle)
    if (!edge) break

    const targetNode = rung.nodes.find((n) => n.id === edge.target)
    if (!targetNode) break

    // Guard against cycles in the edge graph to prevent infinite loops
    if (visited.has(targetNode.id)) break
    visited.add(targetNode.id)

    // Stop at the endpoint (block for input, rail for output)
    const endpointId = isInput ? branch.blockId : rightRailId
    if (targetNode.id === endpointId) break

    nodeIds.push(targetNode.id)

    // Follow the serial spine: use outputConnector for regular nodes,
    // outputConnector (output-right) for parallel nodes
    const nodeData = targetNode.data as BasicNodeData
    currentId = targetNode.id
    currentHandle = nodeData.outputConnector?.id ?? 'output'
  }

  return nodeIds
}

/**
 * Rebuild the handle-branch index from a rung's graph.
 *
 * `handleBranches` is runtime-only state — it is NOT persisted in the .ld file,
 * so a project loaded from disk that contains handle branches (contacts/coils
 * wired to a block's secondary input/output handles, e.g. CTUD CD/QD) comes
 * back with an empty index. Branch-aware operations (deletion cleanup,
 * `getBranch`, nodeId reconciliation) then can't find those branches and
 * corrupt the diagram on the first edit. We reconstruct the index from the
 * `branchContext` stamped on each branch node plus the block's handle
 * directions, deriving the ordered nodeIds via `reconcileBranchNodeIds`.
 */
export function deriveHandleBranches(rung: RungLadderState): HandleBranch[] {
  const seen = new Map<string, { blockId: string; handleId: string }>()
  for (const node of rung.nodes) {
    const ctx = (node.data as BasicNodeData).branchContext
    if (ctx?.blockId && ctx?.handleId) {
      seen.set(`${ctx.blockId}::${ctx.handleId}`, { blockId: ctx.blockId, handleId: ctx.handleId })
    }
  }

  const branches: HandleBranch[] = []
  for (const { blockId, handleId } of seen.values()) {
    const block = rung.nodes.find((n) => n.id === blockId)
    if (!block) continue
    const data = block.data as BasicNodeData
    const isOutput = (data.outputHandles ?? []).some((h) => h.id === handleId)
    const direction: 'input' | 'output' = isOutput ? 'output' : 'input'
    const nodeIds = reconcileBranchNodeIds(rung, { blockId, handleId, direction, nodeIds: [] })
    if (nodeIds.length > 0) branches.push({ blockId, handleId, direction, nodeIds })
  }
  return branches
}
