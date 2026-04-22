import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'

import type { CustomHandleProps } from '../../../../../../../_atoms/graphical-editor/ladder/handle'
import { defaultCustomNodesStyles } from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type { BasicNodeData, ParallelNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { getDefaultNodeStyle, isNodeOfType } from '../../nodes'
import {
  calculateBranchElementPositions,
  calculateDynamicHandleOffsets,
  getBranch,
  updateRailForBranches,
} from '../handle-branch'
import {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getNodePositionBasedOnPreviousNode,
  getPreviousElementsByEdge,
} from '../utils'
import { updateVariableBlockPosition } from '../variable-block'

/**
 * Change the right rail bounds based on the nodes position
 *
 * @param rightRail The right rail node
 * @param nodes The nodes in the rung
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new right rail node
 */
export const changeRailBounds = (rung: RungLadderState, defaultBounds: [number, number]): { nodes: Node[] } => {
  const rightRail = rung.nodes.find((node) => node.id === 'right-rail' || node.id.startsWith('right-rail-'))
  if (!rightRail) return { nodes: rung.nodes }

  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getDefaultNodeStyle({ node: rightRail })
  const nodesWithNoRail = rung.nodes.filter((node) => node.id !== rightRail.id)

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

  if (flowXBounds.maxX > defaultBounds[0]) {
    const newRail = {
      ...rightRail,
      position: {
        x: flowXBounds.maxX,
        y: rightRail.position.y,
      },
      data: {
        ...rightRail.data,
        handles: handles.map((handle) => ({
          ...handle,
          x: flowXBounds.maxX,
        })),
      },
    }

    const newNodes = [...nodesWithNoRail, newRail]
    return { nodes: newNodes }
  }

  const newRail = {
    ...rightRail,
    position: { x: defaultBounds[0] - railStyle.width, y: rightRail.position.y },
    data: {
      ...rightRail.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - railStyle.width })),
    },
  }
  const newNodes = [...nodesWithNoRail, newRail]
  return { nodes: newNodes }
}

/**
 * Calculate the extra horizontal space a block needs for its input branches.
 * Uses the same gap formula as calculateBranchElementPositions (right-to-left
 * from the block handle) so the reserved space exactly matches the positioning.
 * Used during the main layout pass so the block is positioned further right,
 * and subsequent serial nodes cascade naturally.
 */
const calculateInputBranchSpace = (rung: RungLadderState, blockId: string): number => {
  if (!rung.handleBranches?.length) return 0

  const blockStyle = defaultCustomNodesStyles.block

  /**
   * Compute the total width a list of branch nodeIds occupies using the same
   * neighbor-gap formula as calculateBranchElementPositions (input direction).
   */
  const computeSerialSpineWidth = (nodeIds: string[]): number => {
    let total = 0
    for (let i = nodeIds.length - 1; i >= 0; i--) {
      const node = rung.nodes.find((n) => n.id === nodeIds[i])
      const style = defaultCustomNodesStyles[node?.type ?? 'contact'] ?? defaultCustomNodesStyles.contact

      // Right neighbor gap: block gap for the rightmost element, else the right neighbor's gap
      let rightNeighborGap: number
      if (i === nodeIds.length - 1) {
        rightNeighborGap = blockStyle.gap
      } else {
        const rightNode = rung.nodes.find((n) => n.id === nodeIds[i + 1])
        const rightStyle = defaultCustomNodesStyles[rightNode?.type ?? 'contact'] ?? defaultCustomNodesStyles.contact
        rightNeighborGap = rightStyle.gap
      }

      total += style.width + style.gap + rightNeighborGap
    }
    return total
  }

  let maxSpace = 0
  for (const branch of rung.handleBranches) {
    if (branch.blockId !== blockId || branch.direction !== 'input') continue

    // Serial spine width
    let branchSpace = computeSerialSpineWidth(branch.nodeIds)

    // Check if any parallel path within the branch is wider
    const { positions } = calculateBranchElementPositions({ ...rung }, branch)
    const parallelNodeIds = positions.filter((p) => !branch.nodeIds.includes(p.nodeId)).map((p) => p.nodeId)
    if (parallelNodeIds.length > 0) {
      branchSpace = Math.max(branchSpace, computeSerialSpineWidth(parallelNodeIds))
    }

    maxSpace = Math.max(maxSpace, branchSpace)
  }

  return maxSpace
}

