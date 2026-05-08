import type { RungLadderState } from '@root/frontend/store/slices'
import { newGraphicalEditorNodeID } from '@root/frontend/utils/new-graphical-editor-node-id'
import type { Node, ReactFlowInstance } from '@xyflow/react'

import { nodesBuilder } from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import {
  renderHandleBranchCreationPlaceholders,
  renderInBranchParallelPathPlaceholders,
  renderInBranchParallelPlaceholders,
  renderInBranchSplicePlaceholders,
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

  nodes.forEach((node) => {
    let placeholders: Node[] = []

    // Branch elements (contacts / coils / parallels with branchContext) own
    // their own in-branch splice placeholders via
    // `renderInBranchSplicePlaceholders`. Emitting the regular main-rail
    // left / right / parallel placeholders for them would let the user drop
    // a main-rail-style parallel onto a branch — Phase 4 handles that case
    // explicitly via `startParallelInBranch`; until then, suppress.
    if (
      (node.type === 'contact' || node.type === 'coil' || node.type === 'parallel') &&
      node.data.branchContext
    ) {
      placeholderNodes.push(node)
      return
    }

    // Standalone branch rails belong to a handle branch — drops onto them go
    // through `renderHandleBranchCreationPlaceholders` /
    // `renderInBranchSplicePlaceholders`, not the regular rail placeholders.
    if (node.type === 'powerRail' && node.id.startsWith('branch-rail-')) {
      placeholderNodes.push(node)
      return
    }

    if (
      node.type === 'placeholder' ||
      node.type === 'parallelPlaceholder' ||
      node.type === 'variable' ||
      nodes.find((n) => n.id === `copycat_${node.id}`)
    ) {
      if (nodes.find((n) => n.id === `copycat_${node.id}`) || node.type === 'variable') placeholderNodes.push(node)
      return
    }

    if (node.id.startsWith('left-rail')) {
      placeholders = [
        nodesBuilder.placeholder({
          id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
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
          id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
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
            id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
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
          id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
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
        id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
        type: 'default',
        relatedNode: node,
        position: 'left',
        ...getPlaceholderPositionBasedOnNode(node, 'left'),
      }),
      nodesBuilder.placeholder({
        id: newGraphicalEditorNodeID(`placeholder_${node.id}`),
        type: 'default',
        relatedNode: node,
        position: 'right',
        ...getPlaceholderPositionBasedOnNode(node, 'right'),
      }),
    ]

    if (!nodesInsideParallels.includes(node) || deepestNodesParallels.includes(node)) {
      placeholders.push(
        nodesBuilder.placeholder({
          id: newGraphicalEditorNodeID(`parallelPlaceholder_${node.id}`),
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

  // Append handle-branch placeholders:
  //   - creation targets: one per BOOL block handle that currently hosts a
  //     Variable node and no branch yet.
  //   - splice targets: one per gap inside an existing branch's serial spine.
  //   - parallel targets: one bottom placeholder under each spine contact/
  //     coil so the user can drop a new element to create an in-branch
  //     parallel. Suppressed for spine elements already inside a parallel
  //     (no nested parallels in branches).
  return [
    ...placeholderNodes,
    ...renderHandleBranchCreationPlaceholders(rung),
    ...renderInBranchSplicePlaceholders(rung),
    ...renderInBranchParallelPlaceholders(rung),
    ...renderInBranchParallelPathPlaceholders(rung),
  ]
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
