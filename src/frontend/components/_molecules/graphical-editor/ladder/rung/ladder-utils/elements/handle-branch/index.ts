import type { RungLadderState } from '@root/frontend/store/slices'
import { newGraphicalEditorNodeID } from '@root/frontend/utils/new-graphical-editor-node-id'
import type { Edge, Node } from '@xyflow/react'

import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_CONTACT_BLOCK_HEIGHT,
  DEFAULT_CONTACT_BLOCK_WIDTH,
  DEFAULT_PLACEHOLDER_GAP,
  DEFAULT_PLACEHOLDER_HEIGHT,
  DEFAULT_PLACEHOLDER_WIDTH,
  DEFAULT_POWER_RAIL_CONNECTOR_Y,
  DEFAULT_POWER_RAIL_HEIGHT,
  DEFAULT_POWER_RAIL_WIDTH,
  DEFAULT_VARIABLE_HEIGHT,
  DEFAULT_VARIABLE_WIDTH,
} from '../../../../../../../_atoms/graphical-editor/ladder/utils/constants'
import type {
  BlockNode,
  BlockVariant,
  BranchContext,
  CoilNode,
  ContactNode,
  HandleBranch,
  ParallelNode,
  PowerRailNode,
  VariableNode,
} from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge } from '../../edges'
import { buildGenericNode } from '../../nodes'

// ============================================================================
// Constants
// ============================================================================

const BRANCH_HANDLE_PREFIX = 'branch_'

// ============================================================================
// Queries
// ============================================================================

/**
 * Build the dynamic-rail handle id for a given block handle.
 *
 * Format: `branch_${blockId}_${handleId}`. The blockId portion contains
 * underscores (e.g. `BLOCK_<uuid>`); the duplicate-rung remap parses this
 * format by matching against a known blockIdMap.
 */
export const buildRailBranchHandleId = (blockId: string, handleId: string): string =>
  `${BRANCH_HANDLE_PREFIX}${blockId}_${handleId}`

export const isRailBranchHandleId = (handleId: string | null | undefined): boolean =>
  typeof handleId === 'string' && handleId.startsWith(BRANCH_HANDLE_PREFIX)

/**
 * Build the id for the standalone power-rail node that anchors a branch
 * near its block. Per-branch rail (one per `(block, handle, direction)` tuple).
 */
export const buildBranchRailId = (blockId: string, handleId: string, direction: 'input' | 'output'): string =>
  `branch-rail-${blockId}-${handleId}-${direction}`

/**
 * Find the standalone power rail attached to a branch (the local rail piece
 * sitting near the block, replacing the dynamic handle that used to live on
 * the main rail).
 */
export const findBranchRail = (rung: RungLadderState, branch: HandleBranch): PowerRailNode | undefined => {
  const id = buildBranchRailId(branch.blockId, branch.handleId, branch.direction)
  const node = rung.nodes.find((n) => n.id === id)
  return node?.type === 'powerRail' ? node : undefined
}

export const hasBranchOnHandle = (
  rung: RungLadderState,
  blockId: string,
  handleId: string,
  direction: 'input' | 'output',
): boolean =>
  rung.handleBranches.some((b) => b.blockId === blockId && b.handleId === handleId && b.direction === direction)

export const getBranch = (
  rung: RungLadderState,
  blockId: string,
  handleId: string,
  direction: 'input' | 'output',
): HandleBranch | undefined =>
  rung.handleBranches.find((b) => b.blockId === blockId && b.handleId === handleId && b.direction === direction)

/**
 * Branches are valid only on BOOL handles other than the rail-side primary
 * (handle index 0). The primary input handle is the block's connection to
 * the main rung; the primary output handle (when present) is the OUT pin.
 */
export const canPlaceElementOnHandle = (block: BlockNode<BlockVariant>, handleId: string): boolean => {
  const inputIdx = block.data.inputHandles.findIndex((h) => h.id === handleId)
  const outputIdx = block.data.outputHandles.findIndex((h) => h.id === handleId)

  if (inputIdx === -1 && outputIdx === -1) return false
  if (inputIdx === 0 || outputIdx === 0) return false

  const handleVariable = block.data.variant.variables.find((v) => v.name === handleId)
  if (!handleVariable) return false
  return handleVariable.type.value.toUpperCase() === 'BOOL'
}

/**
 * Resolve the direction of a block handle by id. Returns undefined for the
 * primary input handle, which is not a valid branch target.
 */
export const getHandleDirection = (
  block: BlockNode<BlockVariant>,
  handleId: string,
): 'input' | 'output' | undefined => {
  const inputIdx = block.data.inputHandles.findIndex((h) => h.id === handleId)
  if (inputIdx > 0) return 'input'
  const outputIdx = block.data.outputHandles.findIndex((h) => h.id === handleId)
  if (outputIdx > 0) return 'output'
  return undefined
}

// ============================================================================
// Mutations — rail handle
// ============================================================================

/**
 * Build a standalone power-rail node that anchors a branch near its block.
 * Replaces the previous design of adding a dynamic handle to the main rail —
 * the local rail piece compacts the diagram by keeping branch wiring near
 * the FB instead of spanning the whole rung horizontally.
 *
 * Direction follows the branch's flow:
 *   - input branches  → rail variant 'left'  (handle is `source`, on the rail's right side)
 *   - output branches → rail variant 'right' (handle is `target`, on the rail's left side)
 *
 * The rail's primary handle id is overridden to `branch_<blockId>_<handleId>`
 * so existing edge walkers find it the same way they did when the handle
 * lived on the main rail.
 */
export const addRailBranchHandle = (
  rung: RungLadderState,
  params: { blockId: string; handleId: string; direction: 'input' | 'output'; y: number },
): { nodes: Node[] } => {
  // Initial X placement: directly over where the existing main-rail dynamic
  // handle would have lived. `positionBranchElements` reflows this in the
  // next layout pass.
  const block = rung.nodes.find((n) => n.id === params.blockId)
  const blockHandle =
    block && block.type === 'block'
      ? params.direction === 'input'
        ? block.data.inputHandles.find((h) => h.id === params.handleId)
        : block.data.outputHandles.find((h) => h.id === params.handleId)
      : undefined
  if (!blockHandle) return { nodes: rung.nodes }

  const branchRailId = buildBranchRailId(params.blockId, params.handleId, params.direction)
  if (rung.nodes.some((n) => n.id === branchRailId)) return { nodes: rung.nodes }

  // Position 200px from the block edge initially; reflowed by layout.
  const initialX = params.direction === 'input' ? blockHandle.glbPosition.x - 200 : blockHandle.glbPosition.x + 200
  const railY = params.y - DEFAULT_POWER_RAIL_HEIGHT / 2
  // For input branches the local rail acts as a SOURCE feeding the branch
  // element — same role the LEFT main rail plays. We pass connector='right'
  // to nodesBuilder.powerRail to get a left-rail-style rail (variant='left').
  const railNode = nodesBuilder.powerRail({
    id: branchRailId,
    posX: initialX,
    posY: railY,
    connector: params.direction === 'input' ? 'right' : 'left',
    handleX: params.direction === 'input' ? initialX + DEFAULT_POWER_RAIL_WIDTH : initialX,
    handleY: params.y,
  })

  // Override the primary handle's id to the branch-handle pattern so edges
  // and walkers find it the way they did when the handle lived on the main
  // rail. Same pattern used by walkParallelPath, reconcileBranchNodeIds,
  // updateRailForBranches, etc.
  const branchHandleId = buildRailBranchHandleId(params.blockId, params.handleId)
  railNode.data.handles[0].id = branchHandleId
  if (railNode.data.inputConnector) railNode.data.inputConnector.id = branchHandleId
  if (railNode.data.outputConnector) railNode.data.outputConnector.id = branchHandleId

  return { nodes: [...rung.nodes, railNode] }
}

/**
 * Reverse of `addRailBranchHandle`. Removes the standalone branch rail node
 * entirely.
 */
export const removeRailBranchHandle = (rung: RungLadderState, blockId: string, handleId: string): { nodes: Node[] } => {
  // Branch direction is encoded in the rail's id; we don't have it here,
  // so try both possibilities.
  const inputId = buildBranchRailId(blockId, handleId, 'input')
  const outputId = buildBranchRailId(blockId, handleId, 'output')
  return { nodes: rung.nodes.filter((n) => n.id !== inputId && n.id !== outputId) }
}

// ============================================================================
// Mutations — handleBranches index
// ============================================================================

export const addHandleBranch = (handleBranches: HandleBranch[], branch: HandleBranch): HandleBranch[] => {
  if (
    handleBranches.some(
      (b) => b.blockId === branch.blockId && b.handleId === branch.handleId && b.direction === branch.direction,
    )
  ) {
    return handleBranches
  }
  return [...handleBranches, branch]
}

export const removeHandleBranch = (
  handleBranches: HandleBranch[],
  blockId: string,
  handleId: string,
  direction: 'input' | 'output',
): HandleBranch[] =>
  handleBranches.filter((b) => !(b.blockId === blockId && b.handleId === handleId && b.direction === direction))

// ============================================================================
// Placeholders — branch creation targets
// ============================================================================

/**
 * Emit one placeholder per BOOL block handle that does not yet host a branch.
 * The placeholder lives at the position of the existing Variable node on that
 * handle — the user drags a toolbox element toward the variable's slot to
 * create the branch in place. Tagged via `data.handleBranchTarget` so
 * `addNewElement` can route to `replaceVariableWithBranch`.
 *
 * In-branch splice placeholders (for chaining elements inside an existing
 * branch) land in Phase 3.B.
 */
export const renderHandleBranchCreationPlaceholders = (rung: RungLadderState): Node[] => {
  const placeholders: Node[] = []

  rung.nodes.forEach((node) => {
    if (node.type !== 'variable') return
    const variable = node
    const block = rung.nodes.find((n) => n.id === variable.data.block.id) as BlockNode<BlockVariant> | undefined
    if (!block) return
    if (!canPlaceElementOnHandle(block, variable.data.block.handleId)) return

    const posX = variable.position.x + (DEFAULT_VARIABLE_WIDTH - DEFAULT_PLACEHOLDER_WIDTH) / 2
    const posY = variable.position.y + (DEFAULT_VARIABLE_HEIGHT - DEFAULT_PLACEHOLDER_HEIGHT) / 2
    const handleX = posX
    const handleY = variable.position.y + DEFAULT_VARIABLE_HEIGHT / 2

    const placeholder = nodesBuilder.placeholder({
      id: newGraphicalEditorNodeID(`PLACEHOLDER_BRANCH_${block.id}_${variable.data.block.handleId}`),
      type: 'default',
      relatedNode: variable,
      position: variable.data.variant === 'input' ? 'left' : 'right',
      posX,
      posY,
      handleX,
      handleY,
    })

    placeholder.data = {
      ...placeholder.data,
      handleBranchTarget: {
        blockId: variable.data.block.id,
        handleId: variable.data.block.handleId,
        direction: variable.data.variant,
      },
    }

    placeholders.push(placeholder)
  })

  return placeholders
}

// ============================================================================
// Branch creation
// ============================================================================

type ReplaceVariableWithBranchParams = {
  blockId: string
  handleId: string
  direction: 'input' | 'output'
  newElementType: string
  newElementVariant?: string
}

/**
 * Create a handle branch by replacing the Variable node currently attached to
 * a block handle with the first branch element. Composes:
 *   1. remove the Variable node and its edge
 *   2. addRailBranchHandle at the block handle's current Y
 *   3. build the new contact / coil tagged with `branchContext`
 *   4. wire edges:
 *        input branch:  rail.branchHandle ─→ newElement ─→ block.handle
 *        output branch: block.handle      ─→ newElement ─→ rail.branchHandle
 *   5. addHandleBranch with `nodeIds: [newElement.id]`
 */
