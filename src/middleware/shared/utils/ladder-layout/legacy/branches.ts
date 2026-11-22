import type { Node } from '@xyflow/react'

import type { HandleBranch, RungLadderState } from '../../../ports/types'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  getDefaultNodeStyle,
  LEGACY_BLOCK_BOTTOM_PADDING,
  LEGACY_BRANCH_PARALLEL_CLEARANCE,
  LEGACY_NODE_STYLES,
  type LegacyNodeStyle,
} from '../legacy-style'
import { handleIdOf, handlesOf, type LegacyHandle, missing, withHandleY } from './node-access'
import { findAllParallelsDepthAndNodes, type LegacyParallelRegion } from './parallels'

/** A branch element's position and the flow position of its main handle. */
export type LegacyBranchPosition = { nodeId: string; posX: number; posY: number; handleX: number; handleY: number }

/** The positions of a branch's elements and the vertical extent its parallels need below the block pin. */
export type LegacyBranchPositionResult = {
  positions: LegacyBranchPosition[]
  totalHeight: number
}

/** The id of the rung's left or right power rail, found by its `left-rail` / `right-rail` prefix. */
export function findRailId(nodes: Node[], side: 'left' | 'right'): string | undefined {
  const prefix = side === 'left' ? 'left-rail' : 'right-rail'
  return nodes.find((n) => n.id.startsWith(prefix))?.id
}

/** True when the block pin carries a handle branch. */
export function hasBranchOnHandle(rung: RungLadderState, blockId: string, handleId: string): boolean {
  return rung.handleBranches?.some((b) => b.blockId === blockId && b.handleId === handleId) ?? false
}

/** The handle branch on a block pin, if any. */
export function getBranch(rung: RungLadderState, blockId: string, handleId: string): HandleBranch | undefined {
  return rung.handleBranches?.find((b) => b.blockId === blockId && b.handleId === handleId)
}

/** The branch on a stored handle; a handle without a string id carries none. */
function branchOnHandle(rung: RungLadderState, blockId: string, handle: LegacyHandle): HandleBranch | undefined {
  const handleId = handleIdOf(handle)
  return handleId === undefined ? undefined : getBranch(rung, blockId, handleId)
}

/** The block pin a branch attaches to. */
function branchTargetHandle(block: Node, branch: HandleBranch): LegacyHandle | undefined {
  const handles = handlesOf(block.data, branch.direction === 'input' ? 'inputHandles' : 'outputHandles')
  return handles.find((h) => h.id === branch.handleId)
}

function styleOf(node: Node): LegacyNodeStyle {
  return LEGACY_NODE_STYLES[node.type ?? 'contact'] ?? LEGACY_NODE_STYLES.contact
}

/**
 * Positions of a branch's elements relative to its block pin: input branches end at the pin, output branches start
 * there, and nested parallel paths sit below their parent path. Returns the vertical extent the parallels need.
 */