/**
 * Position branch elements based on their target block handle positions.
 * Runs as a post-pass after the main layout loop finalizes block positions.
 * Reuses calculateBranchElementPositions from handle-branch module.
 */
const positionBranchElements = (rung: RungLadderState): Node[] => {
  if (!rung.handleBranches?.length) return rung.nodes

  const nodes = [...rung.nodes]

  for (const branch of rung.handleBranches) {
    const { positions } = calculateBranchElementPositions({ ...rung, nodes }, branch)

    for (const pos of positions) {
      const nodeIdx = nodes.findIndex((n) => n.id === pos.nodeId)
      if (nodeIdx === -1) continue

      const node = nodes[nodeIdx]
      const nodeData = node.data as BasicNodeData
      const style = defaultCustomNodesStyles[node.type ?? 'contact'] ?? defaultCustomNodesStyles.contact

      const newInputHandles = nodeData.inputHandles.map((h) => ({
        ...h,
        glbPosition: { x: pos.handleX, y: pos.handleY },
      }))
      const newOutputHandles = nodeData.outputHandles.map((h) => ({
        ...h,
        glbPosition: { x: pos.handleX + style.width, y: pos.handleY },
      }))
      const newHandles = [...newInputHandles, ...newOutputHandles]

      if (node.type === 'parallel') {
        // Parallel OPEN/CLOSE nodes need parallelInputConnector/parallelOutputConnector updated
        const parallelData = nodeData as ParallelNode['data']
        nodes[nodeIdx] = {
          ...node,
          position: { x: pos.posX, y: pos.posY },
          data: {
            ...parallelData,
            handles: newHandles,
            inputHandles: newInputHandles,
            outputHandles: newOutputHandles,
            inputConnector: newHandles.find((h) => h.id === parallelData.inputConnector?.id),
            outputConnector: newHandles.find((h) => h.id === parallelData.outputConnector?.id),
            parallelInputConnector: newHandles.find((h) => h.id === parallelData.parallelInputConnector?.id),
            parallelOutputConnector: newHandles.find((h) => h.id === parallelData.parallelOutputConnector?.id),
          },
        }
      } else {
        nodes[nodeIdx] = {
          ...node,
          position: { x: pos.posX, y: pos.posY },
          data: {
            ...nodeData,
            handles: newHandles,
            inputHandles: newInputHandles,
            outputHandles: newOutputHandles,
            inputConnector: newHandles.find((h) => h.id === nodeData.inputConnector?.id),
            outputConnector: newHandles.find((h) => h.id === nodeData.outputConnector?.id),
          },
        }
      }
    }
  }

  return nodes
}

/**
 * Expand block heights and shift handle positions when branches contain parallels.
 * Must run BEFORE positionBranchElements because branch positioning reads handle.glbPosition.y.
 */
