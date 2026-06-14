import type { RungLadderState } from '@root/frontend/store/slices'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { v4 as uuidv4 } from 'uuid'

import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type { BasicNodeData, BlockVariant } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import {
  canPlaceElementOnHandle,
  getDeepestBranchParallelNodes,
  getNodesInsideAllBranchParallels,
  hasBranchOnHandle,
} from '../handle-branch'
import { getDeepestNodesInsideParallels, getNodesInsideAllParallels, getPlaceholderPositionBasedOnNode } from '../utils'

export const removePlaceholderElements = (nodes: Node[]) => {
  return nodes.filter((node) => node.type !== 'placeholder' && node.type !== 'parallelPlaceholder')
}

/**
 * Render the placeholder nodes
 *
 * @param rung The current rung state
 *
 * @returns The placeholder nodes
 *
 * TODO: Refactor this function to make only one placeholder between nodes
 */
export const renderPlaceholderElements = (rung: RungLadderState) => {
  const { nodes } = rung
  const placeholderNodes: Node[] = []
  const nodesInsideParallels = getNodesInsideAllParallels(rung)
  const deepestNodesParallels = getDeepestNodesInsideParallels(rung)
  // Branch-aware sets: main-rail's array-order heuristic doesn't survive in branches
  // because nested OPEN/CLOSE pairs are appended on creation rather than interleaved
  // in nesting order. Use depth-derived sets so the "parallel placeholder only on the
  // deepest level" rule applies to branch parallel-path elements too.
  const insideBranchParallels = getNodesInsideAllBranchParallels(rung)
  const deepestBranchParallels = getDeepestBranchParallelNodes(rung)
  const allowsBottomPlaceholder = (node: Node): boolean => {
    const inBranchParallel = insideBranchParallels.has(node.id)
    if (inBranchParallel) return deepestBranchParallels.has(node.id)
    return !nodesInsideParallels.includes(node) || deepestNodesParallels.includes(node)
  }

  nodes.forEach((node) => {
    let placeholders: Node[] = []
    if (
      node.type === 'placeholder' ||
      node.type === 'parallelPlaceholder' ||
      node.type === 'variable' ||
      nodes.find((n) => n.id === `copycat_${node.id}`)
    ) {
      if (nodes.find((n) => n.id === `copycat_${node.id}`) || node.type === 'variable') placeholderNodes.push(node)
      return
    }

    // Branch elements: generate left/right placeholders with handleBranchTarget data
    // so drops trigger branch insertion, plus bottom (parallel) placeholder.
    if ((node.data as BasicNodeData).branchContext) {
      // OPEN/CLOSE junction nodes in branches: generate one serial placeholder each
      // so users can insert elements before/after the parallel group.
      if (node.type === 'parallel') {
        const ctx = (node.data as BasicNodeData).branchContext!
        const branch = rung.handleBranches?.find((b) => b.blockId === ctx.blockId && b.handleId === ctx.handleId)
        const nodeIndex = branch?.nodeIds.indexOf(node.id) ?? -1

        if (nodeIndex !== -1) {
          const branchTarget = (insertIdx: number) => ({
            blockId: ctx.blockId,
            handleId: ctx.handleId,
            direction: ctx.direction,
            handlePosition: { x: 0, y: 0 },
            insertIndex: insertIdx,
          })

          const parallelData = node.data as { type?: string }
          if (parallelData.type === 'open') {
            const ph = nodesBuilder.placeholder({
              id: `placeholder_${node.id}_${uuidv4()}`,
              type: 'default',
              relatedNode: node,
              position: 'left',
              ...getPlaceholderPositionBasedOnNode(node, 'left'),
            })
            ph.data = { ...ph.data, handleBranchTarget: branchTarget(nodeIndex) }
            placeholderNodes.push(ph, node)
          } else {
            const ph = nodesBuilder.placeholder({
              id: `placeholder_${node.id}_${uuidv4()}`,
              type: 'default',
              relatedNode: node,
              position: 'right',
              ...getPlaceholderPositionBasedOnNode(node, 'right'),
            })
            ph.data = { ...ph.data, handleBranchTarget: branchTarget(nodeIndex + 1) }
            placeholderNodes.push(node, ph)
          }
        } else {
          placeholderNodes.push(node)
        }
        return
      }

      const ctx = (node.data as BasicNodeData).branchContext!
      const branch = rung.handleBranches?.find((b) => b.blockId === ctx.blockId && b.handleId === ctx.handleId)
      // For copycat nodes, look up the original ID in nodeIds so the copycat
      // gets proper serial-spine placeholders during drag operations.
      const lookupId = node.id.startsWith('copycat_') ? node.id.slice(8) : node.id
      const nodeIndex = branch?.nodeIds.indexOf(lookupId) ?? -1

      // Parallel-path elements are not in nodeIds (indexOf returns -1).
      // Generate left/right placeholders (without handleBranchTarget) so users can
      // drag-drop in series with them. Also allow bottom placeholder for depth logic.
      if (nodeIndex === -1) {
        const ppPlaceholders = [
          nodesBuilder.placeholder({
            id: `placeholder_${node.id}_${uuidv4()}`,
            type: 'default',
            relatedNode: node,
            position: 'left',
            ...getPlaceholderPositionBasedOnNode(node, 'left'),
          }),
          nodesBuilder.placeholder({
            id: `placeholder_${node.id}_${uuidv4()}`,
            type: 'default',
            relatedNode: node,
            position: 'right',
            ...getPlaceholderPositionBasedOnNode(node, 'right'),
          }),
        ]

        if (allowsBottomPlaceholder(node)) {
          const bottomPlaceholder = nodesBuilder.placeholder({
            id: `parallelPlaceholder_${node.id}_${uuidv4()}`,
            type: 'parallel',
            relatedNode: node,
            position: 'bottom',
            ...getPlaceholderPositionBasedOnNode(node, 'bottom'),
          })
          placeholderNodes.push(ppPlaceholders[0], node, bottomPlaceholder, ppPlaceholders[1])
        } else {
          placeholderNodes.push(ppPlaceholders[0], node, ppPlaceholders[1])
        }
        return
      }

      const branchTarget = (insertIndex: number) => ({
        blockId: ctx.blockId,
        handleId: ctx.handleId,
        direction: ctx.direction,
        handlePosition: { x: 0, y: 0 },
        insertIndex,
      })

      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'left',
          ...getPlaceholderPositionBasedOnNode(node, 'left'),
        }),
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'right',
          ...getPlaceholderPositionBasedOnNode(node, 'right'),
        }),
      ]

      placeholders[0].data = { ...placeholders[0].data, handleBranchTarget: branchTarget(nodeIndex) }
      placeholders[1].data = { ...placeholders[1].data, handleBranchTarget: branchTarget(nodeIndex + 1) }

      if (allowsBottomPlaceholder(node)) {
        placeholders.push(
          nodesBuilder.placeholder({
            id: `parallelPlaceholder_${node.id}_${uuidv4()}`,
            type: 'parallel',
            relatedNode: node,
            position: 'bottom',
            ...getPlaceholderPositionBasedOnNode(node, 'bottom'),
          }),
        )
        placeholderNodes.push(placeholders[0], node, placeholders[2], placeholders[1])
      } else {
        placeholderNodes.push(placeholders[0], node, placeholders[1])
      }
      return
    }

    if (node.id.startsWith('left-rail')) {
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'right',
          ...getPlaceholderPositionBasedOnNode(node, 'right'),
        }),
      ]
      placeholderNodes.push(node, placeholders[0])
      return
    }

    if (node.id.startsWith('right-rail')) {
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'left',
          ...getPlaceholderPositionBasedOnNode(node, 'left'),
        }),
      ]
      placeholderNodes.push(placeholders[0], node)
      return
    }

    if (node.type === 'parallel') {
      if (node.data.type === 'open') {
        placeholders = [
          nodesBuilder.placeholder({
            id: `placeholder_${node.id}_${uuidv4()}`,
            type: 'default',
            relatedNode: node,
            position: 'left',
            ...getPlaceholderPositionBasedOnNode(node, 'left'),
          }),
        ]
        placeholderNodes.push(placeholders[0], node)
        return
      }
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'right',
          ...getPlaceholderPositionBasedOnNode(node, 'right'),
        }),
      ]
      placeholderNodes.push(node, placeholders[0])

      return
    }

    placeholders = [
      nodesBuilder.placeholder({
        id: `placeholder_${node.id}_${uuidv4()}`,
        type: 'default',
        relatedNode: node,
        position: 'left',
        ...getPlaceholderPositionBasedOnNode(node, 'left'),
      }),
      nodesBuilder.placeholder({
        id: `placeholder_${node.id}_${uuidv4()}`,
        type: 'default',
        relatedNode: node,
        position: 'right',
        ...getPlaceholderPositionBasedOnNode(node, 'right'),
      }),
    ]

    if (allowsBottomPlaceholder(node)) {
      placeholders.push(
        nodesBuilder.placeholder({
          id: `parallelPlaceholder_${node.id}_${uuidv4()}`,
          type: 'parallel',
          relatedNode: node,
          position: 'bottom',
          ...getPlaceholderPositionBasedOnNode(node, 'bottom'),
        }),
      )
      placeholderNodes.push(placeholders[0], node, placeholders[2], placeholders[1])
      return placeholderNodes
    }

    placeholderNodes.push(placeholders[0], node, placeholders[1])
  })

  // Generate handle placeholders for block input handles (BOOL-type, index > 0, no existing branch).
  // Note: this runs during onDragEnterViewport, after updateDiagramElementsPosition has positioned
  // all nodes, so handle.glbPosition values are current.
  const pStyle = defaultCustomNodesStyles.placeholder
  nodes.forEach((node) => {
    if (node.type !== 'block') return

    const blockData = node.data as BasicNodeData & { variant: BlockVariant }
    const inputHandles = blockData.inputHandles

    // Skip index 0 (rail connector), iterate remaining input handles
    for (let i = 1; i < inputHandles.length; i++) {
      const handle = inputHandles[i]
      const handleId = handle.id as string

      // Find the variable type for this handle from the block variant
      const variableType = blockData.variant?.variables?.find((v) => v.name === handleId)
      if (!variableType) continue

      // Only generate for BOOL-compatible handles without existing branches
      if (!canPlaceElementOnHandle(variableType)) continue
      if (hasBranchOnHandle(rung, node.id, handleId)) continue

      const placeholder = nodesBuilder.placeholder({
        id: `placeholder_handle_${node.id}_${handleId}`,
        type: 'default',
        relatedNode: node,
        position: 'left',
        posX: node.position.x - pStyle.gap - pStyle.width / 2,
        posY: handle.glbPosition.y - pStyle.handle.y,
        handleX: node.position.x - pStyle.gap - pStyle.width / 2,
        handleY: handle.glbPosition.y,
      })

      // Add branch target data to distinguish from regular placeholders
      placeholder.data = {
        ...placeholder.data,
        handleBranchTarget: {
          blockId: node.id,
          handleId,
          direction: 'input' as const,
          handlePosition: { x: handle.glbPosition.x, y: handle.glbPosition.y },
        },
      }

      placeholderNodes.push(placeholder)
    }

    // Generate handle placeholders for block output handles (BOOL-type, index > 0, no existing branch).
    const outputHandles = blockData.outputHandles
    for (let i = 1; i < outputHandles.length; i++) {
      const handle = outputHandles[i]
      const handleId = handle.id as string

      const variableType = blockData.variant?.variables?.find((v) => v.name === handleId)
      if (!variableType) continue

      if (!canPlaceElementOnHandle(variableType)) continue
      if (hasBranchOnHandle(rung, node.id, handleId)) continue

      const placeholder = nodesBuilder.placeholder({
        id: `placeholder_handle_${node.id}_${handleId}`,
        type: 'default',
        relatedNode: node,
        position: 'right',
        posX: node.position.x + (defaultCustomNodesStyles.block?.width ?? 80) + pStyle.gap + pStyle.width / 2,
        posY: handle.glbPosition.y - pStyle.handle.y,
        handleX: node.position.x + (defaultCustomNodesStyles.block?.width ?? 80) + pStyle.gap + pStyle.width / 2,
        handleY: handle.glbPosition.y,
      })

      placeholder.data = {
        ...placeholder.data,
        handleBranchTarget: {
          blockId: node.id,
          handleId,
          direction: 'output' as const,
          handlePosition: { x: handle.glbPosition.x, y: handle.glbPosition.y },
        },
      }

      placeholderNodes.push(placeholder)
    }
  })

  return placeholderNodes
}

/**
 * Search for the nearest placeholder node
 *
 * @param rung The current rung state
 * @param reactFlowInstance The react flow instance
 * @param position The position of the mouse
 *
 * @returns The nearest placeholder node
 */
export const searchNearestPlaceholder = (
  rung: RungLadderState,
  reactFlowInstance: ReactFlowInstance,
  position: { x: number; y: number },
) => {
  const placeholderNodes = rung.nodes.filter(
    (node) => node.type === 'placeholder' || node.type === 'parallelPlaceholder',
  )
  if (!placeholderNodes || placeholderNodes.length === 0) return

  const mousePosition = reactFlowInstance?.screenToFlowPosition({ x: position.x, y: position.y })
  if (!mousePosition) return

  const closestPlaceholder = placeholderNodes.reduce((prev, curr) => {
    const prevDistance = Math.hypot(prev.position.x - mousePosition.x, prev.position.y - mousePosition.y)
    const currDistance = Math.hypot(curr.position.x - mousePosition.x, curr.position.y - mousePosition.y)
    return prevDistance < currDistance ? prev : curr
  })
  if (!closestPlaceholder) return

  return closestPlaceholder
}
