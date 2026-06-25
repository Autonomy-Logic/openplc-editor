import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import { buildHandle } from '../../../../../../../_atoms/graphical-editor/ladder/handle'
// Import from node-builders directly (not the atoms barrel) — the barrel
// re-exports the LD React components, which import the store, which would
// create a circular load chain back through `removeElements` → `slice.ts`.
import {
  checkIfElementIsNode,
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type {
  BasicNodeData,
  BlockVariant,
  HandleBranch,
  ParallelNode,
} from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { buildEdge, disconnectNodes, removeEdge } from '../../edges'
import { buildGenericNode, getDefaultNodeStyle, removeNode } from '../../nodes'
import { spliceEdgeAndInsertNode, wireParallelAroundElement } from '../core'
import { findAllParallelsDepthAndNodes, findParallelsInRung, getNodesInsideParallel } from '../utils'

/**
 * Find the left or right rail node id in a rung.
 * Rail IDs in the current architecture are `left-rail-{rungId}` /
 * `right-rail-{rungId}`, so callers must look them up by prefix rather than
 * hardcoding `'left-rail'`/`'right-rail'`.
 */
function findRailId(nodes: Node[], side: 'left' | 'right'): string | undefined {
  const prefix = side === 'left' ? 'left-rail' : 'right-rail'
  return nodes.find((n) => n.id.startsWith(prefix))?.id
}

/**
 * Check if a block handle has an active element branch.
 */
export function hasBranchOnHandle(rung: RungLadderState, blockId: string, handleId: string): boolean {
  return rung.handleBranches?.some((b) => b.blockId === blockId && b.handleId === handleId) ?? false
}

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
 * Get the HandleBranch metadata for a specific block handle, if any.
 */
export function getBranch(rung: RungLadderState, blockId: string, handleId: string): HandleBranch | undefined {
  return rung.handleBranches?.find((b) => b.blockId === blockId && b.handleId === handleId)
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

type BranchPositionResult = {
  positions: Array<{ nodeId: string; posX: number; posY: number; handleX: number; handleY: number }>
  totalHeight: number // Total vertical extent when parallels are present (0 if no parallels)
}

type RegionInfo = ReturnType<typeof findAllParallelsDepthAndNodes>[string]
type Pos = { nodeId: string; posX: number; posY: number; handleX: number; handleY: number }

/**
 * Calculate positions for branch elements relative to their target block handle.
 *
 * For input branches: outer-spine elements are arranged right-to-left ending at the block handle.
 * For output branches: outer-spine elements are arranged left-to-right starting from the block handle.
 *
 * Nested parallels (parallels inside a parallel-path) are positioned at deeper Y levels by
 * reusing the main-rail's findAllParallelsDepthAndNodes, which builds a flat map of regions
 * keyed by OPEN node id with parent links and depth. Each region's spine Y is its parent's
 * parallel Y (or handleY for top-level), and its own parallel Y sits below by serialHeight + gap.
 *
 * Returns positions for each node in the branch plus totalHeight for block expansion.
 */
export function calculateBranchElementPositions(rung: RungLadderState, branch: HandleBranch): BranchPositionResult {
  const blockNode = rung.nodes.find((n) => n.id === branch.blockId)
  if (!blockNode) return { positions: [], totalHeight: 0 }

  const blockData = blockNode.data as BasicNodeData
  const targetHandle =
    branch.direction === 'input'
      ? blockData.inputHandles.find((h) => h.id === branch.handleId)
      : blockData.outputHandles.find((h) => h.id === branch.handleId)

  if (!targetHandle) return { positions: [], totalHeight: 0 }

  const handleY = targetHandle.glbPosition.y
  const handleX = targetHandle.glbPosition.x
  const blockStyle = defaultCustomNodesStyles.block
  const results: Pos[] = []
  const styleOf = (n: Node) => defaultCustomNodesStyles[n.type ?? 'contact'] ?? defaultCustomNodesStyles.contact

  // ---------- 1. Build region map across all parallels in this branch ----------
  // findAllParallelsDepthAndNodes recurses into nested parallels (both serial- and
  // parallel-side), so seeding it from the top-level OPEN nodes of branch.nodeIds gives
  // us a flat map of every region in the branch keyed by OPEN id.
  const allRegions: Record<string, RegionInfo> = {}
  for (const nodeId of branch.nodeIds) {
    const n = rung.nodes.find((nd) => nd.id === nodeId)
    if (n && n.type === 'parallel' && (n as ParallelNode).data.type === 'open') {
      Object.assign(allRegions, findAllParallelsDepthAndNodes(rung, n as ParallelNode))
    }
  }
  const regionList = Object.values(allRegions)

  // ---------- 2. Compute spineY and parallelY per region (parent-first) ----------
  const spineYMap: Record<string, number> = {}
  const parallelYMap: Record<string, number> = {}
  const verticalGap = defaultCustomNodesStyles.contact.verticalGap
  const placed = new Set<string>()

  // Iterate until every region has been processed (handles arbitrary depth).
  // Safety bound prevents infinite loops on malformed parent chains.
  let safety = regionList.length * 2 + 1
  while (placed.size < regionList.length && safety-- > 0) {
    for (const region of regionList) {
      const openId = region.parallels.open.id
      if (placed.has(openId)) continue
      const parentOpenId = region.parent?.id
      if (parentOpenId && !placed.has(parentOpenId)) continue

      let regionSpineY: number
      if (!parentOpenId) {
        regionSpineY = handleY
      } else {
        const parent = allRegions[parentOpenId]
        const isInParentParallel = parent.nodes.parallel.some((n) => n.id === openId)
        regionSpineY = isInParentParallel ? parallelYMap[parentOpenId] : spineYMap[parentOpenId]
      }
      spineYMap[openId] = regionSpineY

      let height = 0
      for (const sn of region.nodes.serial) {
        height = Math.max(height, getDefaultNodeStyle({ node: sn }).height)
      }
      parallelYMap[openId] = regionSpineY + height + verticalGap
      placed.add(openId)
    }
  }

  // Determine Y for any node in this branch. Outer-spine nodes sit at handleY; nested
  // nodes use the deepest region whose serial/parallel chain claims them.
  const yOfNode = (nodeId: string): number => {
    if (branch.nodeIds.includes(nodeId)) return handleY
    let bestY = handleY
    let bestDepth = -1
    for (const region of regionList) {
      const openId = region.parallels.open.id
      if (region.nodes.serial.some((n) => n.id === nodeId)) {
        if (region.depth > bestDepth) {
          bestDepth = region.depth
          bestY = spineYMap[openId]
        }
      }
      if (region.nodes.parallel.some((n) => n.id === nodeId)) {
        if (region.depth > bestDepth) {
          bestDepth = region.depth
          bestY = parallelYMap[openId]
        }
      }
    }
    return bestY
  }

  // ---------- 3. Position outer spine at handleY ----------
  if (branch.direction === 'input') {
    let currentX = handleX
    for (let i = branch.nodeIds.length - 1; i >= 0; i--) {
      const nodeId = branch.nodeIds[i]
      const node = rung.nodes.find((n) => n.id === nodeId)
      if (!node) continue
      const style = styleOf(node)
      let rightNeighborGap: number
      if (i === branch.nodeIds.length - 1) {
        rightNeighborGap = blockStyle.gap
      } else {
        const rn = rung.nodes.find((n) => n.id === branch.nodeIds[i + 1])
        rightNeighborGap = rn ? styleOf(rn).gap : 0
      }
      currentX -= style.width + style.gap + rightNeighborGap
      results.unshift({
        nodeId,
        posX: currentX,
        posY: handleY - style.handle.y,
        handleX: currentX,
        handleY,
      })
    }
  } else {
    let currentX = handleX
    for (let i = 0; i < branch.nodeIds.length; i++) {
      const nodeId = branch.nodeIds[i]
      const node = rung.nodes.find((n) => n.id === nodeId)
      if (!node) continue
      const style = styleOf(node)
      let leftNeighborGap: number
      if (i === 0) {
        leftNeighborGap = blockStyle.gap
      } else {
        const ln = rung.nodes.find((n) => n.id === branch.nodeIds[i - 1])
        leftNeighborGap = ln ? styleOf(ln).gap : 0
      }
      currentX += leftNeighborGap + style.gap
      results.push({
        nodeId,
        posX: currentX,
        posY: handleY - style.handle.y,
        handleX: currentX,
        handleY,
      })
      currentX += style.width
    }
  }

  // ---------- 4. Walk each region's parallel chain (parent-first) ----------
  // The chain is the sequence returned by getNodesInsideParallel (edge-walk order). It
  // includes nested OPEN/CLOSE pairs and the serial chain between them, all at the
  // parent's parallelY. Deeper-nested parallel-paths get walked when we visit that
  // child region in this loop.
  //
  // Parallel→parallel transitions overlay at the same X with no width or gap
  // contribution — this matches `getNodePositionBasedOnPreviousNode`'s
  // parallelNodeCheckingParallelNode rule on the main rail and keeps nested
  // OPEN/CLOSE pairs aligned with their parents (no 4-px-per-level diagonal curve).
  const sortedRegions = [...regionList].sort((a, b) => a.depth - b.depth)
  for (const region of sortedRegions) {
    const openId = region.parallels.open.id
    const openPos = results.find((r) => r.nodeId === openId)
    if (!openPos) continue
    const openNode = rung.nodes.find((n) => n.id === openId)
    const openStyle = openNode ? styleOf(openNode) : defaultCustomNodesStyles.parallel

    // Track the previous element so we can apply the par→par overlay rule.
    // The walk seeds with OPEN_PARENT as the initial "previous" element.
    let prev: { x: number; width: number; gap: number; isParallel: boolean } = {
      x: openPos.handleX,
      width: openStyle.width,
      gap: openStyle.gap,
      isParallel: true,
    }

    for (const inner of region.nodes.parallel) {
      const node = rung.nodes.find((n) => n.id === inner.id)
      if (!node) continue
      const style = styleOf(node)
      const isParallel = node.type === 'parallel'

      const newX =
        prev.isParallel && isParallel
          ? prev.x // par→par: overlay at parent OPEN's X, no advance
          : prev.x + prev.width + prev.gap + style.gap

      const y = yOfNode(inner.id)
      results.push({
        nodeId: inner.id,
        posX: newX,
        posY: y - style.handle.y,
        handleX: newX,
        handleY: y,
      })
      prev = { x: newX, width: style.width, gap: style.gap, isParallel }
    }
  }

  // ---------- 5. Width post-pass: expand OPEN→CLOSE when parallel chain is wider ----------
  // Process deepest first so that inner expansions propagate outward and the outer
  // region's rightmost-X reflects the post-expansion layout.
  const childrenOf = (openId: string) => regionList.filter((r) => r.parent?.id === openId)

  // Recursively shift a region's parallel-path elements AND all nested descendants by dx.
  // Used when a top-level region's OPEN shifts LEFT — every node positioned relative to
  // OPEN (its full subtree) must follow.
  const shiftSubtree = (region: RegionInfo, dx: number) => {
    for (const inner of region.nodes.parallel) {
      const pos = results.find((r) => r.nodeId === inner.id)
      if (pos) {
        pos.posX += dx
        pos.handleX += dx
      }
    }
    for (const child of childrenOf(region.parallels.open.id)) {
      shiftSubtree(child, dx)
    }
  }

  const reversedRegions = [...sortedRegions].reverse()
  for (const region of reversedRegions) {
    const openId = region.parallels.open.id
    const closeId = region.parallels.close.id
    const closePos = results.find((r) => r.nodeId === closeId)
    if (!closePos) continue

    // Compute the X that CLOSE_PARENT must reach to encompass every parallel-chain
    // element. For a non-parallel element we add the same gaps the walk would use to
    // place CLOSE_PARENT after it; for a nested-parallel element (typically the
    // chain's trailing CLOSE) we use the par→par overlay rule — CLOSE_PARENT lands
    // at the nested CLOSE's X, not past its right edge.
    const closeNode = rung.nodes.find((n) => n.id === closeId)
    const closeStyle = closeNode ? styleOf(closeNode) : defaultCustomNodesStyles.parallel
    let requiredCloseX = 0
    let sawAny = false
    for (const inner of region.nodes.parallel) {
      const pos = results.find((r) => r.nodeId === inner.id)
      if (!pos) continue
      const node = rung.nodes.find((n) => n.id === inner.id)
      if (!node) continue
      const style = styleOf(node)
      sawAny = true
      const x = node.type === 'parallel' ? pos.posX : pos.posX + style.width + style.gap + closeStyle.gap
      if (x > requiredCloseX) requiredCloseX = x
    }
    if (!sawAny) continue
    if (requiredCloseX <= closePos.posX) continue
    const shift = requiredCloseX - closePos.posX

    const isTopLevel = branch.nodeIds.includes(openId)

    if (isTopLevel && branch.direction === 'input') {
      // Outer input branch: CLOSE is anchored near the block (right side), so widening
      // pushes OPEN and everything before it LEFT. Every descendant of this region must
      // shift LEFT by the same amount so relative alignment is preserved.
      const openIdx = branch.nodeIds.indexOf(openId)
      for (const pos of results) {
        const idx = branch.nodeIds.indexOf(pos.nodeId)
        if (idx !== -1 && idx <= openIdx) {
          pos.posX -= shift
          pos.handleX -= shift
        }
      }
      shiftSubtree(region, -shift)
    } else if (isTopLevel && branch.direction === 'output') {
      // Outer output branch: OPEN is anchored to the block (left side), so widening
      // pushes CLOSE and everything after it RIGHT.
      const closeIdx = branch.nodeIds.indexOf(closeId)
      for (const pos of results) {
        const idx = branch.nodeIds.indexOf(pos.nodeId)
        if (idx !== -1 && idx >= closeIdx) {
          pos.posX += shift
          pos.handleX += shift
        }
      }
    } else {
      // Nested region: OPEN is anchored to the parent's parallel chain start (we can't
      // shift it LEFT without colliding with siblings or the parent OPEN). Instead,
      // push CLOSE and everything to its right within the parent chain RIGHT. The
      // parent's rightmost-X is now larger, which propagates on the next iteration
      // (parents come later in `reversedRegions`).
      const parent = allRegions[region.parent!.id]
      const closeIdx = parent.nodes.parallel.findIndex((n) => n.id === closeId)
      if (closeIdx !== -1) {
        for (let i = closeIdx; i < parent.nodes.parallel.length; i++) {
          const pos = results.find((r) => r.nodeId === parent.nodes.parallel[i].id)
          if (pos) {
            pos.posX += shift
            pos.handleX += shift
          }
        }
      }
    }
  }

  // ---------- 6. Compute total vertical extent for block expansion ----------
  let totalHeight = 0
  for (const region of regionList) {
    const openId = region.parallels.open.id
    let maxElementHeight = 0
    for (const inner of region.nodes.parallel) {
      const node = rung.nodes.find((n) => n.id === inner.id)
      if (node) maxElementHeight = Math.max(maxElementHeight, getDefaultNodeStyle({ node }).height)
    }
    const verticalOffset = parallelYMap[openId] - handleY
    totalHeight = Math.max(totalHeight, verticalOffset + maxElementHeight)
  }

  return { positions: results, totalHeight }
}

/**
 * Calculate dynamic per-handle Y offsets for a block whose branches contain parallels.
 * Returns null when no handle needs expansion (callers can skip the update).
 *
 * Used in the layout post-pass (Phase 4.1c) to expand block height and shift handles
 * so that parallel branch elements don't overlap.
 */
export function calculateDynamicHandleOffsets(
  rung: RungLadderState,
  blockNode: Node,
): { inputOffsets: number[]; outputOffsets: number[]; totalHeight: number } | null {
  const blockStyle = defaultCustomNodesStyles.block
  const DEFAULT_OFFSET = blockStyle.handle.offsetY // 40
  const FIRST_HANDLE_Y = blockStyle.handle.y // 36

  const blockData = blockNode.data as BasicNodeData
  const inputHandles = blockData.inputHandles
  const outputHandles = blockData.outputHandles

  function getOffsetsForHandles(handles: typeof inputHandles): number[] {
    const offsets: number[] = []
    for (let i = 0; i < handles.length; i++) {
      let offset = DEFAULT_OFFSET

      // Check this handle's own branch for parallel expansion
      const handleId = handles[i].id as string
      const branch = getBranch(rung, blockNode.id, handleId)
      if (branch) {
        const hasParallels = branch.nodeIds.some((id) => {
          const n = rung.nodes.find((node) => node.id === id)
          return n?.type === 'parallel'
        })
        if (hasParallels) {
          const { totalHeight } = calculateBranchElementPositions(rung, branch)
          offset = Math.max(offset, totalHeight + 20)
        }
      }

      // When the next handle has a branch attached, expand this handle's offset
      // to provide visual clearance between this handle's wire area and the branch
      // elements at the next handle's level. Uses the element's verticalGap (80px)
      // as the minimum — enough for visual separation without the full parallel height.
      if (i + 1 < handles.length) {
        const nextHandleId = handles[i + 1].id as string
        if (getBranch(rung, blockNode.id, nextHandleId)) {
          offset = Math.max(offset, defaultCustomNodesStyles.contact.verticalGap)
        }
      }

      offsets.push(offset)
    }
    return offsets
  }

  const inputOffsets = getOffsetsForHandles(inputHandles)
  const outputOffsets = getOffsetsForHandles(outputHandles)

  // Check if any offset differs from default
  const hasExpansion = [...inputOffsets, ...outputOffsets].some((o) => o !== DEFAULT_OFFSET)
  if (!hasExpansion) return null

  // Calculate total block height
  const maxHandles = Math.max(inputHandles.length, outputHandles.length)
  let cumulativeY = FIRST_HANDLE_Y
  for (let i = 0; i < maxHandles - 1; i++) {
    const inputOffset = inputOffsets[i] ?? DEFAULT_OFFSET
    const outputOffset = outputOffsets[i] ?? DEFAULT_OFFSET
    cumulativeY += Math.max(inputOffset, outputOffset)
  }
  const totalHeight = cumulativeY + 24 // padding below last handle

  return { inputOffsets, outputOffsets, totalHeight }
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
 * Sync rail branch handle positions with their target block handle positions.
 * Called after the main layout loop repositions blocks, so rail branch handles
 * stay aligned with the block handles they connect to.
 */
export function updateRailForBranches(nodes: Node[], handleBranches: HandleBranch[] | undefined): Node[] {
  if (!handleBranches?.length) return nodes

  // Collect rail updates: railId → array of { branchHandleId, newY }
  // Rail ids include a rung suffix on the new architecture, so resolve them
  // from nodes[] before keying the map (see feedback-port-ladder-rail-ids).
  const railUpdates = new Map<string, Array<{ branchHandleId: string; newY: number }>>()

  for (const branch of handleBranches) {
    const blockNode = nodes.find((n) => n.id === branch.blockId)
    if (!blockNode) continue

    const blockData = blockNode.data as BasicNodeData
    const targetHandle =
      branch.direction === 'input'
        ? blockData.inputHandles.find((h) => h.id === branch.handleId)
        : blockData.outputHandles.find((h) => h.id === branch.handleId)
    if (!targetHandle) continue

    const railId = findRailId(nodes, branch.direction === 'input' ? 'left' : 'right')
    if (!railId) continue
    const branchHandleId = `branch_${branch.blockId}_${branch.handleId}`

    if (!railUpdates.has(railId)) railUpdates.set(railId, [])
    railUpdates.get(railId)!.push({ branchHandleId, newY: targetHandle.glbPosition.y })
  }

  if (railUpdates.size === 0) return nodes

  return nodes.map((n) => {
    const updates = railUpdates.get(n.id)
    if (!updates) return n

    const railData = n.data as BasicNodeData
    const newHandles = railData.handles.map((h) => {
      const update = updates.find((u) => u.branchHandleId === h.id)
      if (!update) return h
      return {
        ...h,
        glbPosition: { ...h.glbPosition, y: update.newY },
        relPosition: { ...h.relPosition, y: update.newY - n.position.y },
        style: { ...h.style, top: update.newY - n.position.y },
      }
    })

    return {
      ...n,
      data: {
        ...railData,
        handles: newHandles,
        inputHandles: newHandles.filter((h) => h.type === 'target'),
        outputHandles: newHandles.filter((h) => h.type === 'source'),
      },
    }
  })
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
    const newVariable = newVariables.find((v) => v.name === branch.handleId)
    if (newVariable && canPlaceElementOnHandle(newVariable)) {
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
