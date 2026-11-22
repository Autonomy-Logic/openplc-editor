import type { RungLadderState } from '@root/frontend/store/slices'
import { findParallelsInRung, getNodesInsideParallel } from '@root/middleware/shared/utils/ladder-layout'
import type { Node } from '@xyflow/react'

import type { CustomHandleProps } from '../../../../../../../_atoms/graphical-editor/ladder/handle'
import { BasicNodeData, ParallelNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { getDefaultNodeStyle } from '../../nodes'

export {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getNodePositionBasedOnPreviousNode,
  getNodesInsideParallel,
  getPreviousElementsByEdge,
} from '@root/middleware/shared/utils/ladder-layout'

/**
 * Get the previous main-line element when adding a new serial element.
 *
 * Walks the rung's node list skipping placeholders, variables and branch
 * elements, then returns the element immediately before the just-inserted one.
 *
 * Branch elements (contacts/coils wired to a block's secondary handles, e.g. a
 * contact on a counter's R input) are interleaved in the node array between the
 * block and the right rail, but they are NOT part of the serial spine. A plain
 * index walk that included them would treat such a branch element as the serial
 * predecessor of a main-line element — so a coil added to a block's primary
 * output (whose placeholder sits after the branch element in the array) would be
 * wired into the branch edge instead, dropping the coil and breaking the branch.
 * Skipping branchContext nodes here mirrors getPreviousElementsByEdge. Keying off
 * the element id (rather than an externally-computed index) keeps the lookup
 * consistent with this filtered spine.
 *
 * @param rung: RungLadderState
 * @param newElementId: string
 *
 * @returns Node
 */
export const getPreviousElement = (rung: RungLadderState, newElementId: string): Node => {
  const serialSpine = rung.nodes.filter(
    (n) =>
      n.type !== 'placeholder' &&
      n.type !== 'parallelPlaceholder' &&
      n.type !== 'variable' &&
      !(n.data as BasicNodeData).branchContext,
  )
  return serialSpine[serialSpine.findIndex((n) => n.id === newElementId) - 1]
}

/**
 * Get the node position based on the placeholder node
 *
 * @param placeholderNode
 * @param newElement
 *
 * @returns obj: { posX, posY, handleX, handleY }
 */
export const getElementPositionBasedOnPlaceholderElement = (
  placeholderNode: Node,
  newElement: Node | string,
): {
  posX: number
  posY: number
  handleX: number
  handleY: number
} => {
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const placeholderHandles = placeholderNode.data.handles as CustomHandleProps[]
  const placeholderHandle = placeholderHandles[0]

  const position = {
    posX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    posY: placeholderHandle.glbPosition.y - newNodeStyle.handle.y,
    handleX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    handleY: placeholderHandle.glbPosition.y,
  }

  return position
}

/**
 * ========================
 * Parallel Utils Functions
 * ========================
 */

/**
 * Find the deepest parallel inside a parallel connection
 *
 * @param rung
 * @param parallel - The parallel node
 *
 * @returns ParallelNode
 */
export const findDeepestParallelInsideParallel = (rung: RungLadderState, parallel: Node): ParallelNode => {
  const parallelIndex = rung.nodes.findIndex((node) => node.id === parallel.id)
  for (let i = parallelIndex; i < rung.nodes.length; i++) {
    const node = rung.nodes[i]
    if (node.type === 'parallel' && (node as ParallelNode).data.type === 'close') {
      return node as ParallelNode
    }
  }
  return parallel as ParallelNode
}

/**
 * Get the deepest nodes inside all parallels
 *
 * @param rung
 *
 * @returns Node[]
 */
export const getDeepestNodesInsideParallels = (rung: RungLadderState): Node[] => {
  const parallels = findParallelsInRung(rung)
  const nodes: Node[] = []
  parallels.forEach((parallel) => {
    const deepestParallel = findDeepestParallelInsideParallel(rung, parallel)
    const { parallel: parallelNodes } = getNodesInsideParallel(rung, deepestParallel)
    nodes.push(...parallelNodes)
  })
  return nodes
}

/**
 * Get all nodes inside all parallels
 *
 * @param rung
 *
 * @returns Node[]
 */
export const getNodesInsideAllParallels = (rung: RungLadderState): Node[] => {
  const closeParallels = rung.nodes.filter(
    (node) => node.type === 'parallel' && (node as ParallelNode).data.type === 'close',
  )
  const nodes: Node[] = []
  closeParallels.forEach((closeParallel) => {
    const { serial, parallel: parallelNodes } = getNodesInsideParallel(rung, closeParallel)
    nodes.push(...serial, ...parallelNodes)
  })
  return nodes
}

/**
 * ========================
 * Placeholder Utils Functions
 * ========================
 */

/**
 * Get the placeholder position based on the node
 *
 * @param node
 * @param side: 'left' | 'bottom' | 'right'
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getPlaceholderPositionBasedOnNode = (node: Node, side: 'left' | 'bottom' | 'right') => {
  switch (side) {
    case 'left':
      return {
        posX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY: ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'right':
      return {
        posX:
          node.position.x +
          (node.width || 0) +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x +
          (node.width || 0) +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width,
        handleY: ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'bottom':
      return {
        posX: node.position.x + (node.width || 0) / 2 - getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          node.position.y +
          (node.height || 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
        handleX: node.position.x + (node.width || 0) / 2 - getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY:
          node.position.y +
          (node.height || 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
      }
  }
}