export const replaceVariableWithBranch = (
  rung: RungLadderState,
  params: ReplaceVariableWithBranchParams,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
  const block = rung.nodes.find((n) => n.id === params.blockId) as BlockNode<BlockVariant> | undefined
  if (!block) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const blockHandle =
    params.direction === 'input'
      ? block.data.inputHandles.find((h) => h.id === params.handleId)
      : block.data.outputHandles.find((h) => h.id === params.handleId)
  if (!blockHandle) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  // Find and drop the Variable node currently bound to this handle.
  const variableNode = rung.nodes.find(
    (n) =>
      n.type === 'variable' &&
      n.data.block.id === params.blockId &&
      n.data.block.handleId === params.handleId &&
      n.data.variant === params.direction,
  ) as VariableNode | undefined

  let workingNodes = variableNode ? rung.nodes.filter((n) => n.id !== variableNode.id) : [...rung.nodes]
  let workingEdges = variableNode
    ? rung.edges.filter((e) => e.source !== variableNode.id && e.target !== variableNode.id)
    : [...rung.edges]

  // Add the dynamic rail handle at the block handle's Y.
  const railResult = addRailBranchHandle(
    { ...rung, nodes: workingNodes, edges: workingEdges },
    {
      blockId: params.blockId,
      handleId: params.handleId,
      direction: params.direction,
      y: blockHandle.glbPosition.y,
    },
  )
  workingNodes = railResult.nodes as typeof workingNodes

  // Build the new branch element. Wire it to the branch rail (the standalone
  // local rail piece we just created near the FB), NOT the main rail.
  // `positionBranchElements` reflows the X positions in the next layout pass.
  const branchRailId = buildBranchRailId(params.blockId, params.handleId, params.direction)
  const railNode = workingNodes.find((n) => n.id === branchRailId) as PowerRailNode | undefined
  if (!railNode) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const railHandleX = railNode.data.handles[0].glbPosition.x
  const blockHandleX = blockHandle.glbPosition.x
  const elementX = (railHandleX + blockHandleX) / 2 - DEFAULT_CONTACT_BLOCK_WIDTH / 2
  const elementY = blockHandle.glbPosition.y - DEFAULT_CONTACT_BLOCK_HEIGHT / 2

  const newElement = buildGenericNode({
    nodeType: params.newElementType,
    id: newGraphicalEditorNodeID(params.newElementType.toUpperCase()),
    posX: elementX,
    posY: elementY,
    handleX: elementX,
    handleY: blockHandle.glbPosition.y,
  })
  newElement.data = {
    ...newElement.data,
    branchContext: {
      blockId: params.blockId,
      handleId: params.handleId,
      direction: params.direction,
    },
  } as typeof newElement.data

  workingNodes = [...workingNodes, newElement] as typeof workingNodes

  // Wire the two edges that connect the new element to the rail and the block.
  const railBranchHandleId = buildRailBranchHandleId(params.blockId, params.handleId)
  const elementInputId = (newElement as ContactNode | CoilNode).data.inputConnector?.id ?? 'input'
  const elementOutputId = (newElement as ContactNode | CoilNode).data.outputConnector?.id ?? 'output'

  const newEdges =
    params.direction === 'input'
      ? [
          buildEdge(railNode.id, newElement.id, {
            sourceHandle: railBranchHandleId,
            targetHandle: elementInputId,
          }),
          buildEdge(newElement.id, params.blockId, {
            sourceHandle: elementOutputId,
            targetHandle: params.handleId,
          }),
        ]
      : [
          buildEdge(params.blockId, newElement.id, {
            sourceHandle: params.handleId,
            targetHandle: elementInputId,
          }),
          buildEdge(newElement.id, railNode.id, {
            sourceHandle: elementOutputId,
            targetHandle: railBranchHandleId,
          }),
        ]
  workingEdges = [...workingEdges, ...newEdges]

  // Register the branch in the per-rung index.
  const newBranch: HandleBranch = {
    blockId: params.blockId,
    handleId: params.handleId,
    direction: params.direction,
    nodeIds: [newElement.id],
  }
  const newHandleBranches = addHandleBranch(rung.handleBranches, newBranch)

  return {
    nodes: workingNodes,
    edges: workingEdges,
    handleBranches: newHandleBranches,
    newNode: newElement,
  }
}

// ============================================================================
// Branch boundary resolution
// ============================================================================

/**
 * The two endpoints of a branch's serial spine. For an input branch the
 * "before" anchor is the rail and the "after" anchor is the block; for an
 * output branch they're swapped. Used by insert and remove operations to
 * resolve the edges that need to be re-wired around a position in the spine.
 */
type SpineAnchor =
  | { kind: 'rail'; nodeId: string; handleId: string }
  | { kind: 'block'; nodeId: string; handleId: string }
  | { kind: 'element'; nodeId: string; inputHandleId: string; outputHandleId: string }

const resolveBranchEndpoint = (
  rung: RungLadderState,
  branch: HandleBranch,
  side: 'before' | 'after',
): SpineAnchor | undefined => {
  // For an input branch the spine flows rail -> block; for an output branch
  // it flows block -> rail. The "before" anchor sits at the start of the
  // spine, "after" sits at the end.
  const railSide: 'before' | 'after' = branch.direction === 'input' ? 'before' : 'after'

  if (side === railSide) {
    const rail = findBranchRail(rung, branch)
    if (!rail) return undefined
    return { kind: 'rail', nodeId: rail.id, handleId: buildRailBranchHandleId(branch.blockId, branch.handleId) }
  }

  return { kind: 'block', nodeId: branch.blockId, handleId: branch.handleId }
}

const resolveSpineElement = (rung: RungLadderState, nodeId: string | undefined): SpineAnchor | undefined => {
  if (!nodeId) return undefined
  const node = rung.nodes.find((n) => n.id === nodeId)
  if (!node) return undefined
  if (node.type !== 'contact' && node.type !== 'coil' && node.type !== 'parallel') return undefined
  const inputHandleId = node.data.inputConnector?.id ?? 'input'
  const outputHandleId = node.data.outputConnector?.id ?? 'output'
  return { kind: 'element', nodeId: node.id, inputHandleId, outputHandleId }
}

/**
 * Resolve the anchor at `index` within the branch's spine.
 *   - 0 .. nodeIds.length-1 → the spine element at that position
 *   - nodeIds.length          → the boundary on the "after" side
 *   - -1                       → the boundary on the "before" side
 */
const resolveAnchorAtIndex = (rung: RungLadderState, branch: HandleBranch, index: number): SpineAnchor | undefined => {
  if (index === -1) return resolveBranchEndpoint(rung, branch, 'before')
  if (index === branch.nodeIds.length) return resolveBranchEndpoint(rung, branch, 'after')
  return resolveSpineElement(rung, branch.nodeIds[index])
}

const anchorOutputHandle = (anchor: SpineAnchor): string => {
  switch (anchor.kind) {
    case 'rail':
      return anchor.handleId
    case 'block':
      return anchor.handleId
    case 'element':
      return anchor.outputHandleId
  }
}

const anchorInputHandle = (anchor: SpineAnchor): string => {
  switch (anchor.kind) {
    case 'rail':
      return anchor.handleId
    case 'block':
      return anchor.handleId
    case 'element':
      return anchor.inputHandleId
  }
}

// ============================================================================
// Placeholders — in-branch splice targets
// ============================================================================

/**
 * Emit one placeholder per gap in every branch's serial spine — including
 * before the first element and after the last. Each placeholder carries
 * `handleBranchTarget` with the `insertIndex` that `addNewElement` should
 * use to route the drop to `insertIntoBranch`.
 *
 * Position is a rough midpoint between the surrounding anchors at the
 * branch's Y. Phase 3.C's `positionBranchElements` pass will refine these
 * once branch layout is fully wired; until then the rough position is good
 * enough to render and click on.
 */
export const renderInBranchSplicePlaceholders = (rung: RungLadderState): Node[] => {
  const placeholders: Node[] = []
  // Match the main rail's placeholder spacing (DEFAULT_PLACEHOLDER_GAP = 15).
  const SIDE_GAP = DEFAULT_PLACEHOLDER_GAP

  rung.handleBranches.forEach((branch) => {
    const block = rung.nodes.find((n) => n.id === branch.blockId) as BlockNode<BlockVariant> | undefined
    if (!block) return
    const blockHandle =
      branch.direction === 'input'
        ? block.data.inputHandles.find((h) => h.id === branch.handleId)
        : block.data.outputHandles.find((h) => h.id === branch.handleId)
    if (!blockHandle) return

    const handleY = blockHandle.glbPosition.y
    const posY = handleY - DEFAULT_PLACEHOLDER_HEIGHT / 2

    // Mirror the main rail's "left + right per contact, shared at the gap
    // between adjacent contacts" model. We emit a left placeholder
    // immediately to the left of every spine contact/coil and a right
    // placeholder immediately to the right. When two contacts sit
    // adjacent, the right of one and the left of the next end up at
    // overlapping X positions (~45px apart inside the 90px gap),
    // visually reading as one shared midpoint.
    //
    // OPEN gets a LEFT placeholder (so the user can splice a serial element
    // BEFORE the parallel pair); CLOSE gets a RIGHT placeholder (splice
    // AFTER the parallel pair). Mirrors how the main rail handles parallel
    // boundaries.
    branch.nodeIds.forEach((id, idx) => {
      const node = rung.nodes.find((n) => n.id === id)
      if (!node) return

      if (node.type === 'parallel') {
        const ptype = node.data.type
        if (ptype === 'open') {
          const leftX = node.position.x - SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
          placeholders.push(buildSplicePlaceholder(branch, leftX, posY, handleY, idx, `${idx}_left`))
        } else if (ptype === 'close') {
          const rightX = node.position.x + (node.width ?? 0) + SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
          placeholders.push(buildSplicePlaceholder(branch, rightX, posY, handleY, idx + 1, `${idx}_right`))
        }
        return
      }

      if (node.type !== 'contact' && node.type !== 'coil') return

      // Left placeholder: routes to insertIndex = idx (insert before this
      // node in the spine).
      const leftX = node.position.x - SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
      placeholders.push(buildSplicePlaceholder(branch, leftX, posY, handleY, idx, `${idx}_left`))

      // Right placeholder: routes to insertIndex = idx + 1 (insert after).
      const rightX = node.position.x + (node.width ?? 0) + SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
      placeholders.push(buildSplicePlaceholder(branch, rightX, posY, handleY, idx + 1, `${idx}_right`))
    })
  })

  return placeholders
}

const buildSplicePlaceholder = (
  branch: HandleBranch,
  posX: number,
  posY: number,
  handleY: number,
  insertIndex: number,
  suffix: string,
): Node => {
  const placeholder = nodesBuilder.placeholder({
    id: newGraphicalEditorNodeID(
      `PLACEHOLDER_BRANCH_SPLICE_${branch.blockId}_${branch.handleId}_${branch.direction}_${suffix}`,
    ),
    type: 'default',
    relatedNode: undefined,
    position: 'left',
    posX,
    posY,
    handleX: posX,
    handleY,
  })

  placeholder.data = {
    ...placeholder.data,
    handleBranchTarget: {
      blockId: branch.blockId,
      handleId: branch.handleId,
      direction: branch.direction,
      insertIndex,
    },
  }

  return placeholder
}

// ============================================================================
// Insert into existing branch
// ============================================================================

type InsertIntoBranchParams = {
  blockId: string
  handleId: string
  direction: 'input' | 'output'
  insertIndex: number
  newElementType: string
}

/**
 * Splice a new contact / coil into an existing branch's serial spine at
 * `insertIndex`. Removes the edge between the two surrounding anchors,
 * inserts the new element, wires the two new edges, and updates the
 * branch's `nodeIds` array.
 */
export const insertIntoBranch = (
  rung: RungLadderState,
  params: InsertIntoBranchParams,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
  const branch = getBranch(rung, params.blockId, params.handleId, params.direction)
  if (!branch) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const block = rung.nodes.find((n) => n.id === params.blockId) as BlockNode<BlockVariant> | undefined
  if (!block) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  const blockHandle =
    params.direction === 'input'
      ? block.data.inputHandles.find((h) => h.id === params.handleId)
      : block.data.outputHandles.find((h) => h.id === params.handleId)
  if (!blockHandle) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const predecessor = resolveAnchorAtIndex(rung, branch, params.insertIndex - 1)
  const successor = resolveAnchorAtIndex(rung, branch, params.insertIndex)
  if (!predecessor || !successor) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  }

  // Build the new element at a temporary midpoint between predecessor's and
  // successor's nodes. Phase 3.C will refine via positionBranchElements.
  const predNode = rung.nodes.find((n) => n.id === predecessor.nodeId)
  const succNode = rung.nodes.find((n) => n.id === successor.nodeId)
  if (!predNode || !succNode) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const elementX =
    (predNode.position.x + (predNode.width ?? 0) + succNode.position.x) / 2 - DEFAULT_CONTACT_BLOCK_WIDTH / 2
  const elementY = blockHandle.glbPosition.y - DEFAULT_CONTACT_BLOCK_HEIGHT / 2

  const newElement = buildGenericNode({
    nodeType: params.newElementType,
    id: newGraphicalEditorNodeID(params.newElementType.toUpperCase()),
    posX: elementX,
    posY: elementY,
    handleX: elementX,
    handleY: blockHandle.glbPosition.y,
  })
  newElement.data = {
    ...newElement.data,
    branchContext: {
      blockId: params.blockId,
      handleId: params.handleId,
      direction: params.direction,
    },
  } as typeof newElement.data

  const newElementInputId = newElement.data.inputConnector?.id ?? 'input'
  const newElementOutputId = newElement.data.outputConnector?.id ?? 'output'

  // Remove the edge between the two surrounding anchors (it spans the gap
  // we're about to splice into).
  const newEdges = rung.edges.filter(
    (e) =>
      !(
        e.source === predecessor.nodeId &&
        e.sourceHandle === anchorOutputHandle(predecessor) &&
        e.target === successor.nodeId &&
        e.targetHandle === anchorInputHandle(successor)
      ),
  )

  newEdges.push(
    buildEdge(predecessor.nodeId, newElement.id, {
      sourceHandle: anchorOutputHandle(predecessor),
      targetHandle: newElementInputId,
    }),
  )
  newEdges.push(
    buildEdge(newElement.id, successor.nodeId, {
      sourceHandle: newElementOutputId,
      targetHandle: anchorInputHandle(successor),
    }),
  )

  const newNodes = [...rung.nodes, newElement]

  const newHandleBranches = rung.handleBranches.map((b) => {
    if (b.blockId !== params.blockId || b.handleId !== params.handleId || b.direction !== params.direction) return b
    const updated = [...b.nodeIds]
    updated.splice(params.insertIndex, 0, newElement.id)
    return { ...b, nodeIds: updated }
  })

  return { nodes: newNodes, edges: newEdges, handleBranches: newHandleBranches, newNode: newElement }
}