const applyDynamicBlockHandleOffsets = (rung: RungLadderState): Node[] => {
  const nodes = [...rung.nodes]

  const blockStyle = defaultCustomNodesStyles.block
  const DEFAULT_OFFSET = blockStyle.handle.offsetY // 40
  const FIRST_HANDLE_Y = blockStyle.handle.y // 36
  const contactHandleY = defaultCustomNodesStyles.contact.handle.y // 12
  // Vertical clearance between the bottom of main-line nodes (e.g. a parallel-path
  // contact at ~y+24) and the top of branch elements on the next handle below.
  // Must be large enough to avoid overlapping variable labels (~16px each) plus
  // visual breathing room. Derived empirically: contactHeight(24) + labelHeight(16) ≈ 40,
  // rounded up for comfortable spacing.
  const OVERLAP_PADDING = 50

  for (let blockIdx = 0; blockIdx < nodes.length; blockIdx++) {
    const blockNode = nodes[blockIdx]
    if (blockNode.type !== 'block') continue

    const blockData = blockNode.data as BasicNodeData
    const maxHandles = Math.max(blockData.inputHandles.length, blockData.outputHandles.length)
    if (maxHandles === 0) continue

    const result = calculateDynamicHandleOffsets({ ...rung, nodes }, blockNode)

    if (!result) {
      // No expansion needed — reset handle relPosition/style to defaults and clear
      // stale height overrides so blocks shrink back after branch removal.
      const defaultCumulativeY: number[] = [FIRST_HANDLE_Y]
      for (let i = 1; i < maxHandles; i++) {
        defaultCumulativeY[i] = FIRST_HANDLE_Y + i * DEFAULT_OFFSET
      }

      const newInputHandles = blockData.inputHandles.map((h, i) => ({
        ...h,
        glbPosition: { ...h.glbPosition, y: blockNode.position.y + defaultCumulativeY[i] },
        relPosition: { ...h.relPosition, y: defaultCumulativeY[i] },
        style: { ...h.style, top: defaultCumulativeY[i] },
      }))
      const newOutputHandles = blockData.outputHandles.map((h, i) => ({
        ...h,
        glbPosition: { ...h.glbPosition, y: blockNode.position.y + defaultCumulativeY[i] },
        relPosition: { ...h.relPosition, y: defaultCumulativeY[i] },
        style: { ...h.style, top: defaultCumulativeY[i] },
      }))
      const newHandles = [...newInputHandles, ...newOutputHandles]

      const defaultHeight = Math.max(blockStyle.height, defaultCumulativeY[maxHandles - 1] + 24)

      nodes[blockIdx] = {
        ...blockNode,
        height: defaultHeight,
        measured: { width: blockNode.measured?.width ?? blockNode.width ?? 0, height: defaultHeight },
        data: {
          ...blockData,
          handles: newHandles,
          inputHandles: newInputHandles,
          outputHandles: newOutputHandles,
          inputConnector: newHandles.find((h) => h.id === blockData.inputConnector?.id),
          outputConnector: newHandles.find((h) => h.id === blockData.outputConnector?.id),
        },
      }
      continue
    }

    // Mutable copies of offsets for overlap resolution
    const inputOffsets = [...result.inputOffsets]
    const outputOffsets = [...result.outputOffsets]

    // Compute cumulative Y for each handle index
    const cumulativeY: number[] = [FIRST_HANDLE_Y] // index 0 = 36
    for (let i = 1; i < maxHandles; i++) {
      const prevInputOffset = inputOffsets[i - 1] ?? DEFAULT_OFFSET
      const prevOutputOffset = outputOffsets[i - 1] ?? DEFAULT_OFFSET
      cumulativeY.push(cumulativeY[i - 1] + Math.max(prevInputOffset, prevOutputOffset))
    }

    // The block's natural bottom before any expansion — nodes starting below this
    // are in a different visual region (e.g. main-line parallel-path contacts
    // wrapping the block) and must not inflate handle offsets.
    const defaultBlockBottom =
      blockNode.position.y + Math.max(blockStyle.height, FIRST_HANDLE_Y + (maxHandles - 1) * DEFAULT_OFFSET + 24)

    // Overlap resolution: when handle[i+1] has a branch, ensure main-line nodes
    // (e.g. parallel-path elements on handle[i]'s serial chain) don't extend into
    // handle[i+1]'s branch area.
    for (let i = 0; i < maxHandles - 1; i++) {
      const inputH = blockData.inputHandles[i + 1]
      const outputH = blockData.outputHandles[i + 1]
      const nextHasBranch =
        (inputH && getBranch({ ...rung, nodes }, blockNode.id, inputH.id as string)) ||
        (outputH && getBranch({ ...rung, nodes }, blockNode.id, outputH.id as string))
      if (!nextHasBranch) continue

      const handleIGlbY = blockNode.position.y + cumulativeY[i]

      // Find the max bottom of non-branch nodes that extend below handle[i]
      let maxBottom = 0
      for (const n of nodes) {
        if (n.id === blockNode.id) continue
        if ((n.data as BasicNodeData).branchContext) continue
        if (
          n.type === 'powerRail' ||
          n.type === 'variable' ||
          n.type === 'placeholder' ||
          n.type === 'parallelPlaceholder'
        )
          continue

        // Skip nodes positioned below the block's natural extent — they belong to
        // a main-line parallel wrapping the block and don't overlap branch elements.
        if (n.position.y >= defaultBlockBottom) continue

        const nodeHeight = n.height ?? n.measured?.height ?? getDefaultNodeStyle({ node: n }).height
        const nodeBottom = n.position.y + nodeHeight
        if (nodeBottom > handleIGlbY) {
          maxBottom = Math.max(maxBottom, nodeBottom)
        }
      }

      if (maxBottom === 0) continue

      // Required offset so branch elements at handle[i+1] clear the max bottom:
      // handle[i+1]_glbY - contactHandleY > maxBottom + OVERLAP_PADDING
      // handle[i+1]_glbY = blockPosY + cumulativeY[i] + offset[i]
      // => offset[i] > maxBottom + OVERLAP_PADDING + contactHandleY - blockPosY - cumulativeY[i]
      const requiredOffset = maxBottom + OVERLAP_PADDING + contactHandleY - blockNode.position.y - cumulativeY[i]
      const currentOffset = Math.max(inputOffsets[i] ?? DEFAULT_OFFSET, outputOffsets[i] ?? DEFAULT_OFFSET)

      if (requiredOffset > currentOffset) {
        if (i < inputOffsets.length) inputOffsets[i] = requiredOffset
        if (i < outputOffsets.length) outputOffsets[i] = requiredOffset

        // Recompute cumulativeY from i+1 onwards
        for (let j = i + 1; j < maxHandles; j++) {
          cumulativeY[j] =
            cumulativeY[j - 1] + Math.max(inputOffsets[j - 1] ?? DEFAULT_OFFSET, outputOffsets[j - 1] ?? DEFAULT_OFFSET)
        }
      }
    }

    const totalHeight = cumulativeY[maxHandles - 1] + 24

    // Update input handles
    const newInputHandles = blockData.inputHandles.map((h, i) => ({
      ...h,
      glbPosition: { ...h.glbPosition, y: blockNode.position.y + cumulativeY[i] },
      relPosition: { ...h.relPosition, y: cumulativeY[i] },
      style: { ...h.style, top: cumulativeY[i] },
    }))

    // Update output handles
    const newOutputHandles = blockData.outputHandles.map((h, i) => ({
      ...h,
      glbPosition: { ...h.glbPosition, y: blockNode.position.y + cumulativeY[i] },
      relPosition: { ...h.relPosition, y: cumulativeY[i] },
      style: { ...h.style, top: cumulativeY[i] },
    }))

    const newHandles = [...newInputHandles, ...newOutputHandles]

    nodes[blockIdx] = {
      ...blockNode,
      height: totalHeight,
      measured: { width: blockNode.measured?.width ?? blockNode.width ?? 0, height: totalHeight },
      data: {
        ...blockData,
        handles: newHandles,
        inputHandles: newInputHandles,
        outputHandles: newOutputHandles,
        inputConnector: newHandles.find((h) => h.id === blockData.inputConnector?.id),
        outputConnector: newHandles.find((h) => h.id === blockData.outputConnector?.id),
      },
    }
  }

  return nodes
}

