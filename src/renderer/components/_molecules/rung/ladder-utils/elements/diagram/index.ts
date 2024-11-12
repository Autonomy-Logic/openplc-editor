import { defaultCustomNodesStyles } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import type { CustomHandleProps } from '@root/renderer/components/_atoms/react-flow/custom-nodes/handle'
import type { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
// import type { VariableNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/variable'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'

import { getDefaultNodeStyle, isNodeOfType } from '../../nodes'
import {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getNodePositionBasedOnPreviousNode,
  getPreviousElementsByEdge,
} from '../utils'

/**
 * Change the right rail bounds based on the nodes position
 *
 * @param rightRail The right rail node
 * @param nodes The nodes in the rung
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new right rail node
 */
export const changeRailBounds = (rung: RungState, defaultBounds: [number, number]): { nodes: Node[] } => {
  const rightRail = rung.nodes.find((node) => node.id === 'right-rail')
  if (!rightRail) return { nodes: rung.nodes }

  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getDefaultNodeStyle({ node: rightRail })
  const nodesWithNoRail = rung.nodes.filter((node) => node.id !== 'right-rail')

  const flowXBounds = nodesWithNoRail.reduce(
    (acc, node) => {
      const nodeStyle = getDefaultNodeStyle({ node })
      return {
        minX: Math.min(acc.minX, node.position.x),
        maxX: Math.max(acc.maxX, node.position.x + nodeStyle.width + 2 * nodeStyle.gap + railStyle.gap),
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
 * Update the position of the diagram elements
 *
 * @param rung The current rung state
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new nodes
 */
export const updateDiagramElementsPosition = (
  rung: RungState,
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

  const { nodes: changedRailNodes } = changeRailBounds(
    {
      ...rung,
      nodes: newNodes,
    },
    defaultBounds,
  )

  return { nodes: changedRailNodes, edges: rung.edges }
}