// ============================================================================
// Parallels inside branches
// ============================================================================

/**
 * Detect whether a branch's spine contains an OPEN/CLOSE parallel pair.
 * Used by layout to decide whether the branched handle's slot needs the
 * extra vertical room for the parallel-path row.
 */
export const branchHasParallel = (rung: RungLadderState, branch: HandleBranch): boolean =>
  branch.nodeIds.some((id) => rung.nodes.find((n) => n.id === id)?.type === 'parallel')

/**
 * Count the maximum number of OR-paths across every parallel pair in a
 * branch. Used by layout to size the branched handle's slot — a branch
 * with one OPEN/CLOSE and three parallel paths needs 3× the parallel-row
 * height in vertical space.
 */
export const branchParallelPathCount = (rung: RungLadderState, branch: HandleBranch): number => {
  let maxPaths = 0
  for (const id of branch.nodeIds) {
    const node = rung.nodes.find((n) => n.id === id)
    if (node?.type !== 'parallel') continue
    if (node.data.type !== 'open') continue
    const parallelOutputId = node.data.parallelOutputConnector?.id
    if (!parallelOutputId) continue
    const paths = rung.edges.filter((e) => e.source === node.id && e.sourceHandle === parallelOutputId).length
    if (paths > maxPaths) maxPaths = paths
  }
  return maxPaths
}

/**
 * For a spine element that sits inside an OPEN/CLOSE parallel pair, return
 * the OPEN and CLOSE nodes wrapping it. Used when adding a new parallel
 * path to an existing branch parallel.
 */
const getEnclosingParallelPair = (
  rung: RungLadderState,
  branch: HandleBranch,
  spineNodeId: string,
): { open: ParallelNode; close: ParallelNode } | undefined => {
  const idx = branch.nodeIds.indexOf(spineNodeId)
  if (idx === -1) return undefined

  // Walk backward to find the enclosing OPEN.
  let openNode: ParallelNode | undefined
  let depth = 0
  for (let i = idx - 1; i >= 0; i--) {
    const n = rung.nodes.find((node) => node.id === branch.nodeIds[i])
    if (n?.type !== 'parallel') continue
    const ptype = n.data.type
    if (ptype === 'close') depth++
    else if (ptype === 'open') {
      if (depth === 0) {
        openNode = n
        break
      }
      depth--
    }
  }
  if (!openNode) return undefined

  const closeId = openNode.data.parallelCloseReference
  const closeNode = rung.nodes.find((n) => n.id === closeId)
  if (!closeNode || closeNode.type !== 'parallel') return undefined
  return { open: openNode, close: closeNode }
}

type AddPathToBranchParallelParams = {
  blockId: string
  handleId: string
  direction: 'input' | 'output'
  /** The spine element wrapped by the parallel pair we're adding a path to. */
  spineNodeId: string
  newElementType: string
}

/**
 * Add a new OR-path to an existing in-branch parallel. Mirrors what
 * `startParallelConnection` does on the main rail when the dropped-on
 * element is already inside a parallel: builds a new element wired
 * OPEN.parallelOutput → newElement → CLOSE.parallelInput, leaving spine
 * untouched. Counted by `branchParallelPathCount` so layout grows the
 * slot height accordingly.
 */
export const addPathToBranchParallel = (
  rung: RungLadderState,
  params: AddPathToBranchParallelParams,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
  const branch = getBranch(rung, params.blockId, params.handleId, params.direction)
  if (!branch) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const enclosing = getEnclosingParallelPair(rung, branch, params.spineNodeId)
  if (!enclosing) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const block = rung.nodes.find((n) => n.id === params.blockId) as BlockNode<BlockVariant> | undefined
  if (!block) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  const blockHandle =
    params.direction === 'input'
      ? block.data.inputHandles.find((h) => h.id === params.handleId)
      : block.data.outputHandles.find((h) => h.id === params.handleId)
  if (!blockHandle) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const branchContext = {
    blockId: params.blockId,
    handleId: params.handleId,
    direction: params.direction,
  }

  const aboveX = rung.nodes.find((n) => n.id === params.spineNodeId)?.position.x ?? blockHandle.glbPosition.x
  const handleY = blockHandle.glbPosition.y

  const newElement = buildGenericNode({
    nodeType: params.newElementType,
    id: newGraphicalEditorNodeID(params.newElementType.toUpperCase()),
    posX: aboveX,
    posY: handleY + DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
    handleX: aboveX,
    handleY: handleY + DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  })
  newElement.data = { ...newElement.data, branchContext } as typeof newElement.data
  const inId = newElement.data.inputConnector?.id ?? 'input'
  const outId = newElement.data.outputConnector?.id ?? 'output'

  const newEdges = [
    ...rung.edges,
    buildEdge(enclosing.open.id, newElement.id, {
      sourceHandle: enclosing.open.data.parallelOutputConnector?.id,
      targetHandle: inId,
    }),
    buildEdge(newElement.id, enclosing.close.id, {
      sourceHandle: outId,
      targetHandle: enclosing.close.data.parallelInputConnector?.id,
    }),
  ]

  const newNodes = [...rung.nodes, newElement]
  return { nodes: newNodes, edges: newEdges, handleBranches: rung.handleBranches, newNode: newElement }
}

type StartParallelInBranchParams = {
  blockId: string
  handleId: string
  direction: 'input' | 'output'
  /** The spine element under which the user opened a bottom placeholder. */
  aboveElementId: string
  newElementType: string
}

/**
 * Wrap a spine element in an OPEN/CLOSE parallel pair and add a new element
 * on the parallel path. Mirrors `startParallelConnection` from the main rail
 * but does NOT rebuild the above-element with a fresh ID — branches identify
 * their elements via `branchContext` and the spine `nodeIds` index, both of
 * which would have to be remapped if the above-element's ID changed.
 *
 * Topology before (input branch direction; output is symmetric):
 *   predecessor → aboveElement → successor
 *
 * Topology after:
 *   predecessor → OPEN ─── aboveElement ─── CLOSE → successor
 *                  └──── newElement ─────┘
 *
 * Spine `nodeIds` becomes `[..., OPEN.id, aboveElement.id, CLOSE.id, ...]` —
 * OPEN/CLOSE join the spine; `aboveElement` stays where it was; `newElement`
 * is on the parallel path and reachable only via edge traversal between
 * OPEN and CLOSE.
 */
export const startParallelInBranch = (
  rung: RungLadderState,
  params: StartParallelInBranchParams,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
  const branch = getBranch(rung, params.blockId, params.handleId, params.direction)
  if (!branch) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const aboveIdx = branch.nodeIds.indexOf(params.aboveElementId)
  if (aboveIdx === -1) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const aboveElement = rung.nodes.find((n) => n.id === params.aboveElementId)
  if (!aboveElement) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const block = rung.nodes.find((n) => n.id === params.blockId) as BlockNode<BlockVariant> | undefined
  if (!block) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  const blockHandle =
    params.direction === 'input'
      ? block.data.inputHandles.find((h) => h.id === params.handleId)
      : block.data.outputHandles.find((h) => h.id === params.handleId)
  if (!blockHandle) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const predecessor = resolveAnchorAtIndex(rung, branch, aboveIdx - 1)
  const successor = resolveAnchorAtIndex(rung, branch, aboveIdx + 1)
  if (!predecessor || !successor) {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  }

  const branchContext = {
    blockId: params.blockId,
    handleId: params.handleId,
    direction: params.direction,
  }

  // Build OPEN, CLOSE, and the new parallel-path element. Initial positions
  // are throwaway — `positionBranchElements` runs as part of every layout
  // cycle and rewrites them.
  const openId = newGraphicalEditorNodeID('PARALLEL_OPEN')
  const closeId = newGraphicalEditorNodeID('PARALLEL_CLOSE')
  const handleY = blockHandle.glbPosition.y
  const aboveX = aboveElement.position.x

  const openParallelNode = nodesBuilder.parallel({
    id: openId,
    type: 'open',
    posX: aboveX - 30,
    posY: handleY,
    handleX: aboveX - 30,
    handleY,
  })
  const closeParallelNode = nodesBuilder.parallel({
    id: closeId,
    type: 'close',
    posX: aboveX + (aboveElement.width ?? DEFAULT_CONTACT_BLOCK_WIDTH) + 10,
    posY: handleY,
    handleX: aboveX + (aboveElement.width ?? DEFAULT_CONTACT_BLOCK_WIDTH) + 10,
    handleY,
  })

  // Wire OPEN/CLOSE references and tag with branchContext.
  openParallelNode.data = {
    ...openParallelNode.data,
    parallelCloseReference: closeId,
    branchContext,
  }
  closeParallelNode.data = {
    ...closeParallelNode.data,
    parallelOpenReference: openId,
    branchContext,
  }

  const newElement = buildGenericNode({
    nodeType: params.newElementType,
    id: newGraphicalEditorNodeID(params.newElementType.toUpperCase()),
    posX: aboveX,
    posY: handleY + DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
    handleX: aboveX,
    handleY: handleY + DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  })
  newElement.data = {
    ...newElement.data,
    branchContext,
  } as typeof newElement.data
  const newElementInputId = newElement.data.inputConnector?.id ?? 'input'
  const newElementOutputId = newElement.data.outputConnector?.id ?? 'output'

  // Drop the existing predecessor → aboveElement and aboveElement → successor
  // edges; they're going to be rerouted through OPEN and CLOSE.
  let newEdges = rung.edges.filter(
    (e) =>
      !(e.source === predecessor.nodeId && e.target === aboveElement.id) &&
      !(e.source === aboveElement.id && e.target === successor.nodeId),
  )

  // Predecessor → OPEN (serial spine input).
  newEdges = [
    ...newEdges,
    buildEdge(predecessor.nodeId, openId, {
      sourceHandle: anchorOutputHandle(predecessor),
      targetHandle: openParallelNode.data.inputConnector?.id,
    }),
    // OPEN → aboveElement (serial spine output).
    buildEdge(openId, aboveElement.id, {
      sourceHandle: openParallelNode.data.outputConnector?.id,
      targetHandle: anchorInputHandleForSpineNode(aboveElement),
    }),
    // aboveElement → CLOSE (serial spine input).
    buildEdge(aboveElement.id, closeId, {
      sourceHandle: anchorOutputHandleForSpineNode(aboveElement),
      targetHandle: closeParallelNode.data.inputConnector?.id,
    }),
    // CLOSE → successor (serial spine output).
    buildEdge(closeId, successor.nodeId, {
      sourceHandle: closeParallelNode.data.outputConnector?.id,
      targetHandle: anchorInputHandle(successor),
    }),
    // OPEN → newElement (parallel-path).
    buildEdge(openId, newElement.id, {
      sourceHandle: openParallelNode.data.parallelOutputConnector?.id,
      targetHandle: newElementInputId,
    }),
    // newElement → CLOSE (parallel-path).
    buildEdge(newElement.id, closeId, {
      sourceHandle: newElementOutputId,
      targetHandle: closeParallelNode.data.parallelInputConnector?.id,
    }),
  ]

  const newNodes = [...rung.nodes, openParallelNode, closeParallelNode, newElement]

  // Splice OPEN before the above-element and CLOSE after it in the spine.
  const newHandleBranches = rung.handleBranches.map((b) => {
    if (b !== branch) return b
    const updated = [...b.nodeIds]
    updated.splice(aboveIdx + 1, 0, closeId)
    updated.splice(aboveIdx, 0, openId)
    return { ...b, nodeIds: updated }
  })

  return { nodes: newNodes, edges: newEdges, handleBranches: newHandleBranches, newNode: newElement }
}

/** Output handle id of a spine element node — used to wire the spine. */
const anchorOutputHandleForSpineNode = (node: Node): string | undefined => {
  if (node.type === 'parallel') {
    return (node as ParallelNode).data.outputConnector?.id
  }
  if (node.type === 'contact' || node.type === 'coil' || node.type === 'powerRail' || node.type === 'block') {
    return (node.data as { outputConnector?: { id?: string } }).outputConnector?.id
  }
  return undefined
}

const anchorInputHandleForSpineNode = (node: Node): string | undefined => {
  if (node.type === 'parallel') {
    return (node as ParallelNode).data.inputConnector?.id
  }
  if (node.type === 'contact' || node.type === 'coil' || node.type === 'powerRail' || node.type === 'block') {
    return (node.data as { inputConnector?: { id?: string } }).inputConnector?.id
  }
  return undefined
}

// ============================================================================
// Spine reconciliation
// ============================================================================

/**
 * Rebuild a branch's `nodeIds` by walking the rung's edges from the
 * rail-side endpoint (or the block-side, for output branches) along the
 * serial-spine output handles. Used after `removeEmptyParallelConnections`
 * collapses an OPEN/CLOSE pair — the topology survives but `nodeIds` may
 * still reference the now-removed OPEN/CLOSE ids.
 */
