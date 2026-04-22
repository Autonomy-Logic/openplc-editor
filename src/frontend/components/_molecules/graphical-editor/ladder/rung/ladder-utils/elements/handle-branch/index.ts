import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

/**
 * Find a rail node by prefix. Rail IDs are formatted as `left-rail-{rungId}` or `right-rail-{rungId}`.
 * Code that predates the rungId suffix used bare `'left-rail'` / `'right-rail'` so this helper
 * supports both formats.
 */
function findRailNode(nodes: Node[], prefix: 'left-rail' | 'right-rail'): Node | undefined {
  return nodes.find((n) => n.id === prefix || n.id.startsWith(`${prefix}-`))
}

function getRailId(nodes: Node[], prefix: 'left-rail' | 'right-rail'): string {
  return findRailNode(nodes, prefix)?.id ?? prefix
}

import { buildHandle } from '../../../../../../../_atoms/graphical-editor/ladder/handle'
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
import { getNodesInsideParallel } from '../utils'

/**
 * Check if a block handle has an active element branch.
 */
export function hasBranchOnHandle(rung: RungLadderState, blockId: string, handleId: string): boolean {
  return rung.handleBranches?.some((b) => b.blockId === blockId && b.handleId === handleId) ?? false
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

/**
 * Pre-compute parallel regions within a branch by scanning nodeIds for OPEN/CLOSE pairs.
 * Returns metadata needed to position both serial-spine and parallel-path elements.
 */
function detectParallelRegions(
  rung: RungLadderState,
  branch: HandleBranch,
): Array<{
  openId: string
  closeId: string
  parallelNodeIds: string[]
  serialNodeIds: string[]
  verticalOffset: number
}> {
  const regions: Array<{
    openId: string
    closeId: string
    parallelNodeIds: string[]
    serialNodeIds: string[]
    verticalOffset: number
  }> = []

  for (let i = 0; i < branch.nodeIds.length; i++) {
    const node = rung.nodes.find((n) => n.id === branch.nodeIds[i])
    if (!node || node.type !== 'parallel') continue
    if ((node.data as ParallelNode['data']).type !== 'open') continue

    const closeNode = rung.nodes.find((n) => n.id === (node.data as ParallelNode['data']).parallelCloseReference)
    if (!closeNode) continue

    // REUSE getNodesInsideParallel to classify serial vs parallel path nodes
    const { serial, parallel: parallelNodes } = getNodesInsideParallel(rung, closeNode)

    // Calculate vertical offset using same formula as main-line parallels (diagram/index.ts)
    let maxSerialHeight = 0
    let highestSerialNode: Node | undefined
    for (const sn of serial) {
      const snHeight = sn.height ?? sn.measured?.height ?? getDefaultNodeStyle({ node: sn }).height
      if (snHeight > maxSerialHeight) {
        maxSerialHeight = snHeight
        highestSerialNode = sn
      }
    }
    const verticalGap = highestSerialNode ? getDefaultNodeStyle({ node: highestSerialNode }).verticalGap : 80

    regions.push({
      openId: node.id,
      closeId: closeNode.id,
      parallelNodeIds: parallelNodes.map((n) => n.id),
      serialNodeIds: serial.map((n) => n.id),
      verticalOffset: maxSerialHeight + verticalGap,
    })
  }

  return regions
}

/**
 * Calculate positions for branch elements relative to their target block handle.
 *
 * For input branches: elements are arranged right-to-left ending at the block handle.
 * For output branches: elements are arranged left-to-right starting from the block handle.
 *
 * Returns positions for each node in the branch plus totalHeight for block expansion (Phase 4.1c).
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
  const results: Array<{ nodeId: string; posX: number; posY: number; handleX: number; handleY: number }> = []

  const blockStyle = defaultCustomNodesStyles.block

  // Detect parallel regions within this branch
  const parallelRegions = detectParallelRegions(rung, branch)

  if (branch.direction === 'input') {
    // Position serial-spine elements right-to-left from the block handle.
    let currentX = targetHandle.glbPosition.x

    for (let i = branch.nodeIds.length - 1; i >= 0; i--) {
      const nodeId = branch.nodeIds[i]
      const node = rung.nodes.find((n) => n.id === nodeId)
      if (!node) continue

      const style = defaultCustomNodesStyles[node.type ?? 'contact'] ?? defaultCustomNodesStyles.contact

      let rightNeighborGap: number
      if (i === branch.nodeIds.length - 1) {
        rightNeighborGap = blockStyle.gap
      } else {
        const rightNode = rung.nodes.find((n) => n.id === branch.nodeIds[i + 1])
        const rightStyle = defaultCustomNodesStyles[rightNode?.type ?? 'contact'] ?? defaultCustomNodesStyles.contact
        rightNeighborGap = rightStyle.gap
      }

      const gap = style.gap + rightNeighborGap
      currentX -= style.width + gap

      results.unshift({
        nodeId,
        posX: currentX,
        posY: handleY - style.handle.y,
        handleX: currentX,
        handleY,
      })
    }

    // Position parallel-path elements left-to-right from OPEN (matching edge direction:
    // OPEN.output-down → elements → CLOSE.input-down). This ensures the first element is
    // always to the right of OPEN, producing clean L-shaped smoothstep edges.
    for (const region of parallelRegions) {
      const openPos = results.find((r) => r.nodeId === region.openId)
      if (!openPos) continue

      const openNode = rung.nodes.find((n) => n.id === region.openId)
      const openStyle = defaultCustomNodesStyles[openNode?.type ?? 'parallel'] ?? defaultCustomNodesStyles.parallel
      let pCurrentX = openPos.handleX + openStyle.width

      for (let i = 0; i < region.parallelNodeIds.length; i++) {
        const nodeId = region.parallelNodeIds[i]
        const node = rung.nodes.find((n) => n.id === nodeId)
        if (!node) continue

        const style = defaultCustomNodesStyles[node.type ?? 'contact'] ?? defaultCustomNodesStyles.contact

        let leftNeighborGap: number
        if (i === 0) {
          leftNeighborGap = defaultCustomNodesStyles.parallel?.gap ?? 0
        } else {
          const leftNode = rung.nodes.find((n) => n.id === region.parallelNodeIds[i - 1])
          const leftStyle = defaultCustomNodesStyles[leftNode?.type ?? 'contact'] ?? defaultCustomNodesStyles.contact
          leftNeighborGap = leftStyle.gap
        }

        const gap = leftNeighborGap + style.gap
        pCurrentX += gap

        const effectiveHandleY = handleY + region.verticalOffset
        results.push({
          nodeId,
          posX: pCurrentX,
          posY: effectiveHandleY - style.handle.y,
          handleX: pCurrentX,
          handleY: effectiveHandleY,
        })

        pCurrentX += style.width
      }
    }
  } else {
    // Output branch: position serial-spine elements left-to-right from block output handle.
    let currentX = targetHandle.glbPosition.x

    for (let i = 0; i < branch.nodeIds.length; i++) {
      const nodeId = branch.nodeIds[i]
      const node = rung.nodes.find((n) => n.id === nodeId)
      if (!node) continue

      const style = defaultCustomNodesStyles[node.type ?? 'coil'] ?? defaultCustomNodesStyles.coil

      let leftNeighborGap: number
      if (i === 0) {
        leftNeighborGap = blockStyle.gap
      } else {
        const leftNode = rung.nodes.find((n) => n.id === branch.nodeIds[i - 1])
        const leftStyle = defaultCustomNodesStyles[leftNode?.type ?? 'coil'] ?? defaultCustomNodesStyles.coil
        leftNeighborGap = leftStyle.gap
      }

      const gap = leftNeighborGap + style.gap
      currentX += gap

      results.push({
        nodeId,
        posX: currentX,
        posY: handleY - style.handle.y,
        handleX: currentX,
        handleY,
      })

      currentX += style.width
    }

    // Position parallel-path elements (left-to-right within OPEN→CLOSE span)
    for (const region of parallelRegions) {
      const openPos = results.find((r) => r.nodeId === region.openId)
      if (!openPos) continue

      const openNode = rung.nodes.find((n) => n.id === region.openId)
      const openStyle = defaultCustomNodesStyles[openNode?.type ?? 'parallel'] ?? defaultCustomNodesStyles.parallel
      let pCurrentX = openPos.handleX + openStyle.width

      for (let i = 0; i < region.parallelNodeIds.length; i++) {
        const nodeId = region.parallelNodeIds[i]
        const node = rung.nodes.find((n) => n.id === nodeId)
        if (!node) continue

        const style = defaultCustomNodesStyles[node.type ?? 'coil'] ?? defaultCustomNodesStyles.coil

        let leftNeighborGap: number
        if (i === 0) {
          leftNeighborGap = defaultCustomNodesStyles.parallel?.gap ?? 0
        } else {
          const leftNode = rung.nodes.find((n) => n.id === region.parallelNodeIds[i - 1])
          const leftStyle = defaultCustomNodesStyles[leftNode?.type ?? 'coil'] ?? defaultCustomNodesStyles.coil
          leftNeighborGap = leftStyle.gap
        }

        const gap = leftNeighborGap + style.gap
        pCurrentX += gap

        const effectiveHandleY = handleY + region.verticalOffset
        results.push({
          nodeId,
          posX: pCurrentX,
          posY: effectiveHandleY - style.handle.y,
          handleX: pCurrentX,
          handleY: effectiveHandleY,
        })

        pCurrentX += style.width
      }
    }
  }

  // Post-pass: Ensure OPEN/CLOSE encompass the parallel path when it's wider than the serial spine.
  // Mirrors the main-line approach where CLOSE takes Math.max(all predecessors' X).
  for (const region of parallelRegions) {
    const parallelPositions = results.filter((r) => region.parallelNodeIds.includes(r.nodeId))
    if (parallelPositions.length === 0) continue

    if (branch.direction === 'input') {
      // Input: parallel path positioned left-to-right from OPEN. If rightmost parallel
      // element extends past CLOSE, shift OPEN and all predecessors LEFT (away from block).
      // CLOSE stays anchored; the branch expands leftward so the main layout's
      // calculateInputBranchSpace naturally reserves more room.
      const closePos = results.find((r) => r.nodeId === region.closeId)
      if (!closePos) continue

      let rightmostParallelRight = 0
      let lastParallelGap = 0
      for (const p of parallelPositions) {
        const node = rung.nodes.find((n) => n.id === p.nodeId)
        const style = defaultCustomNodesStyles[node?.type ?? 'contact'] ?? defaultCustomNodesStyles.contact
        const right = p.posX + style.width
        if (right > rightmostParallelRight) {
          rightmostParallelRight = right
          lastParallelGap = style.gap
        }
      }

      // Use the same gap formula as the serial spine: lastElement.gap + close.gap
      const closeNode = rung.nodes.find((n) => n.id === region.closeId)
      const closeStyle = defaultCustomNodesStyles[closeNode?.type ?? 'parallel'] ?? defaultCustomNodesStyles.parallel
      const requiredCloseX = rightmostParallelRight + lastParallelGap + closeStyle.gap

      if (requiredCloseX > closePos.posX) {
        const shift = requiredCloseX - closePos.posX
        const openSerialIndex = branch.nodeIds.indexOf(region.openId)

        // Shift OPEN and all elements before it (away from block)
        for (const pos of results) {
          const serialIndex = branch.nodeIds.indexOf(pos.nodeId)
          if (serialIndex !== -1 && serialIndex <= openSerialIndex) {
            pos.posX -= shift
            pos.handleX -= shift
          }
        }
        // Also shift the parallel-path elements that were positioned from OPEN
        for (const pos of parallelPositions) {
          pos.posX -= shift
          pos.handleX -= shift
        }
      }
    } else {
      // Output: parallel path goes left-to-right from OPEN. If rightmost parallel element
      // extends past CLOSE, shift CLOSE and all successors right.
      const closePos = results.find((r) => r.nodeId === region.closeId)
      if (!closePos) continue

      let rightmostParallelRight = 0
      let lastParallelGap = 0
      for (const p of parallelPositions) {
        const node = rung.nodes.find((n) => n.id === p.nodeId)
        const style = defaultCustomNodesStyles[node?.type ?? 'coil'] ?? defaultCustomNodesStyles.coil
        const right = p.posX + style.width
        if (right > rightmostParallelRight) {
          rightmostParallelRight = right
          lastParallelGap = style.gap
        }
      }

      // Use the same gap formula as the serial spine: lastElement.gap + close.gap
      const closeNode = rung.nodes.find((n) => n.id === region.closeId)
      const closeStyle = defaultCustomNodesStyles[closeNode?.type ?? 'parallel'] ?? defaultCustomNodesStyles.parallel
      const requiredCloseX = rightmostParallelRight + lastParallelGap + closeStyle.gap

      if (requiredCloseX > closePos.posX) {
        const shift = requiredCloseX - closePos.posX
        const closeSerialIndex = branch.nodeIds.indexOf(region.closeId)

        for (const pos of results) {
          const serialIndex = branch.nodeIds.indexOf(pos.nodeId)
          if (serialIndex !== -1 && serialIndex >= closeSerialIndex) {
            pos.posX += shift
            pos.handleX += shift
          }
        }
      }
    }
  }

  // Calculate total vertical extent for Phase 4.1c block expansion
  let totalHeight = 0
  for (const region of parallelRegions) {
    let maxParallelElementHeight = 0
    for (const id of region.parallelNodeIds) {
      const n = rung.nodes.find((node) => node.id === id)
      if (n) maxParallelElementHeight = Math.max(maxParallelElementHeight, getDefaultNodeStyle({ node: n }).height)
    }
    totalHeight = Math.max(totalHeight, region.verticalOffset + maxParallelElementHeight)
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
  const railPrefix = direction === 'input' ? 'left-rail' : 'right-rail'
  const rail = findRailNode(nodes, railPrefix)
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
    if (n.id !== rail.id) return n
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
  const rail = findRailNode(nodes, direction === 'input' ? 'left-rail' : 'right-rail')
  const branchHandleId = `branch_${blockId}_${handleId}`

  return nodes.map((n) => {
    if (!rail || n.id !== rail.id) return n
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

    const rail = findRailNode(nodes, branch.direction === 'input' ? 'left-rail' : 'right-rail')
    if (!rail) continue
    const branchHandleId = `branch_${branch.blockId}_${branch.handleId}`

    if (!railUpdates.has(rail.id)) railUpdates.set(rail.id, [])
    railUpdates.get(rail.id)!.push({ branchHandleId, newY: targetHandle.glbPosition.y })
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
  const isInput = target.direction === 'input'
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

  const leftRailId = getRailId(rung.nodes, 'left-rail')
  const rightRailId = getRailId(rung.nodes, 'right-rail')

  if (isInput) {
    // Input branch: rail → nodeIds[0] → ... → nodeIds[n-1] → block
    sourceId = idx === 0 ? leftRailId : nodeIds[idx - 1]
    sourceHandle = idx === 0 ? branchHandleId : resolveOutputHandle(nodeIds[idx - 1])
    targetId = idx === nodeIds.length ? target.blockId : nodeIds[idx]
    targetHandle = idx === nodeIds.length ? target.handleId : resolveInputHandle(nodeIds[idx])
  } else {
    // Output branch: block → nodeIds[0] → ... → nodeIds[n-1] → rail
    sourceId = idx === 0 ? target.blockId : nodeIds[idx - 1]
    sourceHandle = idx === 0 ? target.handleId : resolveOutputHandle(nodeIds[idx - 1])
    targetId = idx === nodeIds.length ? rightRailId : nodeIds[idx]
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
  const branchHandleId = `branch_${target.blockId}_${target.handleId}`
  const leftRailId = getRailId(newNodes, 'left-rail')
  const rightRailId = getRailId(newNodes, 'right-rail')

  if (isInput) {
    // Input branch: rail → element → block handle
    const edge1 = buildEdge(leftRailId, newElement.id, {
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
    const edge2 = buildEdge(newElement.id, rightRailId, {
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

  // Step 5: Rewire edges via shared core utility
  const { edgesToRemove, edgesToAdd } = wireParallelAroundElement({
    incomingEdge,
    outgoingEdge,
    openParallel: openParallel,
    closeParallel: closeParallel,
    aboveElement,
    newElement,
  })
  const newEdges = [...rung.edges.filter((e) => !edgesToRemove.includes(e.id)), ...edgesToAdd]

  // Step 6: Update HandleBranch.nodeIds (serial spine only)
  // Insert OPEN before aboveElement and CLOSE after it.
  // newElement is NOT in nodeIds — it's a parallel-path element.
  const newNodeIds = [...branch.nodeIds]
  newNodeIds.splice(aboveIndex, 0, openParallel.id)
  // aboveElement is now at aboveIndex+1, insert CLOSE after it
  newNodeIds.splice(aboveIndex + 2, 0, closeParallel.id)

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

    // Remap rail branch handle: remove old ID, add new ID at same Y position
    const rail = findRailNode(newNodes, branch.direction === 'input' ? 'left-rail' : 'right-rail')
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

  // Start traversal from the rail (for input) or block (for output)
  let currentId = isInput ? getRailId(rung.nodes, 'left-rail') : branch.blockId
  let currentHandle = isInput ? branchHandleId : branch.handleId
  const nodeIds: string[] = []
  const visited = new Set<string>()

  while (true) {
    const edge = rung.edges.find((e) => e.source === currentId && e.sourceHandle === currentHandle)
    if (!edge) break

    const targetNode = rung.nodes.find((n) => n.id === edge.target)
    if (!targetNode) break

    // Guard against cycles in the edge graph to prevent infinite loops
    if (visited.has(targetNode.id)) break
    visited.add(targetNode.id)

    // Stop at the endpoint (block for input, rail for output)
    const endpointId = isInput ? branch.blockId : getRailId(rung.nodes, 'right-rail')
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