export function calculateBranchElementPositions(
  rung: RungLadderState,
  branch: HandleBranch,
): LegacyBranchPositionResult {
  const blockNode = rung.nodes.find((n) => n.id === branch.blockId)
  if (!blockNode) return { positions: [], totalHeight: 0 }

  const targetHandle = branchTargetHandle(blockNode, branch)
  if (!targetHandle) return { positions: [], totalHeight: 0 }

  const handleY = targetHandle.glbPosition.y
  const handleX = targetHandle.glbPosition.x
  const blockStyle = LEGACY_NODE_STYLES.block
  const results: LegacyBranchPosition[] = []

  const allRegions: Record<string, LegacyParallelRegion> = {}
  for (const nodeId of branch.nodeIds) {
    const n = rung.nodes.find((nd) => nd.id === nodeId)
    if (n && n.type === 'parallel' && n.data.type === 'open') {
      Object.assign(allRegions, findAllParallelsDepthAndNodes(rung, n))
    }
  }
  const regionList = Object.values(allRegions)

  const spineYMap: Record<string, number> = {}
  const parallelYMap: Record<string, number> = {}
  const verticalGap = LEGACY_NODE_STYLES.contact.verticalGap
  const placed = new Set<string>()

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

  const sortedRegions = [...regionList].sort((a, b) => a.depth - b.depth)
  for (const region of sortedRegions) {
    const openId = region.parallels.open.id
    const openPos = results.find((r) => r.nodeId === openId)
    if (!openPos) continue
    const openNode = rung.nodes.find((n) => n.id === openId)
    const openStyle = openNode ? styleOf(openNode) : LEGACY_NODE_STYLES.parallel

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

      const newX = prev.isParallel && isParallel ? prev.x : prev.x + prev.width + prev.gap + style.gap

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

  const childrenOf = (openId: string): LegacyParallelRegion[] => regionList.filter((r) => r.parent?.id === openId)

  const shiftSubtree = (region: LegacyParallelRegion, dx: number): void => {
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

    const closeNode = rung.nodes.find((n) => n.id === closeId)
    const closeStyle = closeNode ? styleOf(closeNode) : LEGACY_NODE_STYLES.parallel
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
      const closeIdx = branch.nodeIds.indexOf(closeId)
      for (const pos of results) {
        const idx = branch.nodeIds.indexOf(pos.nodeId)
        if (idx !== -1 && idx >= closeIdx) {
          pos.posX += shift
          pos.handleX += shift
        }
      }
    } else {
      const parentId = region.parent?.id
      const parent =
        (parentId === undefined ? undefined : allRegions[parentId]) ?? missing(`parent region of ${openId}`)
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
 * Per-pin row spacing for a block whose branches need room: under a pin whose branch holds parallels, and above a
 * pin that carries a branch. `null` when every row keeps the default spacing.
 */
export function calculateDynamicHandleOffsets(
  rung: RungLadderState,
  blockNode: Node,
): { inputOffsets: number[]; outputOffsets: number[]; totalHeight: number } | null {
  const inputHandles = handlesOf(blockNode.data, 'inputHandles')
  const outputHandles = handlesOf(blockNode.data, 'outputHandles')

  function getOffsetsForHandles(handles: LegacyHandle[]): number[] {
    const offsets: number[] = []
    for (let i = 0; i < handles.length; i++) {
      let offset = DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

      const branch = branchOnHandle(rung, blockNode.id, handles[i])
      if (branch) {
        const hasParallels = branch.nodeIds.some((id) => {
          const n = rung.nodes.find((node) => node.id === id)
          return n?.type === 'parallel'
        })
        if (hasParallels) {
          const { totalHeight } = calculateBranchElementPositions(rung, branch)
          offset = Math.max(offset, totalHeight + LEGACY_BRANCH_PARALLEL_CLEARANCE)
        }
      }

      if (i + 1 < handles.length) {
        if (branchOnHandle(rung, blockNode.id, handles[i + 1])) {
          offset = Math.max(offset, LEGACY_NODE_STYLES.contact.verticalGap)
        }
      }

      offsets.push(offset)
    }
    return offsets
  }

  const inputOffsets = getOffsetsForHandles(inputHandles)
  const outputOffsets = getOffsetsForHandles(outputHandles)

  const hasExpansion = [...inputOffsets, ...outputOffsets].some((o) => o !== DEFAULT_BLOCK_CONNECTOR_Y_OFFSET)
  if (!hasExpansion) return null

  const maxHandles = Math.max(inputHandles.length, outputHandles.length)
  let cumulativeY = DEFAULT_BLOCK_CONNECTOR_Y
  for (let i = 0; i < maxHandles - 1; i++) {
    const inputOffset = inputOffsets[i] ?? DEFAULT_BLOCK_CONNECTOR_Y_OFFSET
    const outputOffset = outputOffsets[i] ?? DEFAULT_BLOCK_CONNECTOR_Y_OFFSET
    cumulativeY += Math.max(inputOffset, outputOffset)
  }
  const totalHeight = cumulativeY + LEGACY_BLOCK_BOTTOM_PADDING

  return { inputOffsets, outputOffsets, totalHeight }
}

/** Moves each rail branch handle (`branch_<block>_<pin>`) to the flow `y` of the block pin it feeds. */
export function updateRailForBranches(nodes: Node[], handleBranches: HandleBranch[] | undefined): Node[] {
  if (!handleBranches?.length) return nodes

  const railUpdates = new Map<string, Array<{ branchHandleId: string; newY: number }>>()

  for (const branch of handleBranches) {
    const blockNode = nodes.find((n) => n.id === branch.blockId)
    if (!blockNode) continue

    const targetHandle = branchTargetHandle(blockNode, branch)
    if (!targetHandle) continue

    const railId = findRailId(nodes, branch.direction === 'input' ? 'left' : 'right')
    if (!railId) continue
    const branchHandleId = `branch_${branch.blockId}_${branch.handleId}`

    const updates = railUpdates.get(railId) ?? []
    updates.push({ branchHandleId, newY: targetHandle.glbPosition.y })
    railUpdates.set(railId, updates)
  }

  if (railUpdates.size === 0) return nodes

  return nodes.map((n) => {
    const updates = railUpdates.get(n.id)
    if (!updates) return n

    const newHandles = handlesOf(n.data, 'handles').map((h) => {
      const update = updates.find((u) => u.branchHandleId === h.id)
      if (!update) return h
      return withHandleY(h, update.newY, update.newY - n.position.y)
    })

    return {
      ...n,
      data: {
        ...n.data,
        handles: newHandles,
        inputHandles: newHandles.filter((h) => h.type === 'target'),
        outputHandles: newHandles.filter((h) => h.type === 'source'),
      },
    }
  })
}