export const reconcileBranchNodeIds = (rung: RungLadderState, branch: HandleBranch): HandleBranch => {
  // Pick the starting node (branch rail for input branches, block for output).
  const rail = findBranchRail(rung, branch)
  if (!rail) return branch

  const railHandleId = buildRailBranchHandleId(branch.blockId, branch.handleId)

  // For input branches: walk rail.branchHandle → ... → block.handleId.
  // For output branches: walk block.handleId → ... → rail.branchHandle.
  const startNodeId = branch.direction === 'input' ? rail.id : branch.blockId
  const startHandleId = branch.direction === 'input' ? railHandleId : branch.handleId
  const endNodeId = branch.direction === 'input' ? branch.blockId : rail.id

  const visited = new Set<string>()
  const newNodeIds: string[] = []

  let currentNodeId = startNodeId
  let currentSourceHandle: string | undefined = startHandleId

  // Cap iterations defensively in case of an unexpected cycle.
  for (let safety = 0; safety < 1000; safety++) {
    const outgoing = rung.edges.find((e) => e.source === currentNodeId && e.sourceHandle === currentSourceHandle)
    if (!outgoing) break
    if (outgoing.target === endNodeId) break
    if (visited.has(outgoing.target)) break

    visited.add(outgoing.target)
    newNodeIds.push(outgoing.target)

    const nextNode = rung.nodes.find((n) => n.id === outgoing.target)
    if (!nextNode) break

    // Walk further along this node's serial output. For parallels, that's
    // `outputConnector` (the spine output, NOT parallelOutputConnector).
    currentNodeId = nextNode.id
    currentSourceHandle = anchorOutputHandleForSpineNode(nextNode)
  }

  return { ...branch, nodeIds: newNodeIds }
}

// ============================================================================
// In-branch parallel placeholders
// ============================================================================

/**
 * Emit a bottom (parallel) placeholder under every spine contact/coil.
 * The drop handler decides whether this creates a brand-new OPEN/CLOSE
 * pair or adds a path to an already-existing one.
 *
 * For elements wrapped by an existing OPEN/CLOSE pair, the placeholder is
 * positioned BELOW the lowest existing parallel-path element (so dropping
 * there visibly extends the parallel downward).
 */
export const renderInBranchParallelPlaceholders = (rung: RungLadderState): Node[] => {
  const placeholders: Node[] = []

  rung.handleBranches.forEach((branch) => {
    // First pass: identify each spine contact's "wrapping" relationship.
    // A contact directly between an OPEN and its matching CLOSE is the
    // spine "above" element of that parallel — it's INSIDE a parallel and
    // shouldn't get a bottom placeholder of its own (matches main rail's
    // `nodesInsideParallels` rule).
    const aboveContactByOpen = new Map<string, Node>()
    const insideParallel = new Set<string>()
    let depth = 0
    let currentOpen: ParallelNode | null = null
    branch.nodeIds.forEach((id) => {
      const node = rung.nodes.find((n) => n.id === id)
      if (node?.type === 'parallel') {
        const ptype = node.data.type
        if (ptype === 'open') {
          depth++
          currentOpen = node
        } else if (ptype === 'close') {
          depth--
          currentOpen = null
        }
      } else if (depth > 0 && (node?.type === 'contact' || node?.type === 'coil')) {
        insideParallel.add(node.id)
        if (currentOpen) aboveContactByOpen.set(currentOpen.id, node)
      }
    })

    const emitBottom = (anchorNode: Node, relatedNode: Node, insertIndex: number, suffix: string) => {
      const width = anchorNode.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
      const posX = anchorNode.position.x + width / 2 - DEFAULT_PLACEHOLDER_WIDTH / 2
      const posY = anchorNode.position.y + (anchorNode.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT) + 10
      const handleY = posY + DEFAULT_PLACEHOLDER_HEIGHT / 2

      const placeholder = nodesBuilder.parallelPlaceholder({
        id: newGraphicalEditorNodeID(
          `PLACEHOLDER_BRANCH_PARALLEL_${branch.blockId}_${branch.handleId}_${branch.direction}_${suffix}`,
        ),
        type: 'parallel',
        relatedNode,
        position: 'bottom',
        posX,
        posY,
        handleX: posX,
        handleY,
      })

      placeholder.data = {
        ...placeholder.data,
        handleBranchTarget: {
          blockId: branch.blockId,
          handleId: branch.handleId,
          direction: branch.direction,
          insertIndex,
        },
      }

      placeholders.push(placeholder)
    }

    // (1) Bottom placeholder under each spine contact NOT inside any
    // parallel — drop here to wrap that contact in a new OPEN/CLOSE pair
    // and add an OR-path beneath it.
    branch.nodeIds.forEach((id, idx) => {
      const node = rung.nodes.find((n) => n.id === id)
      if (!node) return
      if (node.type !== 'contact' && node.type !== 'coil') return
      if (insideParallel.has(id)) return
      emitBottom(node, node, idx, `spine_${idx}`)
    })

    // (2) Bottom placeholder under each contact/coil on the BOTTOM-MOST
    // parallel path of every existing OPEN/CLOSE pair. Drop here to add
    // a new OR-path to that parallel. The placeholder's `relatedNode`
    // points back to the spine "above" contact, so the routing classifies
    // this as `isInsideExistingParallel` and dispatches to
    // `addPathToBranchParallel`.
    branch.nodeIds.forEach((id, idx) => {
      const node = rung.nodes.find((n) => n.id === id)
      if (node?.type !== 'parallel') return
      if (node.data.type !== 'open') return
      const open = node

      const aboveContact = aboveContactByOpen.get(open.id)
      if (!aboveContact) return
      const closeId = open.data.parallelCloseReference
      const closeNode = rung.nodes.find((n) => n.id === closeId)
      if (!closeNode || closeNode.type !== 'parallel') return

      const parallelOutputId = open.data.parallelOutputConnector?.id
      if (!parallelOutputId) return
      const startEdges = rung.edges.filter((e) => e.source === open.id && e.sourceHandle === parallelOutputId)
      if (startEdges.length === 0) return

      // Bottom-most path = last start edge (highest pathIndex).
      const lastStartEdge = startEdges[startEdges.length - 1]
      const bottomPath = walkParallelPath(rung, open, closeNode, lastStartEdge)
      const aboveContactIdx = branch.nodeIds.indexOf(aboveContact.id)
      bottomPath.forEach((pNode, pIdx) => {
        if (pNode.type !== 'contact' && pNode.type !== 'coil') return
        emitBottom(pNode, aboveContact, aboveContactIdx, `path_${idx}_${pIdx}`)
      })
    })
  })

  return placeholders
}

// ============================================================================
// Parallel-path serial chains
// ============================================================================

/**
 * Walk a single parallel path between OPEN and CLOSE following each node's
 * serial output handle. Returns the elements on that path, in order from
 * OPEN side to CLOSE side. Each path starts at one of OPEN's parallel-output
 * edges and ends when the next edge targets CLOSE on its parallel-input
 * handle.
 */
const walkParallelPath = (rung: RungLadderState, _open: ParallelNode, close: ParallelNode, startEdge: Edge): Node[] => {
  const path: Node[] = []
  let currentEdge: Edge | undefined = startEdge
  const visited = new Set<string>()

  for (let safety = 0; safety < 1000; safety++) {
    if (!currentEdge) break
    if (currentEdge.target === close.id) break
    if (visited.has(currentEdge.target)) break
    visited.add(currentEdge.target)

    const node = rung.nodes.find((n) => n.id === currentEdge!.target)
    if (!node) break
    path.push(node)

    const outId = anchorOutputHandleForSpineNode(node)
    currentEdge = rung.edges.find((e) => e.source === node.id && e.sourceHandle === outId)
  }

  return path
}

/**
 * Emit left/right placeholders alongside every contact/coil on a branch
 * parallel path. Lets the user chain serial elements within the path.
 *
 * Each placeholder carries a `parallelPathSplice` descriptor identifying
 * the predecessor and successor on the parallel path (which can be OPEN
 * for the leftmost slot, CLOSE for the rightmost, or another path
 * element).
 */
export const renderInBranchParallelPathPlaceholders = (rung: RungLadderState): Node[] => {
  const placeholders: Node[] = []
  const SIDE_GAP = DEFAULT_PLACEHOLDER_GAP

  rung.handleBranches.forEach((branch) => {
    branch.nodeIds.forEach((id) => {
      const node = rung.nodes.find((n) => n.id === id)
      if (node?.type !== 'parallel') return
      if (node.data.type !== 'open') return
      const open = node
      const closeId = open.data.parallelCloseReference
      if (!closeId) return
      const closeNode = rung.nodes.find((n) => n.id === closeId)
      if (!closeNode || closeNode.type !== 'parallel') return
      const close = closeNode

      const parallelOutputId = open.data.parallelOutputConnector?.id
      if (!parallelOutputId) return
      const startEdges = rung.edges.filter((e) => e.source === open.id && e.sourceHandle === parallelOutputId)

      startEdges.forEach((startEdge) => {
        const pathNodes = walkParallelPath(rung, open, close, startEdge)
        if (pathNodes.length === 0) return

        // Same model as the spine: emit left + right placeholders adjacent
        // to each path contact/coil. Adjacent path elements share a
        // visual midpoint via overlapping right-of-A / left-of-B.
        pathNodes.forEach((pNode, idx) => {
          if (pNode.type !== 'contact' && pNode.type !== 'coil') return

          const handleY = pNode.position.y + (pNode.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT) / 2
          const posY = handleY - DEFAULT_PLACEHOLDER_HEIGHT / 2

          // Left placeholder: predecessor is OPEN if idx === 0, else previous path node.
          const leftPred = idx === 0 ? (open as Node) : pathNodes[idx - 1]
          const leftX = pNode.position.x - SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
          placeholders.push(
            buildPathSplicePlaceholder(branch, open.id, leftPred.id, pNode.id, leftX, posY, handleY, `${idx}_left`),
          )

          // Right placeholder: successor is CLOSE if idx is last, else next path node.
          const rightSucc = idx === pathNodes.length - 1 ? (close as Node) : pathNodes[idx + 1]
          const rightX = pNode.position.x + (pNode.width ?? 0) + SIDE_GAP - DEFAULT_PLACEHOLDER_WIDTH / 2
          placeholders.push(
            buildPathSplicePlaceholder(branch, open.id, pNode.id, rightSucc.id, rightX, posY, handleY, `${idx}_right`),
          )
        })
      })
    })
  })

  return placeholders
}

const buildPathSplicePlaceholder = (
  branch: HandleBranch,
  parallelOpenId: string,
  predecessorId: string,
  successorId: string,
  posX: number,
  posY: number,
  handleY: number,
  suffix: string,
): Node => {
  const placeholder = nodesBuilder.placeholder({
    id: newGraphicalEditorNodeID(
      `PLACEHOLDER_BRANCH_PATH_${branch.blockId}_${branch.handleId}_${branch.direction}_${parallelOpenId}_${suffix}`,
    ),
    type: 'default',
    relatedNode: undefined,
    position: 'left',
    posX,
    posY,
    handleX: posX,
    handleY,
  })

  placeholder.data = {
    ...placeholder.data,
    handleBranchTarget: {
      blockId: branch.blockId,
      handleId: branch.handleId,
      direction: branch.direction,
      parallelPathSplice: {
        parallelOpenId,
        predecessorId,
        successorId,
      },
    },
  }

  return placeholder
}

type InsertIntoBranchParallelPathParams = {
  blockId: string
  handleId: string
  direction: 'input' | 'output'
  predecessorId: string
  successorId: string
  newElementType: string
}

/**
 * Splice a new contact/coil into the serial chain of a parallel path.
 * Removes the edge `predecessor → successor` (whether predecessor is the
 * OPEN, an existing path element, etc.) and wires
 * `predecessor → newElement → successor`.
 */
export const insertIntoBranchParallelPath = (
  rung: RungLadderState,
  params: InsertIntoBranchParallelPathParams,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[]; newNode?: Node } => {
  const branch = getBranch(rung, params.blockId, params.handleId, params.direction)
  if (!branch) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const predNode = rung.nodes.find((n) => n.id === params.predecessorId)
  const succNode = rung.nodes.find((n) => n.id === params.successorId)
  if (!predNode || !succNode) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const oldEdge = rung.edges.find((e) => e.source === params.predecessorId && e.target === params.successorId)
  if (!oldEdge) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const branchContext = {
    blockId: params.blockId,
    handleId: params.handleId,
    direction: params.direction,
  }

  // Build the new element near the path's Y, between predecessor and
  // successor's X positions. Layout will refine.
  const refY = predNode.position.y + (predNode.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT) / 2
  const midX = (predNode.position.x + (predNode.width ?? 0) + succNode.position.x) / 2
  const newElement = buildGenericNode({
    nodeType: params.newElementType,
    id: newGraphicalEditorNodeID(params.newElementType.toUpperCase()),
    posX: midX - DEFAULT_CONTACT_BLOCK_WIDTH / 2,
    posY: refY - DEFAULT_CONTACT_BLOCK_HEIGHT / 2,
    handleX: midX - DEFAULT_CONTACT_BLOCK_WIDTH / 2,
    handleY: refY,
  })
  newElement.data = { ...newElement.data, branchContext } as typeof newElement.data
  const inId = newElement.data.inputConnector?.id ?? 'input'
  const outId = newElement.data.outputConnector?.id ?? 'output'

  const newEdges = rung.edges.filter((e) => e.id !== oldEdge.id)
  newEdges.push(
    buildEdge(params.predecessorId, newElement.id, {
      sourceHandle: oldEdge.sourceHandle ?? undefined,
      targetHandle: inId,
    }),
    buildEdge(newElement.id, params.successorId, {
      sourceHandle: outId,
      targetHandle: oldEdge.targetHandle ?? undefined,
    }),
  )

  return {
    nodes: [...rung.nodes, newElement],
    edges: newEdges,
    handleBranches: rung.handleBranches,
    newNode: newElement,
  }
}