/**
 * Update the position of the diagram elements
 *
 * @param rung The current rung state
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new nodes
 */
export const updateDiagramElementsPosition = (
  rung: RungLadderState,
  defaultBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  const { nodes } = rung
  const newNodes: Node[] = []

  /**
   * Find the parallels in the rung
   */
  const parallels = findParallelsInRung(rung)
  const parallelsDepth = parallels.map((parallel) => findAllParallelsDepthAndNodes(rung, parallel))

  /**
   * Iterate over the nodes and update their position
   */
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    /**
     * Nodes that are not moved in the diagram
     * These nodes are just added to the new nodes array
     */
    if (node.type === 'powerRail') {
      newNodes.push(node)
      continue
    }

    if (node.type === 'variable') continue

    // Branch elements are positioned in a post-pass after block positions are finalized
    if ((node.data as BasicNodeData).branchContext) {
      newNodes.push(node)
      continue
    }

    let newNodePosition: { posX: number; posY: number; handleX: number; handleY: number } = {
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
    }

    /**
     * Find the previous nodes and edges of the current node
     */
    const { nodes: previousNodes, edges: previousEdges } = getPreviousElementsByEdge({ ...rung, nodes: newNodes }, node)
    if (!previousNodes || !previousEdges) return { nodes: rung.nodes, edges: rung.edges }

    if (previousNodes.all.length === 1) {
      /**
       * Nodes that only have one edge connecting to them
       */
      const previousNode = previousNodes.all[0]
      if (
        isNodeOfType(previousNode, 'parallel') &&
        (previousNode as ParallelNode).data.type === 'open' &&
        previousEdges[0].sourceHandle === (previousNode as ParallelNode).data.parallelOutputConnector?.id
      ) {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'parallel')
      } else {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial')
      }
    } else {
      /**
       * Nodes that have multiple edges connecting to them
       * It means that the node is an closed parallel
       */
      const openParallel = newNodes.find((n) => n.id === (node as ParallelNode).data.parallelOpenReference)
      if (!openParallel) continue

      const openParallelPosition = getNodePositionBasedOnPreviousNode(openParallel, node, 'serial')

      /**
       * Find the highest position of the previous nodes
       * This is used to calculate the position of the new node
       */
      let acc = newNodePosition
      for (let j = 0; j < previousNodes.all.length; j++) {
        const previousNode = previousNodes.all[j]
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

    // If this block has input branches, ensure there is enough horizontal room
    // between the left rail and the block for branch elements. Only shift the block
    // further right when the main-line serial chain has not already provided enough space.
    if (node.type === 'block') {
      const branchSpace = calculateInputBranchSpace(rung, node.id)
      if (branchSpace > 0) {
        const leftRail = newNodes.find((n) => n.id === 'left-rail' || n.id.startsWith('left-rail-'))
        const railStyle = defaultCustomNodesStyles.powerRail
        const leftRailRight = leftRail ? leftRail.position.x + (leftRail.width ?? railStyle.width) : 0
        // The branch needs branchSpace from the block handle to the leftmost element,
        // PLUS enough gap between the rail and the leftmost element for edge rendering.
        // Use the same spacing as the main line (railGap + contactGap) so smoothstep
        // edges have room for their routing offsets without backtracking through elements.
        const railToElementGap = railStyle.gap + defaultCustomNodesStyles.contact.gap
        const totalNeeded = branchSpace + railToElementGap
        const availableSpace = newNodePosition.posX - leftRailRight
        const deficit = totalNeeded - availableSpace
        if (deficit > 0) {
          newNodePosition.posX += deficit
          newNodePosition.handleX += deficit
        }
      }
    }

    /**
     * Find the parallel that
     * the node is in and update the position
     */
    let foundInParallel: boolean = false
    parallelsDepth.forEach((parallel) => {
      for (const object in parallel) {
        const objectParallel = parallel[object]
        if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
          foundInParallel = true
          const newPosY =
            objectParallel.highestNode.position.y +
            objectParallel.height +
            getDefaultNodeStyle({ node: objectParallel.highestNode }).verticalGap -
            getDefaultNodeStyle({ node }).handle.y
          const newHandleY =
            objectParallel.highestNode.position.y +
            objectParallel.height +
            getDefaultNodeStyle({ node: objectParallel.highestNode }).verticalGap
          newNodePosition = {
            ...newNodePosition,
            posY: newPosY,
            handleY: newHandleY,
          }
          break
        }
        if (objectParallel.nodes.serial.find((n) => n.id === node.id)) {
          foundInParallel = true
          break
        }
      }
    })

    /**
     * Update the handles position
     * based on the new node position
     */
    const nodeData = node.data as BasicNodeData
    const newNodeHandlesInputPosition = nodeData.inputHandles.map((handle, index) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y:
            node.type !== 'block'
              ? newNodePosition.handleY
              : newNodePosition.handleY + index * defaultCustomNodesStyles.block.handle.offsetY,
        },
      }
    })
    const newNodeHandlesOutputPosition = nodeData.outputHandles.map((handle, index) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y:
            node.type !== 'block'
              ? newNodePosition.handleY
              : newNodePosition.handleY + index * defaultCustomNodesStyles.block.handle.offsetY,
        },
      }
    })
    const newNodeHandlesPosition = [...newNodeHandlesInputPosition, ...newNodeHandlesOutputPosition]

    /**
     * Create the new node
     * and add it to the new nodes array
     *
     * If the node is a parallel node
     * update the parallel handles
     *
     * If not, update the input and output handles
     */
    if (!isNodeOfType(node, 'parallel')) {
      const newNode: Node<BasicNodeData> = {
        ...node,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...node.data,
          ...nodeData,
          handles: newNodeHandlesPosition,
          inputHandles: newNodeHandlesInputPosition,
          outputHandles: newNodeHandlesOutputPosition,
          inputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === (node.data as BasicNodeData).inputConnector?.id,
          ),
          outputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === (node.data as BasicNodeData).outputConnector?.id,
          ),
        },
      }
      newNodes.push(newNode)
    } else {
      const parallelNode = node as ParallelNode
      const newParallelNode: ParallelNode = {
        ...parallelNode,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...parallelNode.data,
          handles: newNodeHandlesPosition,
          inputHandles: newNodeHandlesInputPosition,
          outputHandles: newNodeHandlesOutputPosition,
          inputConnector: newNodeHandlesPosition.find((handle) => handle.id === parallelNode.data.inputConnector?.id),
          outputConnector: newNodeHandlesPosition.find((handle) => handle.id === parallelNode.data.outputConnector?.id),
          parallelInputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === parallelNode.data.parallelInputConnector?.id,
          ),
          parallelOutputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === parallelNode.data.parallelOutputConnector?.id,
          ),
        },
      }
      newNodes.push(newParallelNode)
    }

    /**
     * If the node is in a parallel
     * update the parallel object
     * with the new node
     */
    if (foundInParallel) {
      const newNode = newNodes[newNodes.length - 1]
      const parallelsDepthCopy = parallelsDepth
      parallelsDepthCopy.forEach((parallel, index) => {
        for (const object in parallel) {
          const objectParallel = parallel[object]
          if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
            const nodeIndex = objectParallel.nodes.parallel.findIndex((n) => n.id === node.id)
            parallelsDepth[index][object].nodes.parallel.splice(nodeIndex, 1, newNode)
          }
          if (objectParallel.nodes.serial.find((n) => n.id === node.id)) {
            const nodeIndex = objectParallel.nodes.serial.findIndex((n) => n.id === node.id)
            parallelsDepth[index][object].nodes.serial.splice(nodeIndex, 1, newNode)
          }
          if (objectParallel.highestNode.id === node.id) {
            parallelsDepth[index][object].highestNode = newNode
          }
          if (objectParallel.parallels.open.id === node.id) {
            parallelsDepth[index][object].parallels.open = newNode as ParallelNode
          }
          if (objectParallel.parallels.close.id === node.id) {
            parallelsDepth[index][object].parallels.close = newNode as ParallelNode
          }
        }
      })
    }
  }

  // Post-pass: dynamic block handle spacing (must run BEFORE positionBranchElements)
  const blockExpandedNodes = applyDynamicBlockHandleOffsets({ ...rung, nodes: newNodes })

  // Post-pass: position branch elements based on finalized block handle positions
  const branchPositionedNodes = positionBranchElements({ ...rung, nodes: blockExpandedNodes })

  // Post-pass: sync rail branch handle Y positions with block handle Y positions
  const railSyncedNodes = updateRailForBranches(branchPositionedNodes, rung.handleBranches)

  const { nodes: changedRailNodes } = changeRailBounds(
    {
      ...rung,
      nodes: railSyncedNodes,
    },
    defaultBounds,
  )

  const variablesNodes = updateVariableBlockPosition({
    ...rung,
    nodes: changedRailNodes,
  })

  return { nodes: variablesNodes.nodes, edges: variablesNodes.edges }
}
