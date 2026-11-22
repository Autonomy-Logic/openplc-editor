import type { Edge, Node } from '@xyflow/react'

import type { RungLadderState } from '../../ports/types'
import { legacyRungBounds, sizeBlockNode } from './legacy/block-size'
import {
  calculateBranchElementPositions,
  calculateDynamicHandleOffsets,
  getBranch,
  updateRailForBranches,
} from './legacy/branches'
import { connectorIdOf, handleIdOf, handlesOf, type LegacyHandle, withHandleY } from './legacy/node-access'
import {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getNodePositionBasedOnPreviousNode,
  getPreviousElementsByEdge,
  type LegacyNodePosition,
} from './legacy/parallels'
import { updateVariableBlockPosition } from './legacy/variable-block'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  getDefaultNodeStyle,
  LEGACY_BLOCK_BOTTOM_PADDING,
  LEGACY_BRANCH_OVERLAP_PADDING,
  LEGACY_NODE_STYLES,
} from './legacy-style'

const CONNECTOR_KEYS = ['inputConnector', 'outputConnector'] as const
const PARALLEL_CONNECTOR_KEYS = [
  'inputConnector',
  'outputConnector',
  'parallelInputConnector',
  'parallelOutputConnector',
] as const

/** `node.data` with new handle lists and each connector re-pointed at the handle of the same id. */
function withHandles(
  node: Node,
  inputHandles: LegacyHandle[],
  outputHandles: LegacyHandle[],
  connectorKeys: readonly string[],
): Record<string, unknown> {
  const handles = [...inputHandles, ...outputHandles]
  const data: Record<string, unknown> = { ...node.data, handles, inputHandles, outputHandles }
  for (const key of connectorKeys) {
    const connectorId = connectorIdOf(node.data, key)
    data[key] = handles.find((h) => h.id === connectorId)
  }
  return data
}

/**
 * Places the right rail past the rightmost element (element width, its gap twice and the rail gap), or at the rung's
 * default width when the elements fit in it.
 */
export const changeRailBounds = (rung: RungLadderState, defaultBounds: [number, number]): { nodes: Node[] } => {
  const rightRail = rung.nodes.find((node) => node.id.startsWith('right-rail'))
  if (!rightRail) return { nodes: rung.nodes }

  const handles = handlesOf(rightRail.data, 'handles')
  const railStyle = getDefaultNodeStyle({ node: rightRail })
  const nodesWithNoRail = rung.nodes.filter((node) => !node.id.startsWith('right-rail'))

  const flowXBounds = nodesWithNoRail.reduce(
    (acc, node) => {
      const nodeStyle = getDefaultNodeStyle({ node })
      return {
        minX: Math.min(acc.minX, node.position.x),
        maxX: Math.max(acc.maxX, node.position.x + (node.width || 0) + 2 * nodeStyle.gap + railStyle.gap),
      }
    },
    { minX: 0, maxX: 0 },
  )

  const railX = flowXBounds.maxX > defaultBounds[0] ? flowXBounds.maxX : defaultBounds[0] - railStyle.width
  const newRail: Node = {
    ...rightRail,
    position: { x: railX, y: rightRail.position.y },
    data: {
      ...rightRail.data,
      handles: handles.map((handle) => ({ ...handle, x: railX })),
    },
  }
  return { nodes: [...nodesWithNoRail, newRail] }
}

/**
 * The horizontal room a block needs left of its input pins for their branches: the pin's flow `x` minus the leftmost
 * branch element `x`, which does not depend on where the block currently sits.
 */
const calculateInputBranchSpace = (rung: RungLadderState, blockId: string): number => {
  if (!rung.handleBranches?.length) return 0

  const blockNode = rung.nodes.find((n) => n.id === blockId)
  if (!blockNode) return 0
  const inputHandles = handlesOf(blockNode.data, 'inputHandles')

  let maxSpace = 0
  for (const branch of rung.handleBranches) {
    if (branch.blockId !== blockId || branch.direction !== 'input') continue

    const targetHandle = inputHandles.find((h) => h.id === branch.handleId)
    if (!targetHandle) continue
    const handleX = targetHandle.glbPosition.x

    const { positions } = calculateBranchElementPositions({ ...rung }, branch)
    if (positions.length === 0) continue

    let minX = Infinity
    for (const p of positions) if (p.posX < minX) minX = p.posX
    if (minX === Infinity) continue

    maxSpace = Math.max(maxSpace, handleX - minX)
  }

  return maxSpace
}