// ============================================================================
// Branch element removal + branch collapse
// ============================================================================

/**
 * Remove the dynamic rail handle and the per-rung `handleBranches` entry for
 * this branch. The Variable node restores itself on the next layout pass —
 * `renderVariableBlock`'s `hasBranchOnHandle` guard returns `false` once the
 * index entry is gone, so the variable slot is free to be regenerated.
 */
export const cleanupAfterBranchRemoval = (
  rung: RungLadderState,
  branch: HandleBranch,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  const railResult = removeRailBranchHandle(rung, branch.blockId, branch.handleId)
  return {
    nodes: railResult.nodes,
    edges: rung.edges,
    handleBranches: removeHandleBranch(rung.handleBranches, branch.blockId, branch.handleId, branch.direction),
  }
}

/**
 * Remove a single contact / coil / parallel-path element from a branch.
 * Two cases:
 *   - Spine element: reconnect surrounding anchors across the gap (existing
 *     Phase 3.B path). If the spine empties, collapse the whole branch.
 *   - Parallel-path element: drop the node + its edges, then collapse the
 *     enclosing OPEN/CLOSE pair via the standard
 *     `removeEmptyParallelConnections` (it already understands the topology
 *     since branch parallels share it with main-rail parallels). After
 *     collapse, `reconcileBranchNodeIds` rebuilds the spine from the live
 *     edge graph.
 */
export const removeBranchElement = (
  rung: RungLadderState,
  element: Node,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  if (element.type !== 'contact' && element.type !== 'coil' && element.type !== 'parallel') {
    return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }
  }
  const ctx = element.data.branchContext as BranchContext | undefined
  if (!ctx) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const branch = getBranch(rung, ctx.blockId, ctx.handleId, ctx.direction)
  if (!branch) return { nodes: rung.nodes, edges: rung.edges, handleBranches: rung.handleBranches }

  const idx = branch.nodeIds.indexOf(element.id)

  // Parallel-path element (not in spine): drop the node + its edges. The
  // caller (`removeElement` in elements/index.ts) collapses the now-empty
  // OPEN/CLOSE pair via the standard `removeEmptyParallelConnections` and
  // then calls `reconcileBranchNodeIds` to rebuild the spine.
  if (idx === -1) {
    const newNodes = rung.nodes.filter((n) => n.id !== element.id)
    const newEdges = rung.edges.filter((e) => e.source !== element.id && e.target !== element.id)
    return { nodes: newNodes, edges: newEdges, handleBranches: rung.handleBranches }
  }

  // After removal the surrounding spine collapses to predecessor + successor.
  const predecessor = resolveAnchorAtIndex(rung, branch, idx - 1)
  const successor = resolveAnchorAtIndex(rung, branch, idx + 1)

  // Drop the element and any edges touching it.
  const newNodes = rung.nodes.filter((n) => n.id !== element.id)
  let newEdges = rung.edges.filter((e) => e.source !== element.id && e.target !== element.id)

  // Reconnect predecessor → successor across the gap. Skipped when the branch
  // had only this one element (no other anchors to bridge); the cleanup pass
  // below removes the rail handle entirely instead.
  const isLastElement = branch.nodeIds.length === 1
  if (!isLastElement && predecessor && successor) {
    newEdges = [
      ...newEdges,
      buildEdge(predecessor.nodeId, successor.nodeId, {
        sourceHandle: anchorOutputHandle(predecessor),
        targetHandle: anchorInputHandle(successor),
      }),
    ]
  }

  // Update the branch index. If the spine empties, collapse the branch.
  const updatedNodeIds = branch.nodeIds.filter((id) => id !== element.id)
  if (updatedNodeIds.length === 0) {
    return cleanupAfterBranchRemoval({ ...rung, nodes: newNodes, edges: newEdges }, branch)
  }

  const newHandleBranches = rung.handleBranches.map((b) => (b === branch ? { ...b, nodeIds: updatedNodeIds } : b))
  return { nodes: newNodes, edges: newEdges, handleBranches: newHandleBranches }
}

/**
 * Reconcile every branch's spine `nodeIds` against the live edge graph.
 * Used after `removeEmptyParallelConnections` collapses an OPEN/CLOSE pair
 * inside a branch — the topology survives but `nodeIds` may still
 * reference the now-removed parallel nodes.
 */
export const reconcileAllBranchNodeIds = (rung: RungLadderState): HandleBranch[] =>
  rung.handleBranches.map((b) => reconcileBranchNodeIds(rung, b))

// ============================================================================
// Reconciliation — block variant changes
// ============================================================================

/**
 * Inspect a block-variant change and return the branches that would be
 * orphaned by it. A branch is orphaned when its handle either (a) no longer
 * exists in the new variant or (b) still exists but is no longer BOOL —
 * the type-level constraint that allows branches to live there.
 */
export const findInvalidatedBranches = (
  rung: RungLadderState,
  blockId: string,
  newVariant: BlockVariant,
): HandleBranch[] => {
  const newBoolHandleIds = new Set(
    newVariant.variables.filter((v) => v.type.value.toUpperCase() === 'BOOL').map((v) => v.name),
  )
  return rung.handleBranches.filter((b) => b.blockId === blockId && !newBoolHandleIds.has(b.handleId))
}

/**
 * Reconcile every branch on a block whose variant changed. Two outcomes:
 *
 *   1. Branches whose handle disappeared in the new variant or whose handle
 *      is no longer BOOL get DROPPED — `removeBranchElement` collapses each
 *      one through the regular path (rail handle removed, index entry
 *      removed, edges cleaned up).
 *
 *   2. Surviving branches get REMAPPED. The block-variant change rebuilds
 *      the block with a fresh uuid; without remap, surviving branches
 *      keep references to the old block id and break. We update:
 *        - `handleBranches[].blockId`
 *        - `branchContext.blockId` on every spine element node
 *        - rail-side `branch_<oldId>_<handle>` handle ids
 *        - edges whose sourceHandle / targetHandle is a `branch_*` id
 *
 * Caller is expected to ask the user for confirmation first when
 * `findInvalidatedBranches` returned a non-empty array — silently dropping
 * branches the user didn't ask to drop is bad UX.
 */
export const reconcileBranches = (
  rung: RungLadderState,
  oldBlockId: string,
  newBlockId: string,
  newVariant: BlockVariant,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  // Step 1 — drop invalidated branches via the standard removal path.
  const invalidated = findInvalidatedBranches(rung, oldBlockId, newVariant)
  let working: { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } = {
    nodes: rung.nodes,
    edges: rung.edges,
    handleBranches: rung.handleBranches,
  }
  for (const branch of invalidated) {
    const idsCopy = [...branch.nodeIds]
    for (let i = idsCopy.length - 1; i >= 0; i--) {
      const elementNode = working.nodes.find((n) => n.id === idsCopy[i])
      if (!elementNode) continue
      working = removeBranchElement({ ...rung, ...working } as RungLadderState, elementNode)
    }
  }

  // Step 2 — remap surviving branches' refs from oldBlockId to newBlockId.
  if (oldBlockId === newBlockId) return working

  const remapHandleId = (handleId: string | null | undefined): string | null | undefined => {
    if (typeof handleId !== 'string') return handleId
    const prefix = `${BRANCH_HANDLE_PREFIX}${oldBlockId}_`
    if (!handleId.startsWith(prefix)) return handleId
    return `${BRANCH_HANDLE_PREFIX}${newBlockId}_${handleId.slice(prefix.length)}`
  }

  const remappedNodes = working.nodes.map((node) => {
    if (node.type === 'powerRail') {
      const remapHandle = <T extends { id?: string | null }>(h: T): T => ({
        ...h,
        id: (remapHandleId(h.id) ?? h.id) as T['id'],
      })
      const railData = node.data as PowerRailNode['data']
      return {
        ...node,
        data: {
          ...node.data,
          handles: railData.handles.map(remapHandle),
          inputHandles: railData.inputHandles.map(remapHandle),
          outputHandles: railData.outputHandles.map(remapHandle),
        },
      }
    }

    if (
      (node.type === 'contact' || node.type === 'coil' || node.type === 'parallel') &&
      node.data.branchContext &&
      (node.data.branchContext as BranchContext).blockId === oldBlockId
    ) {
      const ctx = node.data.branchContext as BranchContext
      return {
        ...node,
        data: {
          ...node.data,
          branchContext: { ...ctx, blockId: newBlockId },
        },
      }
    }

    return node
  })

  const remappedEdges = working.edges.map((edge) => ({
    ...edge,
    sourceHandle: remapHandleId(edge.sourceHandle) ?? edge.sourceHandle,
    targetHandle: remapHandleId(edge.targetHandle) ?? edge.targetHandle,
  }))

  const remappedHandleBranches = working.handleBranches.map((b) =>
    b.blockId === oldBlockId ? { ...b, blockId: newBlockId } : b,
  )

  return {
    nodes: remappedNodes,
    edges: remappedEdges,
    handleBranches: remappedHandleBranches,
  }
}

// ============================================================================
// Layout — dynamic block-handle offsets
// ============================================================================

/**
 * Push branched handles DOWN within their owning block so the branch element
 * doesn't visually share a row with main-rail content at the same Y. The
 * block's height grows by the same offset so all subsequent handles slide
 * down with the branched one.
 *
 * Obstacle = any main-rail node (block / contact / coil / parallel that is
 * NOT itself a branch element) whose Y range covers the branched handle's
 * natural Y AND that sits on the rail-side of the branched block on the X
 * axis. The branched handle shifts to `obstacle.bottom + clearance` so the
 * branch element renders below every obstacle.
 *
 * When multiple branches on the same block need different shifts, the
 * largest one wins; subsequent handles all shift by that max so the block
 * stays visually consistent.
 */
// Vertical buffer between the bottom of the lowest obstacle and the shifted
// branched handle. Wide enough to read as deliberate spacing rather than the
// branch element touching the obstacle below it.
const BRANCH_OBSTACLE_CLEARANCE = 50

// Vertical distance between the spine row and each parallel-path row inside
// a branch parallel. Wider than the main-rail block verticalGap so paths
// (and any parallel-of-parallels content within them) have room to render
// without crowding the spine or the next-row content.
const BRANCH_PARALLEL_PATH_HEIGHT = 100

// Slot height (vertical distance to the next handle) is constant at the
// default offset. Branch parallel-paths used to grow the slot to push
// subsequent handles down — but that compounded with
// `inflateBlockHeightsForBranches` (which grows the block bottom margin
// to enclose paths), making the FB taller than necessary and forcing
// stacked rungs to overflow into each other. The branch's path elements
// render in the branch's X span (left/right of the FB), so they don't
// need slot growth to fit between handles; only the block's overall
// vertical extent has to enclose them, which the bottom-margin growth
// handles directly.
const slotHeightForHandleIndex = (_rung: RungLadderState, _block: BlockNode<BlockVariant>, _index: number): number =>
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

// Re-derive the natural relY for an input/output handle from its index in
// the inputHandles / outputHandles array. The natural value composes per-
// handle slot heights (which grow when a branch contains a parallel) so
// the layout pass stays idempotent regardless of prior mutations.
const naturalRelYForIndex = (rung: RungLadderState, block: BlockNode<BlockVariant>, index: number): number => {
  let y = DEFAULT_BLOCK_CONNECTOR_Y
  for (let i = 0; i < index; i++) {
    y += slotHeightForHandleIndex(rung, block, i)
  }
  return y
}

// Per-pair spacing computed from each element's style gap, matching the
// main-rail rule `previousElementStyle.gap + newElementStyle.gap`. This way
// OPEN/CLOSE (gap=0) sit tightly next to the spine element they wrap, while
// contact↔contact pairs get the full 90px breathing room.
const styleGap = (node: Node | undefined): number => {
  if (!node) return 0
  const style = defaultCustomNodesStyles[node.type as keyof typeof defaultCustomNodesStyles]
  return style?.gap ?? 0
}
// Horizontal wire between the FB's branched-handle edge and the first
// branch element's near edge. Intentionally smaller than the main-rail
// `block.gap` (120): main-rail gap reserves room for an in-series neighbor
// to the FB's right, but a branch wire just connects to a side-input
// handle on the FB's left edge — a long wire there reads as wasted space.
const BRANCH_BLOCK_SIDE_GAP = 25

const branchGapFromBlock = (firstElement: Node | undefined): number => BRANCH_BLOCK_SIDE_GAP + styleGap(firstElement)
// Extra horizontal gap inserted between adjacent parallel pairs in the
// spine (a CLOSE immediately followed by an OPEN). Parallel-style gap is
// 0, so without this two consecutive parallel structures would touch each
// other. Matches contact-contact spacing for visual continuity with the
// main rung's between-element rhythm.
const BRANCH_BETWEEN_PARALLELS_GAP = 2 * defaultCustomNodesStyles.contact.gap
// Same-type adjacent parallels mean nesting (an outer OPEN wrapping an
// inner OPEN, or an inner CLOSE preceding an outer CLOSE). Without this
// gap they sit only the bracket's own 4px width apart and the inner
// vertical wire visually overlaps the outer's wire.
const BRANCH_NESTED_PARALLEL_GAP = defaultCustomNodesStyles.contact.gap
const branchGapBetween = (a: Node | undefined, b: Node | undefined): number => {
  if (a?.type === 'parallel' && b?.type === 'parallel') {
    const aType = (a as ParallelNode).data.type
    const bType = (b as ParallelNode).data.type
    if (aType === 'close' && bType === 'open') return BRANCH_BETWEEN_PARALLELS_GAP
    if (aType === bType) return BRANCH_NESTED_PARALLEL_GAP
  }
  return styleGap(a) + styleGap(b)
}

/**
 * Width of the compact branch (from FB-side gap to local rail's outer edge),
 * independent of where the FB block is positioned. Used by both:
 *   - the main-rung positioning pass (to reserve X room beside a block with
 *     a branch so the branch doesn't visually collide with neighbors), and
 *   - `computeCompactBranchXRange` (which adds the block's current X to
 *     produce the absolute span).
 */
export const computeBranchSpanWidth = (rung: RungLadderState, branch: HandleBranch): number => {
  const branchElements = branch.nodeIds
    .map((id) => rung.nodes.find((n) => n.id === id))
    .filter((n): n is RungLadderState['nodes'][number] => n !== undefined)
  if (branchElements.length === 0) return 0

  // Block-side first element; rail-side last element. Direction-dependent.
  const firstNode = branch.direction === 'input' ? branchElements[branchElements.length - 1] : branchElements[0]
  const lastNode = branch.direction === 'input' ? branchElements[0] : branchElements[branchElements.length - 1]

  let span = branchGapFromBlock(firstNode)
  for (let i = 0; i < branchElements.length; i++) {
    const node = branchElements[i]
    span += node.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
    const nextIdx = branch.direction === 'input' ? i - 1 : i + 1
    const nextNode = branchElements[nextIdx]
    if (nextNode) span += branchGapBetween(node, nextNode)
  }
  span += defaultCustomNodesStyles.powerRail.gap + styleGap(lastNode) + DEFAULT_POWER_RAIL_WIDTH

  // For each OPEN parallel in the spine, the layout stretches the spine
  // when a path between OPEN and CLOSE is wider than the spine elements
  // they wrap. That extra width pushes the rail further from the FB —
  // capture it here so the main-rung shift accounts for the rendered
  // branch width, not just the un-stretched spine.
  for (let idx = 0; idx < branchElements.length; idx++) {
    const node = branchElements[idx]
    if (node.type !== 'parallel' || node.data.type !== 'open') continue
    const open = node
    const closeId = open.data.parallelCloseReference
    const parallelOutputId = open.data.parallelOutputConnector?.id
    if (!closeId || !parallelOutputId) continue
    const close = rung.nodes.find((n) => n.id === closeId)
    if (!close || close.type !== 'parallel') continue
    const startEdges = rung.edges.filter((e) => e.source === open.id && e.sourceHandle === parallelOutputId)
    let maxPathWidth = 0
    for (const startEdge of startEdges) {
      const pathNodes = walkParallelPath(rung, open, close, startEdge)
      if (pathNodes.length === 0) continue
      const totalWidth =
        pathNodes.reduce((sum, n) => sum + (n.width ?? DEFAULT_CONTACT_BLOCK_WIDTH), 0) +
        pathNodes.length * 2 * defaultCustomNodesStyles.contact.gap
      if (totalWidth > maxPathWidth) maxPathWidth = totalWidth
    }
    if (maxPathWidth === 0) continue

    // Walk forward from OPEN through the spine until matching CLOSE; sum
    // the natural interior width the spine would occupy without
    // stretching. Includes the gap from OPEN to the first inside element
    // so the natural interior is comparable to the path width formula
    // above (otherwise the under-counted interior over-stretches the
    // spine).
    let naturalInterior = 0
    let depth = 0
    let firstInside = true
    for (let j = idx + 1; j < branch.nodeIds.length; j++) {
      const n = rung.nodes.find((n2) => n2.id === branch.nodeIds[j])
      if (!n) break
      if (n.type === 'parallel') {
        const ptype = n.data.type
        if (ptype === 'close' && depth === 0) break
        if (ptype === 'open') depth++
        else if (ptype === 'close') depth--
      }
      if (firstInside) {
        naturalInterior += branchGapBetween(open, n)
        firstInside = false
      }
      naturalInterior += n.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
      const next = rung.nodes.find((n2) => n2.id === branch.nodeIds[j + 1])
      if (next) naturalInterior += branchGapBetween(n, next)
    }

    span += Math.max(0, maxPathWidth - naturalInterior)
  }

  return span
}

// Visible horizontal gap between the parallel's OPEN-bracket vertical
// wire and the local branch rail's outer edge. Added to the FB shift on
// top of `computeBranchSpanWidth` so the rail doesn't sit flush against
// the bracket.
const BRANCH_WIRE_WRAP_BUFFER = 10

/**
 * Sum of input or output branch widths on a single block, plus a wire-wrap
 * buffer. Used by `positionMainNodes` to push the block (input) or its
 * successor (output) far enough that the branch's local rail AND any wire
 * routed to/from the block clear each other on the main rung.
 */
export const maxBranchSpanWidth = (rung: RungLadderState, blockId: string, direction: 'input' | 'output'): number => {
  let max = 0
  for (const branch of rung.handleBranches) {
    if (branch.blockId !== blockId) continue
    if (branch.direction !== direction) continue
    const span = computeBranchSpanWidth(rung, branch)
    if (span > max) max = span
  }
  if (max === 0) return 0
  // Clamp at 0 so a (rare) tiny branch doesn't ask the FB to shift LEFT of
  // its natural main-rung position.
  return Math.max(0, max + BRANCH_WIRE_WRAP_BUFFER)
}

/**
 * Compute the X span the compact branch occupies (from local rail's outer
 * edge to the FB's branched-handle edge). Used by obstacle detection so
 * vertical adjustment only fires for elements that actually visually
 * overlap with the compact branch.
 *
 * Returns `[branchLeft, branchRight]` in absolute coordinates.
 */
const computeCompactBranchXRange = (rung: RungLadderState, branch: HandleBranch): [number, number] | undefined => {
  const block = rung.nodes.find((n): n is BlockNode<BlockVariant> => n.id === branch.blockId && n.type === 'block')
  if (!block) return undefined

  const span = computeBranchSpanWidth(rung, branch)
  if (span === 0) return undefined

  if (branch.direction === 'input') {
    const right = block.position.x
    return [right - span, right]
  }
  const left = block.position.x + (block.width ?? 0)
  return [left, left + span]
}

/**
 * Compute the deepest relative-Y a branch on this block extends to, below
 * the branched handle. Includes the local rail's bottom edge AND any
 * parallel-path contacts that sit further below the spine.
 */
const branchBottomRelYFor = (
  rung: RungLadderState,
  block: BlockNode<BlockVariant>,
  handleIndex: number,
  branch: HandleBranch,
): number => {
  const handleRelY = naturalRelYForIndex(rung, block, handleIndex)
  const railBottom = handleRelY + DEFAULT_POWER_RAIL_HEIGHT / 2
  const paths = branchParallelPathCount(rung, branch)
  const pathsBottom =
    paths > 0 ? handleRelY + paths * BRANCH_PARALLEL_PATH_HEIGHT + DEFAULT_CONTACT_BLOCK_HEIGHT / 2 : 0
  return Math.max(railBottom, pathsBottom)
}

/**
 * Pre-pass that runs BEFORE `positionMainNodes`: grow each branched block's
 * `height` so it encloses the branch's vertical extent (rail + parallel
 * paths). The parallel layout uses `node.height` to decide where the next
 * path's elements sit on Y, so without this growth the next-path block
 * (e.g. CTU1 below a CTU0 with a branch) would land above the branch's
 * bottom and overlap.
 *
 * Idempotent: derives from natural relYs and parallel-path counts, never
 * from the block's current `height`.
 */
export const inflateBlockHeightsForBranches = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
  if (rung.handleBranches.length === 0) return { nodes: rung.nodes, edges: rung.edges }

  const branchedBlockIds = new Set(rung.handleBranches.map((b) => b.blockId))
  if (branchedBlockIds.size === 0) return { nodes: rung.nodes, edges: rung.edges }

  const newNodes = rung.nodes.map((node) => {
    if (node.type !== 'block') return node
    if (!branchedBlockIds.has(node.id)) return node

    let maxBranchBottomRelY = 0
    for (const branch of rung.handleBranches) {
      if (branch.blockId !== node.id) continue
      const handlesArr = branch.direction === 'input' ? node.data.inputHandles : node.data.outputHandles
      const handleIndex = handlesArr.findIndex((h) => h.id === branch.handleId)
      if (handleIndex === -1) continue
      const branchBottom = branchBottomRelYFor(rung, node, handleIndex, branch)
      if (branchBottom > maxBranchBottomRelY) maxBranchBottomRelY = branchBottom
    }

    const naturalMaxHandleRelY = naturalRelYForIndex(
      rung,
      node,
      Math.max(node.data.inputHandles.length, node.data.outputHandles.length) - 1,
    )
    const naturalHeight = naturalMaxHandleRelY + DEFAULT_BLOCK_CONNECTOR_Y
    const branchRequiredHeight = maxBranchBottomRelY + DEFAULT_BLOCK_CONNECTOR_Y

    // Always reserve enough block height for the branch's vertical extent
    // (rail bottom + every parallel-path row). This is what tells the
    // parallel layout to push siblings (e.g. CTU1 under CTU0) below the
    // branch's bottom row, so a coil sitting on the bottom path doesn't
    // visually overlap the FB or its branch elements.
    const requiredHeight = Math.max(naturalHeight, branchRequiredHeight)

    if (requiredHeight === node.height) return node
    return {
      ...node,
      height: requiredHeight,
      measured: { width: node.measured?.width ?? node.width ?? 0, height: requiredHeight },
    }
  })

  return { nodes: newNodes, edges: rung.edges }
}