/** Places every branch element at the position its branch computes from the block pin it hangs on. */
const positionBranchElements = (rung: RungLadderState): Node[] => {
  if (!rung.handleBranches?.length) return rung.nodes

  const nodes = [...rung.nodes]

  for (const branch of rung.handleBranches) {
    const { positions } = calculateBranchElementPositions({ ...rung, nodes }, branch)

    for (const pos of positions) {
      const nodeIdx = nodes.findIndex((n) => n.id === pos.nodeId)
      if (nodeIdx === -1) continue

      const node = nodes[nodeIdx]
      const style = LEGACY_NODE_STYLES[node.type ?? 'contact'] ?? LEGACY_NODE_STYLES.contact

      const newInputHandles = handlesOf(node.data, 'inputHandles').map((h) => ({
        ...h,
        glbPosition: { x: pos.handleX, y: pos.handleY },
      }))
      const newOutputHandles = handlesOf(node.data, 'outputHandles').map((h) => ({
        ...h,
        glbPosition: { x: pos.handleX + style.width, y: pos.handleY },
      }))

      nodes[nodeIdx] = {
        ...node,
        position: { x: pos.posX, y: pos.posY },
        data: withHandles(
          node,
          newInputHandles,
          newOutputHandles,
          node.type === 'parallel' ? PARALLEL_CONNECTOR_KEYS : CONNECTOR_KEYS,
        ),
      }
    }
  }

  return nodes
}

/** A block with its pin rows at the given offsets from its top, its height fitted to the last row. */
function withPinRows(block: Node, inputHandles: LegacyHandle[], outputHandles: LegacyHandle[], rows: number[]): Node {
  const height = rows[rows.length - 1] + LEGACY_BLOCK_BOTTOM_PADDING
  const placeRow = (h: LegacyHandle, i: number): LegacyHandle => withHandleY(h, block.position.y + rows[i], rows[i])
  return {
    ...block,
    height,
    measured: { width: block.measured?.width ?? block.width ?? 0, height },
    data: withHandles(block, inputHandles.map(placeRow), outputHandles.map(placeRow), CONNECTOR_KEYS),
  }
}

/**
 * Spaces each block's pin rows and grows the block to fit its branches and the main-line elements beside them; a
 * block with no branch needs gets the default row spacing and its natural height.
 */
const applyDynamicBlockHandleOffsets = (rung: RungLadderState): Node[] => {
  const nodes = [...rung.nodes]
  const contactHandleY = LEGACY_NODE_STYLES.contact.handle.y

  for (let blockIdx = 0; blockIdx < nodes.length; blockIdx++) {
    const blockNode = nodes[blockIdx]
    if (blockNode.type !== 'block') continue

    const inputHandles = handlesOf(blockNode.data, 'inputHandles')
    const outputHandles = handlesOf(blockNode.data, 'outputHandles')
    const maxHandles = Math.max(inputHandles.length, outputHandles.length)
    if (maxHandles === 0) continue

    const result = calculateDynamicHandleOffsets({ ...rung, nodes }, blockNode)

    if (!result) {
      const defaultCumulativeY: number[] = [DEFAULT_BLOCK_CONNECTOR_Y]
      for (let i = 1; i < maxHandles; i++) {
        defaultCumulativeY[i] = DEFAULT_BLOCK_CONNECTOR_Y + i * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET
      }
      nodes[blockIdx] = withPinRows(blockNode, inputHandles, outputHandles, defaultCumulativeY)
      continue
    }

    const inputOffsets = [...result.inputOffsets]
    const outputOffsets = [...result.outputOffsets]
    const offsetAt = (i: number): number =>
      Math.max(
        inputOffsets[i] ?? DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        outputOffsets[i] ?? DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      )

    const cumulativeY: number[] = [DEFAULT_BLOCK_CONNECTOR_Y]
    for (let i = 1; i < maxHandles; i++) {
      cumulativeY.push(cumulativeY[i - 1] + offsetAt(i - 1))
    }

    const recomputeCumulativeYFrom = (startIdx: number): void => {
      for (let j = startIdx; j < maxHandles; j++) {
        cumulativeY[j] = cumulativeY[j - 1] + offsetAt(j - 1)
      }
    }

    const pinHasBranch = (handle: LegacyHandle | undefined): boolean => {
      const handleId = handle === undefined ? undefined : handleIdOf(handle)
      return handleId !== undefined && getBranch({ ...rung, nodes }, blockNode.id, handleId) !== undefined
    }

    let stable = false
    let iterations = 0
    const maxIterations = nodes.length * maxHandles + 4
    while (!stable && iterations++ < maxIterations) {
      stable = true
      for (let i = 0; i < maxHandles - 1; i++) {
        if (!pinHasBranch(inputHandles[i + 1]) && !pinHasBranch(outputHandles[i + 1])) continue

        const handleIGlbY = blockNode.position.y + cumulativeY[i]
        const handleIPlus1GlbY = blockNode.position.y + cumulativeY[i + 1]
        const branchAreaTop = handleIPlus1GlbY - contactHandleY
        const branchAreaBottom = handleIPlus1GlbY + contactHandleY

        let maxBottom = 0
        for (const n of nodes) {
          if (n.id === blockNode.id) continue
          if (n.data.branchContext) continue
          if (
            n.type === 'powerRail' ||
            n.type === 'variable' ||
            n.type === 'placeholder' ||
            n.type === 'parallelPlaceholder'
          )
            continue

          const nodeHeight = n.height ?? n.measured?.height ?? getDefaultNodeStyle({ node: n }).height
          const nodeTop = n.position.y
          const nodeBottom = nodeTop + nodeHeight
          if (nodeBottom <= handleIGlbY) continue
          if (nodeTop > branchAreaBottom) continue
          if (nodeBottom < branchAreaTop) continue
          maxBottom = Math.max(maxBottom, nodeBottom)
        }

        if (maxBottom === 0) continue

        const requiredOffset =
          maxBottom + LEGACY_BRANCH_OVERLAP_PADDING + contactHandleY - blockNode.position.y - cumulativeY[i]

        if (requiredOffset > offsetAt(i)) {
          if (i < inputOffsets.length) inputOffsets[i] = requiredOffset
          if (i < outputOffsets.length) outputOffsets[i] = requiredOffset
          recomputeCumulativeYFrom(i + 1)
          stable = false
        }
      }
    }

    nodes[blockIdx] = withPinRows(blockNode, inputHandles, outputHandles, cumulativeY)
  }

  return nodes
}