export const applyDynamicBlockHandleOffsets = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
  if (rung.handleBranches.length === 0) return { nodes: rung.nodes, edges: rung.edges }

  const branchedBlockIds = new Set(rung.handleBranches.map((b) => b.blockId))
  if (branchedBlockIds.size === 0) return { nodes: rung.nodes, edges: rung.edges }

  // Nodes that ARE branch elements never count as obstacles — they live on
  // the branch and follow whatever Y we shift the handle to. The local
  // branch rails likewise follow the handle.
  const branchElementIds = new Set(rung.handleBranches.flatMap((b) => b.nodeIds))
  const isObstacleCandidate = (n: Node): boolean => {
    if (branchElementIds.has(n.id)) return false
    if (n.type === 'powerRail') return false
    if (n.type === 'placeholder' || n.type === 'parallelPlaceholder') return false
    if (n.type === 'variable') return false
    return n.type === 'block' || n.type === 'contact' || n.type === 'coil' || n.type === 'parallel'
  }

  // For each branched block, compute the largest shift any of its branched
  // handles needs to clear obstacles. Both the obstacle search and the
  // applied shift are computed against natural relYs, so the pass is
  // idempotent.
  const blockShifts = new Map<string, { firstAffectedNaturalRelY: number; shift: number }>()

  for (const branch of rung.handleBranches) {
    const block = rung.nodes.find((n): n is BlockNode<BlockVariant> => n.id === branch.blockId && n.type === 'block')
    if (!block) continue

    const handlesArr = branch.direction === 'input' ? block.data.inputHandles : block.data.outputHandles
    const handleIndex = handlesArr.findIndex((h) => h.id === branch.handleId)
    if (handleIndex === -1) continue

    const naturalRelY = naturalRelYForIndex(rung, block, handleIndex)
    const naturalHandleY = block.position.y + naturalRelY

    // Vertical adjustment only considers obstacles within the compact
    // branch's X span (from local rail to FB edge). Anything outside that
    // span won't visually overlap with the branch elements.
    const xRange = computeCompactBranchXRange(rung, branch)
    if (!xRange) continue
    const [branchLeft, branchRight] = xRange

    // The local rail is centered on the branched-handle Y, so its top edge
    // sits `DEFAULT_POWER_RAIL_HEIGHT / 2` ABOVE that Y. Obstacle detection
    // has to account for the rail too: a block whose bottom is within
    // (rail half-height + clearance) of the natural handle Y would visually
    // touch the rail's top, so it counts as an obstacle even if its Y range
    // doesn't strictly straddle the natural handle Y.
    const RAIL_HALF = DEFAULT_POWER_RAIL_HEIGHT / 2
    // Minimum vertical padding between the main-rung wire and the local
    // rail's top, even when no obstacles are detected in the branch's X
    // span. Without this, a branched handle's natural Y can sit so close
    // to the main wire that the rail visually touches it.
    const BRANCH_MIN_TOP_PADDING = 30
    let obstacleBottom = naturalHandleY - RAIL_HALF - BRANCH_OBSTACLE_CLEARANCE + BRANCH_MIN_TOP_PADDING
    for (const other of rung.nodes) {
      if (other.id === block.id) continue
      if (!isObstacleCandidate(other)) continue
      const otherTop = other.position.y
      const otherBottom = otherTop + (other.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT)
      // Far above (with clearance to spare) — irrelevant.
      if (otherBottom + RAIL_HALF + BRANCH_OBSTACLE_CLEARANCE < naturalHandleY) continue
      // Far below — irrelevant. "Close" includes elements whose top sits
      // within `RAIL_HALF + clearance` of the rail's bottom (handleY +
      // RAIL_HALF), so a parallel-path contact whose Y range slightly
      // straddles the handle's row counts and pushes the handle past it.
      if (otherTop > naturalHandleY + RAIL_HALF + BRANCH_OBSTACLE_CLEARANCE) continue
      const otherLeft = other.position.x
      const otherRight = otherLeft + (other.width ?? DEFAULT_CONTACT_BLOCK_WIDTH)
      // X-overlap with the compact branch span (which includes the local rail).
      if (otherRight <= branchLeft || otherLeft >= branchRight) continue
      if (otherBottom > obstacleBottom) obstacleBottom = otherBottom
    }

    // Shift target: rail's top edge sits `BRANCH_OBSTACLE_CLEARANCE` below
    // the lowest obstacle's bottom edge. Equivalent to:
    //   shifted handle Y = obstacleBottom + clearance + RAIL_HALF
    const shift = obstacleBottom + BRANCH_OBSTACLE_CLEARANCE + RAIL_HALF - naturalHandleY
    if (shift <= 0) continue

    const existing = blockShifts.get(block.id)
    if (!existing || shift > existing.shift) {
      blockShifts.set(block.id, { firstAffectedNaturalRelY: naturalRelY, shift })
    } else if (naturalRelY < existing.firstAffectedNaturalRelY) {
      blockShifts.set(block.id, { firstAffectedNaturalRelY: naturalRelY, shift: existing.shift })
    }
  }

  const newNodes = rung.nodes.map((node) => {
    if (node.type !== 'block') return node
    if (!branchedBlockIds.has(node.id)) return node

    const entry = blockShifts.get(node.id)

    const rewriteHandlesArray = <
      T extends {
        id?: string | null
        relPosition: { x: number; y: number }
        glbPosition: { x: number; y: number }
        style?: unknown
      },
    >(
      arr: readonly T[],
    ): T[] =>
      arr.map((h, index) => {
        const naturalRelY = naturalRelYForIndex(rung, node, index)
        const shifted = entry && naturalRelY >= entry.firstAffectedNaturalRelY ? naturalRelY + entry.shift : naturalRelY
        return {
          ...h,
          glbPosition: { x: h.glbPosition.x, y: node.position.y + shifted },
          relPosition: { x: h.relPosition.x, y: shifted },
          style: { ...((h.style ?? {}) as Record<string, unknown>), top: shifted },
        } as T
      })

    const newInputHandles = rewriteHandlesArray(node.data.inputHandles)
    const newOutputHandles = rewriteHandlesArray(node.data.outputHandles)
    const newHandles = [...newInputHandles, ...newOutputHandles]

    const maxHandleRelY = Math.max(
      ...newInputHandles.map((h) => h.relPosition.y),
      ...newOutputHandles.map((h) => h.relPosition.y),
      0,
    )

    // Each handle branch on this block has a vertical footprint below its
    // branched handle:
    //   - the local rail extends `DEFAULT_POWER_RAIL_HEIGHT / 2` below the
    //     handle Y (rail centered on handle Y).
    //   - parallel paths inside the branch sit at handle Y +
    //     `i * BRANCH_PARALLEL_PATH_HEIGHT`, with the deepest path's contact
    //     extending `DEFAULT_CONTACT_BLOCK_HEIGHT / 2` below its centerline.
    //
    // Block height has to grow to enclose the deepest of these footprints,
    // otherwise the block's natural bottom-margin caps the parallel layout's
    // height and the next-path element (e.g. a sibling block in a parallel)
    // overlaps the branch.
    let maxBranchBottomRelY = 0
    for (const branch of rung.handleBranches) {
      if (branch.blockId !== node.id) continue
      const handlesArr = branch.direction === 'input' ? newInputHandles : newOutputHandles
      const handle = handlesArr.find((h) => h.id === branch.handleId)
      if (!handle) continue
      const handleRelY = handle.relPosition.y
      const railBottom = handleRelY + DEFAULT_POWER_RAIL_HEIGHT / 2
      const paths = branchParallelPathCount(rung, branch)
      const pathsBottom =
        paths > 0 ? handleRelY + paths * BRANCH_PARALLEL_PATH_HEIGHT + DEFAULT_CONTACT_BLOCK_HEIGHT / 2 : 0
      const branchBottom = Math.max(railBottom, pathsBottom)
      if (branchBottom > maxBranchBottomRelY) maxBranchBottomRelY = branchBottom
    }

    const handleBasedHeight = maxHandleRelY + DEFAULT_BLOCK_CONNECTOR_Y
    const branchRequiredHeight = maxBranchBottomRelY + DEFAULT_BLOCK_CONNECTOR_Y
    const newHeight = Math.max(handleBasedHeight, branchRequiredHeight)

    return {
      ...node,
      height: newHeight,
      measured: { width: node.measured?.width ?? node.width ?? 0, height: newHeight },
      data: {
        ...node.data,
        handles: newHandles,
        inputHandles: newInputHandles,
        outputHandles: newOutputHandles,
        inputConnector: newInputHandles.find((h) => h.id === node.data.inputConnector?.id),
        outputConnector: newOutputHandles.find((h) => h.id === node.data.outputConnector?.id),
      },
    }
  })

  return { nodes: newNodes, edges: rung.edges }
}

// ============================================================================
// Layout — branch element positioning + rail-Y sync
// ============================================================================

type BranchElementPosition = {
  posX: number
  posY: number
  handleX: number
  handleY: number
}

/**
 * Compute the on-screen position for every element in a branch's serial
 * spine. Elements stack tightly NEAR the block (input branches → to the left,
 * output branches → to the right), all sitting at the block handle's current
 * Y. Compact placement keeps the rest of the rung's X span clear for main-
 * rail wires.
 *
 * Spine order (`nodeIds`):
 *   - input branches:  rail-side → … → block-side  (last entry is closest to block)
 *   - output branches: block-side → … → rail-side  (first entry is closest to block)
 *
 * In both cases we anchor at the block's edge and walk outward.
 */
export const calculateBranchElementPositions = (
  rung: RungLadderState,
  branch: HandleBranch,
): Map<string, BranchElementPosition> => {
  const positions = new Map<string, BranchElementPosition>()

  const block = rung.nodes.find((n) => n.id === branch.blockId) as BlockNode<BlockVariant> | undefined
  if (!block) return positions
  const blockHandle =
    branch.direction === 'input'
      ? block.data.inputHandles.find((h) => h.id === branch.handleId)
      : block.data.outputHandles.find((h) => h.id === branch.handleId)
  if (!blockHandle) return positions

  const branchElements = branch.nodeIds
    .map((id) => rung.nodes.find((n) => n.id === id))
    .filter((n): n is RungLadderState['nodes'][number] => n !== undefined)
  if (branchElements.length === 0) return positions

  const blockHandleX = blockHandle.glbPosition.x
  const blockHandleY = blockHandle.glbPosition.y

  // Pre-compute the minimum width each spine element needs to occupy. For a
  // regular contact/coil this is just its node width; for a parallel
  // OPEN/CLOSE pair, the spine must reserve enough horizontal room for
  // either the spine "above" element or the longest parallel path,
  // whichever is wider — so paths longer than the wrapped spine element
  // don't get squeezed into a too-narrow OPEN/CLOSE span.
  const spineSpanFor = (idx: number, node: Node): number => {
    if (node.type !== 'parallel' || (node as ParallelNode).data.type !== 'open') return 0
    // For an OPEN, the "interior" between OPEN and CLOSE is the spine
    // entries between them; default span comes from those. We override only
    // when a parallel path is wider.
    const open = node as ParallelNode
    const closeId = open.data.parallelCloseReference
    const parallelOutputId = open.data.parallelOutputConnector?.id
    if (!closeId || !parallelOutputId) return 0
    const startEdges = rung.edges.filter((e) => e.source === open.id && e.sourceHandle === parallelOutputId)
    let maxPathWidth = 0
    startEdges.forEach((startEdge) => {
      const close = rung.nodes.find((n) => n.id === closeId)
      if (!close || close.type !== 'parallel') return
      const pathNodes = walkParallelPath(rung, open, close, startEdge)
      if (pathNodes.length === 0) return
      // Path width = element widths + n*2*contact.gap. The 2*contact.gap
      // factor matches what the spine charges per element-pair (45 contact
      // gap on each side of every contact), so a path with the same
      // element count as the spine inside OPEN/CLOSE comes out exactly
      // equal in width — no stretch needed when the parallel just mirrors
      // a single spine element.
      const totalWidth =
        pathNodes.reduce((sum, n) => sum + (n.width ?? DEFAULT_CONTACT_BLOCK_WIDTH), 0) +
        pathNodes.length * 2 * defaultCustomNodesStyles.contact.gap
      if (totalWidth > maxPathWidth) maxPathWidth = totalWidth
    })
    if (maxPathWidth === 0) return 0
    // Sum the "natural" interior the spine entries between OPEN and CLOSE
    // would occupy: gap(OPEN, first inside) + each inside element's width
    // + gap to its next neighbor (which includes gap to CLOSE for the last
    // inside element). Without the OPEN-side gap the interior would be
    // under-counted by ~45px, making the stretch over-aggressive.
    let naturalInterior = 0
    let depth = 0
    let firstInside = true
    for (let j = idx + 1; j < branch.nodeIds.length; j++) {
      const n = rung.nodes.find((n2) => n2.id === branch.nodeIds[j])
      if (!n) break
      if (n.type === 'parallel') {
        const ptype = n.data.type
        if (ptype === 'close' && depth === 0) break
        if (ptype === 'open') depth++
        else if (ptype === 'close') depth--
      }
      if (firstInside) {
        naturalInterior += branchGapBetween(open, n)
        firstInside = false
      }
      naturalInterior += n.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
      const next = rung.nodes.find((n2) => n2.id === branch.nodeIds[j + 1])
      if (next) naturalInterior += branchGapBetween(n, next)
    }
    return Math.max(0, maxPathWidth - naturalInterior)
  }

  // For each parallel pair, compute the extra spine span needed when the
  // path width exceeds what aboveContact alone would naturally span. We
  // distribute the extra equally on BOTH sides of aboveContact so the spine
  // "above" element stays centered between OPEN and CLOSE — otherwise the
  // path layout (which centers in the OPEN-CLOSE span) ends up at a
  // different X than aboveContact.
  //
  // Map keyed by spine index of OPEN/CLOSE: the gap on each side gets
  // half of the OPEN's extra. Walk forward to mark CLOSE for the same OPEN.
  const halfExtraPerEdge = new Map<number, number>()
  branchElements.forEach((node, idx) => {
    if (node.type !== 'parallel') return
    if (node.data.type !== 'open') return
    const extra = spineSpanFor(idx, node)
    if (extra <= 0) return
    const half = extra / 2
    // Edge from OPEN to its successor in the spine: half goes here.
    halfExtraPerEdge.set(idx, half)
    // Edge from CLOSE's predecessor to CLOSE: half goes here.
    let depth = 1
    for (let j = idx + 1; j < branchElements.length; j++) {
      const n = branchElements[j]
      if (n.type === 'parallel') {
        const ptype = n.data.type
        if (ptype === 'open') depth++
        else if (ptype === 'close') {
          depth--
          if (depth === 0) {
            // Edge index = j - 1 (between branchElements[j-1] and branchElements[j]).
            halfExtraPerEdge.set(j - 1, (halfExtraPerEdge.get(j - 1) ?? 0) + half)
            break
          }
        }
      }
    }
  })

  let leftmostElementX: number | undefined
  let rightmostElementRight: number | undefined

  if (branch.direction === 'input') {
    // Input branch: walk LEFT from the block handle. Place last spine entry
    // (closest to block) first; each previous element sits to its left with
    // the per-pair gap derived from each element's style gap.
    const lastNode = branchElements[branchElements.length - 1]
    let rightEdge = blockHandleX - branchGapFromBlock(lastNode)
    for (let i = branchElements.length - 1; i >= 0; i--) {
      const node = branchElements[i]
      const width = node.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
      const height = node.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT
      const leftEdge = rightEdge - width
      positions.set(node.id, {
        posX: leftEdge,
        posY: blockHandleY - height / 2,
        handleX: leftEdge,
        handleY: blockHandleY,
      })
      if (i === 0) leftmostElementX = leftEdge
      const prev = branchElements[i - 1]
      // Edge index between prev (i-1) and node (i) is i-1.
      const extraGap = halfExtraPerEdge.get(i - 1) ?? 0
      rightEdge = leftEdge - branchGapBetween(prev, node) - extraGap
    }
  } else {
    // Output branch: walk RIGHT from the block handle. Place first spine
    // entry (closest to block) first; each next element sits to its right.
    const firstNode = branchElements[0]
    let leftEdge = blockHandleX + branchGapFromBlock(firstNode)
    for (let i = 0; i < branchElements.length; i++) {
      const node = branchElements[i]
      const width = node.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
      const height = node.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT
      positions.set(node.id, {
        posX: leftEdge,
        posY: blockHandleY - height / 2,
        handleX: leftEdge,
        handleY: blockHandleY,
      })
      const next = branchElements[i + 1]
      // Edge index between node (i) and next (i+1) is i.
      const extraGap = halfExtraPerEdge.get(i) ?? 0
      leftEdge = leftEdge + width + branchGapBetween(node, next) + extraGap
      if (i === branchElements.length - 1)
        rightmostElementRight = leftEdge - extraGap - branchGapBetween(node, next) + width
    }
  }

  // Position the standalone branch rail compactly: the local rail always
  // sits just past the outermost branch element on the rail side, never
  // snapping to the main rail. Vertical adjustment in
  // `applyDynamicBlockHandleOffsets` shifts the branched handle past
  // obstacles within the compact branch's X span, so the short rail-to-
  // contact wire is always obstacle-free.
  const branchRail = findBranchRail(rung, branch)
  if (branchRail) {
    const railGap = defaultCustomNodesStyles.powerRail.gap + styleGap(branchElements[0])
    const railX =
      branch.direction === 'input' && leftmostElementX !== undefined
        ? leftmostElementX - railGap - DEFAULT_POWER_RAIL_WIDTH
        : branch.direction === 'output' && rightmostElementRight !== undefined
          ? rightmostElementRight + railGap
          : branchRail.position.x

    const railY = blockHandleY - DEFAULT_POWER_RAIL_HEIGHT / 2
    positions.set(branchRail.id, {
      posX: railX,
      posY: railY,
      handleX: branch.direction === 'input' ? railX + DEFAULT_POWER_RAIL_WIDTH : railX,
      handleY: blockHandleY,
    })
  }

  // Position parallel-path elements. For each OPEN/CLOSE pair in the spine,
  // walk each parallel-output edge to get the path's serial chain and
  // place its elements stacked horizontally between OPEN.X and CLOSE.X,
  // with each path stacked vertically (one row per OR-path).
  for (let i = 0; i < branch.nodeIds.length; i++) {
    const node = rung.nodes.find((n) => n.id === branch.nodeIds[i])
    if (!node || node.type !== 'parallel') continue
    if (node.data.type !== 'open') continue
    const open = node

    const closeId = open.data.parallelCloseReference
    const closeNode = rung.nodes.find((n) => n.id === closeId)
    if (!closeNode || closeNode.type !== 'parallel') continue
    const close = closeNode

    const openPos = positions.get(open.id)
    const closePos = positions.get(close.id)
    if (!openPos || !closePos) continue

    const parallelOutputId = open.data.parallelOutputConnector?.id
    if (!parallelOutputId) continue
    const startEdges = rung.edges.filter((e) => e.source === open.id && e.sourceHandle === parallelOutputId)

    // Compute the X span available for path elements (between OPEN's right
    // edge and CLOSE's left edge — assume those are the OPEN and CLOSE
    // graphical edges, accounting for direction).
    const leftBoundary =
      branch.direction === 'input'
        ? Math.min(openPos.posX, closePos.posX) + (open.width ?? 4)
        : Math.min(openPos.posX, closePos.posX) + (close.width ?? 4)
    const rightBoundary =
      branch.direction === 'input' ? Math.max(openPos.posX, closePos.posX) : Math.max(openPos.posX, closePos.posX)

    startEdges.forEach((startEdge, pathIndex) => {
      const pathNodes = walkParallelPath(rung, open, close, startEdge)
      if (pathNodes.length === 0) return

      const pathY = blockHandleY + (pathIndex + 1) * BRANCH_PARALLEL_PATH_HEIGHT

      const totalSpan = Math.max(0, rightBoundary - leftBoundary)
      const totalElementWidth = pathNodes.reduce((sum, n) => sum + (n.width ?? DEFAULT_CONTACT_BLOCK_WIDTH), 0)
      const slots = pathNodes.length + 1
      const gapPerSlot = (totalSpan - totalElementWidth) / slots

      let cursor = leftBoundary + gapPerSlot
      pathNodes.forEach((pNode) => {
        const width = pNode.width ?? DEFAULT_CONTACT_BLOCK_WIDTH
        const height = pNode.height ?? DEFAULT_CONTACT_BLOCK_HEIGHT
        positions.set(pNode.id, {
          posX: cursor,
          posY: pathY - height / 2,
          handleX: cursor,
          handleY: pathY,
        })
        cursor += width + gapPerSlot
      })
    })
  }

  return positions
}

/**
 * Layout pass: rewrite every branch element's position (and the glbPositions
 * of its input / output handles) to match `calculateBranchElementPositions`.
 * Runs after `positionMainNodes` has settled the blocks' final positions.
 */
export const positionBranchElements = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
  // Build a single id → position map across every branch in the rung so the
  // node-rewrite below stays a one-pass map without quadratic lookups.
  const branchPositions = new Map<string, BranchElementPosition>()
  for (const branch of rung.handleBranches) {
    const positions = calculateBranchElementPositions(rung, branch)
    positions.forEach((pos, id) => branchPositions.set(id, pos))
  }

  if (branchPositions.size === 0) return { nodes: rung.nodes, edges: rung.edges }

  const newNodes = rung.nodes.map((node) => {
    const pos = branchPositions.get(node.id)
    if (!pos) return node

    // Standalone branch rail (its id matches our prefix). Reposition the
    // rail box and its single handle (glbPosition tracks the block handle Y).
    if (node.type === 'powerRail' && node.id.startsWith('branch-rail-')) {
      const newHandles = node.data.handles.map((h) => ({
        ...h,
        glbPosition: { x: pos.handleX, y: pos.handleY },
      }))
      return {
        ...node,
        position: { x: pos.posX, y: pos.posY },
        data: {
          ...node.data,
          handles: newHandles,
          inputHandles: node.data.variant === 'right' ? newHandles : node.data.inputHandles,
          outputHandles: node.data.variant === 'left' ? newHandles : node.data.outputHandles,
          inputConnector: node.data.variant === 'right' ? newHandles[0] : node.data.inputConnector,
          outputConnector: node.data.variant === 'left' ? newHandles[0] : node.data.outputConnector,
        },
      }
    }

    if (node.type !== 'contact' && node.type !== 'coil' && node.type !== 'parallel') return node

    // Rewrite the element's own position and every handle's glbPosition so
    // ReactFlow renders the element at the new spot AND so edges (which
    // route via handle glbPositions) follow.
    const newHandles = node.data.handles.map((h) => ({
      ...h,
      glbPosition: {
        x: h.relPosition.x === 0 ? pos.handleX : pos.handleX + (node.width ?? DEFAULT_CONTACT_BLOCK_WIDTH),
        y: pos.handleY,
      },
    }))
    const newInputHandles = node.data.inputHandles.map((h) => ({
      ...h,
      glbPosition: { x: pos.handleX, y: pos.handleY },
    }))
    const newOutputHandles = node.data.outputHandles.map((h) => ({
      ...h,
      glbPosition: { x: pos.handleX + (node.width ?? DEFAULT_CONTACT_BLOCK_WIDTH), y: pos.handleY },
    }))

    return {
      ...node,
      position: { x: pos.posX, y: pos.posY },
      data: {
        ...node.data,
        handles: newHandles,
        inputHandles: newInputHandles,
        outputHandles: newOutputHandles,
        inputConnector: newInputHandles.find((h) => h.id === node.data.inputConnector?.id),
        outputConnector: newOutputHandles.find((h) => h.id === node.data.outputConnector?.id),
      },
    }
  })

  return { nodes: newNodes, edges: rung.edges }
}

/**
 * Layout pass: keep each rail's dynamic branch handle aligned with the Y of
 * the block handle it serves. The rail handle's Y was set when the branch
 * was first created; if the block has since moved (e.g. another element was
 * added to the main rung and shifted the block right + recomputed its
 * handle Ys), the rail handle would drift out of sync without this pass.
 */
export const updateRailForBranches = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } => {
  if (rung.handleBranches.length === 0) return { nodes: rung.nodes, edges: rung.edges }

  // Build a `branchHandleId -> targetGlbY` map so the rail-rewrite below is
  // a single pass over the rung's nodes.
  const targetYs = new Map<string, number>()
  for (const branch of rung.handleBranches) {
    const block = rung.nodes.find((n) => n.id === branch.blockId) as BlockNode<BlockVariant> | undefined
    if (!block) continue
    const blockHandle =
      branch.direction === 'input'
        ? block.data.inputHandles.find((h) => h.id === branch.handleId)
        : block.data.outputHandles.find((h) => h.id === branch.handleId)
    if (!blockHandle) continue
    targetYs.set(buildRailBranchHandleId(branch.blockId, branch.handleId), blockHandle.glbPosition.y)
  }

  if (targetYs.size === 0) return { nodes: rung.nodes, edges: rung.edges }

  const syncHandle = <
    T extends {
      id?: string | null
      glbPosition: { x: number; y: number }
      relPosition: { x: number; y: number }
      style?: unknown
    },
  >(
    handle: T,
    railY: number,
  ): T => {
    const targetY = typeof handle.id === 'string' ? targetYs.get(handle.id) : undefined
    if (targetY === undefined) return handle
    const yRel = targetY - railY
    return {
      ...handle,
      glbPosition: { x: handle.glbPosition.x, y: targetY },
      relPosition: { x: handle.relPosition.x, y: yRel },
      style: { ...((handle.style ?? {}) as Record<string, unknown>), top: yRel },
    } as T
  }

  const newNodes = rung.nodes.map((node) => {
    if (node.type !== 'powerRail') return node
    const rail = node
    const railY = rail.position.y
    const updatedHandles = rail.data.handles.map((h) => syncHandle(h, railY))

    // Recompute rail height to encompass every branch handle's relY. After
    // applyDynamicBlockHandleOffsets shifts a block handle down, the rail
    // handle's relY grows past the rail's previous height and the handle
    // would render outside the rail's bounds — short-circuiting ReactFlow's
    // edge endpoint detection and producing a bent wire.
    const branchExtent = updatedHandles
      .filter((h) => isRailBranchHandleId(h.id))
      .reduce((max, h) => Math.max(max, h.relPosition.y), 0)
    const newHeight = Math.max(DEFAULT_POWER_RAIL_HEIGHT, branchExtent + DEFAULT_POWER_RAIL_CONNECTOR_Y)

    return {
      ...rail,
      height: newHeight,
      measured: { width: rail.measured?.width ?? DEFAULT_POWER_RAIL_WIDTH, height: newHeight },
      data: {
        ...rail.data,
        handles: updatedHandles,
        inputHandles: rail.data.variant === 'right' ? updatedHandles : rail.data.inputHandles,
        outputHandles: rail.data.variant === 'left' ? updatedHandles : rail.data.outputHandles,
      },
    }
  })

  return { nodes: newNodes, edges: rung.edges }
}

/**
 * Walk every branch on a given block and remove every element. Used by the
 * main element-removal path when a block is deleted: the branches must
 * collapse before (or as part of) the block's own removal so they don't
 * leave orphan branch elements with edges to a non-existent block.
 */
export const removeAllBranchesForBlock = (
  rung: RungLadderState,
  blockId: string,
): { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } => {
  let workingRung: { nodes: Node[]; edges: Edge[]; handleBranches: HandleBranch[] } = {
    nodes: rung.nodes,
    edges: rung.edges,
    handleBranches: rung.handleBranches,
  }

  const branchesForBlock = rung.handleBranches.filter((b) => b.blockId === blockId)
  for (const branch of branchesForBlock) {
    // Walk in reverse so each removeBranchElement still finds the branch in
    // workingRung.handleBranches with a non-empty `nodeIds` array.
    const idsCopy = [...branch.nodeIds]
    for (let i = idsCopy.length - 1; i >= 0; i--) {
      const nodeId = idsCopy[i]
      const elementNode = workingRung.nodes.find((n) => n.id === nodeId)
      if (!elementNode) continue
      const result = removeBranchElement({ ...rung, ...workingRung } as RungLadderState, elementNode)
      workingRung = result
    }
  }

  return workingRung
}