/** The open parallel a closing parallel pairs with, among the nodes already laid out. */
function openParallelOf(laidOut: Node[], close: Node): Node | undefined {
  return laidOut.find((n) => n.id === close.data.parallelOpenReference)
}

/**
 * Today's LD layout: places each element after its predecessor in node order, then sizes blocks, places branch
 * elements, moves the right rail and rebuilds variable boxes (`previousNodes`: fallback box identities).
 */
export const updateDiagramElementsPosition = (
  rung: RungLadderState,
  defaultBounds: [number, number],
  previousNodes?: Node[],
): { nodes: Node[]; edges: Edge[] } => {
  const heightExpandedNodes = applyDynamicBlockHandleOffsets(rung)
  const expandedRung: RungLadderState = { ...rung, nodes: heightExpandedNodes }
  const nodes = heightExpandedNodes
  const newNodes: Node[] = []

  const parallels = findParallelsInRung(expandedRung)
  const parallelsDepth = parallels.map((parallel) => findAllParallelsDepthAndNodes(expandedRung, parallel))

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (node.type === 'powerRail') {
      newNodes.push(node)
      continue
    }

    if (node.type === 'variable') continue

    if (node.data.branchContext) {
      newNodes.push(node)
      continue
    }

    let newNodePosition: LegacyNodePosition = { posX: 0, posY: 0, handleX: 0, handleY: 0 }

    const { nodes: previousLinkedNodes, edges: previousEdges } = getPreviousElementsByEdge(
      { ...rung, nodes: newNodes },
      node,
    )

    if (previousLinkedNodes.all.length === 1) {
      const previousNode = previousLinkedNodes.all[0]
      const fromParallelOutput =
        previousNode.type === 'parallel' &&
        previousNode.data.type === 'open' &&
        previousEdges[0].sourceHandle === connectorIdOf(previousNode.data, 'parallelOutputConnector')
      newNodePosition = getNodePositionBasedOnPreviousNode(
        previousNode,
        node,
        fromParallelOutput ? 'parallel' : 'serial',
      )
    } else {
      const openParallel = openParallelOf(newNodes, node)
      if (!openParallel) continue

      const openParallelPosition = getNodePositionBasedOnPreviousNode(openParallel, node, 'serial')

      let acc = newNodePosition
      for (const previousNode of previousLinkedNodes.all) {
        const position = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial')
        acc = {
          posX: Math.max(acc.posX, position.posX),
          posY: Math.max(acc.posY, position.posY),
          handleX: Math.max(acc.handleX, position.handleX),
          handleY: Math.max(acc.handleY, position.handleY),
        }
      }
      newNodePosition = {
        posX: acc.posX,
        posY: openParallelPosition.posY,
        handleX: acc.handleX,
        handleY: openParallelPosition.handleY,
      }
    }

    if (node.type === 'block') {
      const branchSpace = calculateInputBranchSpace(rung, node.id)
      if (branchSpace > 0) {
        const leftRail = newNodes.find((n) => n.id.startsWith('left-rail'))
        const railStyle = LEGACY_NODE_STYLES.powerRail
        const leftRailRight = leftRail ? leftRail.position.x + (leftRail.width ?? railStyle.width) : 0
        const railToElementGap = railStyle.gap + LEGACY_NODE_STYLES.contact.gap
        const totalNeeded = branchSpace + railToElementGap
        const availableSpace = newNodePosition.posX - leftRailRight
        const deficit = totalNeeded - availableSpace
        if (deficit > 0) {
          newNodePosition.posX += deficit
          newNodePosition.handleX += deficit
        }
      }
    }

    let foundInParallel = false
    parallelsDepth.forEach((parallel) => {
      for (const object in parallel) {
        const objectParallel = parallel[object]
        if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
          foundInParallel = true
          const pathHandleY =
            objectParallel.highestNode.position.y +
            objectParallel.height +
            getDefaultNodeStyle({ node: objectParallel.highestNode }).verticalGap
          newNodePosition = {
            ...newNodePosition,
            posY: pathHandleY - getDefaultNodeStyle({ node }).handle.y,
            handleY: pathHandleY,
          }
          break
        }
        if (objectParallel.nodes.serial.find((n) => n.id === node.id)) {
          foundInParallel = true
          break
        }
      }
    })

    const placeHandle = (handle: LegacyHandle, index: number): LegacyHandle => ({
      ...handle,
      glbPosition: {
        x: handle.position === 'left' ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
        y:
          node.type !== 'block'
            ? newNodePosition.handleY
            : newNodePosition.handleY + index * LEGACY_NODE_STYLES.block.handle.offsetY,
      },
    })
    const newInputHandles = handlesOf(node.data, 'inputHandles').map(placeHandle)
    const newOutputHandles = handlesOf(node.data, 'outputHandles').map(placeHandle)

    const newNode: Node = {
      ...node,
      position: { x: newNodePosition.posX, y: newNodePosition.posY },
      data: withHandles(
        node,
        newInputHandles,
        newOutputHandles,
        node.type === 'parallel' ? PARALLEL_CONNECTOR_KEYS : CONNECTOR_KEYS,
      ),
    }
    newNodes.push(newNode)

    if (foundInParallel) {
      parallelsDepth.forEach((parallel) => {
        for (const object in parallel) {
          const objectParallel = parallel[object]
          const parallelIndex = objectParallel.nodes.parallel.findIndex((n) => n.id === node.id)
          if (parallelIndex !== -1) objectParallel.nodes.parallel.splice(parallelIndex, 1, newNode)
          const serialIndex = objectParallel.nodes.serial.findIndex((n) => n.id === node.id)
          if (serialIndex !== -1) objectParallel.nodes.serial.splice(serialIndex, 1, newNode)
          if (objectParallel.highestNode.id === node.id) objectParallel.highestNode = newNode
          if (objectParallel.parallels.open.id === node.id) objectParallel.parallels.open = newNode
          if (objectParallel.parallels.close.id === node.id) objectParallel.parallels.close = newNode
        }
      })
    }
  }

  const blockExpandedNodes = applyDynamicBlockHandleOffsets({ ...rung, nodes: newNodes })
  const branchPositionedNodes = positionBranchElements({ ...rung, nodes: blockExpandedNodes })
  const railSyncedNodes = updateRailForBranches(branchPositionedNodes, rung.handleBranches)
  const { nodes: changedRailNodes } = changeRailBounds({ ...rung, nodes: railSyncedNodes }, defaultBounds)

  return updateVariableBlockPosition({ ...rung, nodes: changedRailNodes }, previousNodes)
}

/**
 * Lays a rung out exactly as the editor does today: blocks sized from their variants, then
 * `updateDiagramElementsPosition` within the rung's bounds (`DEFAULT_RUNG_BOUNDS` when unusable).
 */
export function legacyLayoutRung(rung: RungLadderState): { nodes: Node[]; edges: Edge[] } {
  const sized: RungLadderState = { ...rung, nodes: rung.nodes.map(sizeBlockNode) }
  return updateDiagramElementsPosition(sized, legacyRungBounds(sized))
}
