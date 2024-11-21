import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { RungState } from '@root/renderer/store/slices'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import type { CustomHandleProps } from '../../../../_atoms/react-flow/custom-nodes/handle'
import { disconnectNodes } from '../edges'
import { getDefaultNodeStyle, isNodeOfType } from '../nodes'
import {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getDeepestNodesInsideParallels,
  getNodesInsideAllParallels,
  removeEmptyParallelConnections,
  startParallelConnectionByNodeType,
  startParallelConnectionKeepingTheNode,
} from './parallel'
import { appendSerialConnectionByNodeType, appendSerialConnectionKeepingTheNode } from './serial'
import {
  getNodePositionBasedOnPreviousNode,
  getPlaceholderPositionBasedOnNode,
  getPreviousElementsByEdges,
} from './utils'

/**
 * Change the right rail bounds based on the nodes position
 *
 * @param rightRail The right rail node
 * @param nodes The nodes in the rung
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new right rail node
 */
const changeRailBounds = (rightRail: Node, nodes: Node[], defaultBounds: [number, number]) => {
  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getDefaultNodeStyle({ node: rightRail })
  const nodesWithNoRail = nodes.filter((node) => node.id !== 'right-rail')

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
    return newRail
  }

  const newRail = {
    ...rightRail,
    position: { x: defaultBounds[0] - railStyle.width, y: rightRail.position.y },
    data: {
      ...rightRail.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - railStyle.width })),
    },
  }
  return newRail
}

/**
 * Update the position of the diagram elements
 *
 * @param rung The current rung state
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new nodes
 */
export const updateDiagramElementsPosition = (rung: RungState, defaultBounds: [number, number]) => {
  const { nodes } = rung
  const newNodes: Node[] = []

  const parallels = findParallelsInRung(rung)
  const parallelsDepth = parallels.map((parallel) => findAllParallelsDepthAndNodes(rung, parallel))

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === 'powerRail') {
      newNodes.push(node)
      continue
    }

    const { nodes: previousNodes, edges: previousEdges } = getPreviousElementsByEdges(
      { ...rung, nodes: newNodes },
      node,
    )
    if (!previousNodes || !previousEdges) return nodes

    let newNodePosition: { posX: number; posY: number; handleX: number; handleY: number } = {
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
    }

    if (previousNodes.length === 1) {
      /**
       * Nodes that only have one edge connecting to them
       */
      const previousNode = previousNodes[0]

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
       */
      const openParallel = newNodes.find((n) => n.id === (node as ParallelNode).data.parallelOpenReference) as Node
      const openParallelPosition = getNodePositionBasedOnPreviousNode(openParallel, node, 'serial')

      let acc = newNodePosition
      for (let j = 0; j < previousNodes.length; j++) {
        const previousNode = previousNodes[j]
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

    const nodeData = node.data as BasicNodeData
    const newNodeHandlesPosition = nodeData.handles.map((handle) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y: newNodePosition.handleY,
        },
      }
    })

    if (!isNodeOfType(node, 'parallel')) {
      const newNode: Node<BasicNodeData> = {
        ...node,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...nodeData,
          handles: newNodeHandlesPosition,
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

  newNodes[newNodes.length - 1] = changeRailBounds(newNodes[newNodes.length - 1], newNodes, defaultBounds)

  return newNodes
}

/**
 * Add a new element to the rung
 *
 * @param rung The current rung state
 * @param node The new element to be added
 *
 * @returns The new nodes and edges
 */
export const addNewElement = <T>(
  rung: RungState,
  node: { newElementType: string; blockType: T | undefined },
): { nodes: Node[]; edges: Edge[] } => {
  const [selectedPlaceholderIndex, selectedPlaceholder] =
    Object.entries(rung.nodes).find(
      (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
    ) ?? []
  if (!selectedPlaceholder || !selectedPlaceholderIndex)
    return { nodes: removePlaceholderNodes(rung.nodes), edges: rung.edges }

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnectionByNodeType(rung, node, {
      selectedPlaceholder,
      selectedPlaceholderIndex,
    })
    newEdges = parallelEdges
    newNodes = parallelNodes
  } else {
    const { nodes: serialNodes, edges: serialEdges } = appendSerialConnectionByNodeType(rung, node, {
      selectedPlaceholder,
      selectedPlaceholderIndex,
    })
    newEdges = serialEdges
    newNodes = serialNodes
  }

  newNodes = updateDiagramElementsPosition(
    { ...rung, nodes: newNodes, edges: newEdges },
    rung.defaultBounds as [number, number],
  )
  return { nodes: newNodes, edges: newEdges }
}

/**
 * Remove an element from the rung
 *
 * @param rung The current rung state
 * @param element The element to be removed
 *
 * @returns The new nodes and edges
 */
export const removeElement = (rung: RungState, element: Node) => {
  const rails = rung.nodes.filter((node) => node.type === 'powerRail')
  const nodes = rung.nodes.filter((node) => node.type !== 'powerRail')

  let newNodes = nodes.filter((n) => n.id !== element.id)
  const newRails = changeRailBounds(rails[1], [rails[0], ...newNodes], rung.defaultBounds as [number, number])

  newNodes = [rails[0], ...newNodes, newRails]

  const edge = rung.edges.find((edge) => edge.source === element.id)
  if (!edge) return { nodes: newNodes, edges: rung.edges }
  let newEdges = disconnectNodes(rung, edge.source, edge.target)

  const { nodes: auxNodes, edges: auxEdges } = removeEmptyParallelConnections({
    ...rung,
    nodes: newNodes,
    edges: newEdges,
  })
  newNodes = auxNodes
  newEdges = auxEdges

  newNodes = updateDiagramElementsPosition(
    { ...rung, nodes: newNodes, edges: newEdges },
    rung.defaultBounds as [number, number],
  )

  return {
    nodes: newNodes,
    edges: newEdges,
  }
}

/**
 * Remove multiple elements from the rung
 *
 * @param rungLocal The current rung state
 * @param nodes The elements to be removed
 *
 * @returns The new nodes and edges
 */
export const removeElements = (rungLocal: RungState, nodes: Node[]): { nodes: Node[]; edges: Edge[] } => {
  if (!nodes) return { nodes: rungLocal.nodes, edges: rungLocal.edges }
  const rungState = rungLocal

  for (const node of nodes) {
    const { nodes: newNodes, edges: newEdges } = removeElement(rungState, node)
    rungState.nodes = newNodes
    rungState.edges = newEdges
  }

  return { nodes: rungState.nodes, edges: rungState.edges }
}

/**
 * Render the placeholder nodes
 *
 * @param rung The current rung state
 *
 * @returns The placeholder nodes
 *
 * TODO: Refactor this function to make only one placeholder beetween nodes
 */
export const renderPlaceholderNodes = (rung: RungState): Node[] => {
  const { nodes } = rung
  const placeholderNodes: Node[] = []
  const nodesInsideParallels = getNodesInsideAllParallels(rung)
  const deepestNodesParallels = getDeepestNodesInsideParallels(rung)

  nodes.forEach((node) => {
    let placeholders: Node[] = []
    if (
      node.type === 'placeholder' ||
      node.type === 'parallelPlaceholder' ||
      nodes.find((n) => n.id === `copycat_${node.id}`)
    ) {
      if (nodes.find((n) => n.id === `copycat_${node.id}`)) placeholderNodes.push(node)
      return
    }

    if (node.id === 'left-rail') {
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

    if (node.id === 'right-rail') {
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

    if (!nodesInsideParallels.includes(node) || deepestNodesParallels.includes(node)) {
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
  return placeholderNodes
}

/**
 * Remove the placeholder nodes
 *
 * @param nodes The nodes to be removed
 *
 * @returns The nodes without the placeholder nodes
 */
export const removePlaceholderNodes = (nodes: Node[]): Node[] => {
  const nodesNoPlaceholder = nodes.filter((node) => node.type !== 'placeholder' && node.type !== 'parallelPlaceholder')
  return nodesNoPlaceholder
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
  rung: RungState,
  reactFlowInstance: ReactFlowInstance,
  position: { x: number; y: number },
) => {
  const placeholderNodes = rung.nodes.filter(
    (node) => node.type === 'placeholder' || node.type === 'parallelPlaceholder',
  )
  if (placeholderNodes.length === 0) return

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

/**
 * Drag and drop function to start the drag of an element
 *
 * @param rung The current rung state
 * @param node The node to be dragged
 *
 * @returns The new nodes and edges
 */
export const onDragStartElement = (rung: RungState, node: Node) => {
  if (!node.draggable) return rung

  // Set a new node at the correct place and disconnect the node from the previous one
  const copycatNode = { ...node, id: `copycat_${node.id}`, dragging: false }
  const nodeIndex = rung.nodes.findIndex((n) => n.id === node.id)
  let newNodes = [...rung.nodes]
  newNodes.splice(nodeIndex, 0, copycatNode)

  const newEdges = [...rung.edges]
  rung.edges.forEach((edge, index) => {
    if (edge.source === node.id) {
      newEdges[index] = { ...edge, source: copycatNode.id, id: `copycat_${edge.id}` }
    }
    if (edge.target === node.id) {
      newEdges[index] = { ...edge, target: copycatNode.id, id: `copycat_${edge.id}` }
    }
  })

  newNodes = renderPlaceholderNodes({ ...rung, nodes: newNodes, edges: newEdges })

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Drag and drop function to drag an element to a new position
 *
 * @param rung The current rung state
 * @param reactFlowInstance The react flow instance
 *
 * @returns The nearest placeholder node
 */
export const onDragElement = (
  rung: RungState,
  reactFlowInstance: ReactFlowInstance,
  position: { x: number; y: number },
) => {
  return searchNearestPlaceholder(rung, reactFlowInstance, position)
}

/**
 * Drag and drop function to stop the drag of an element and connect it to the nearest placeholder
 *
 * @param rung The current rung state
 * @param node The node to be connected
 *
 * @returns The new nodes and edges
 */
export const onDragStopElement = (rung: RungState, node: Node): { nodes: Node[]; edges: Edge[] } => {
  const [selectedPlaceholderIndex, selectedPlaceholder] =
    Object.entries(rung.nodes).find(
      (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
    ) ?? []
  if (!selectedPlaceholder || !selectedPlaceholderIndex)
    return { nodes: removePlaceholderNodes(rung.nodes), edges: rung.edges }

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  // Find copycat node
  const copycatNode = newNodes.find((n) => n.id === `copycat_${node.id}`)
  if (!copycatNode) return { nodes: newNodes, edges: newEdges }

  // Remove the old node block
  const oldNodeIndex = newNodes.findIndex((n) => n.id === node.id)
  newNodes = newNodes.filter((n) => n.id !== node.id)

  // Check if the selected placeholder is the same as the copycat node
  if ((selectedPlaceholder as PlaceholderNode).data.relatedNode?.id === copycatNode.id) {
    newNodes[newNodes.indexOf(copycatNode)] = {
      ...node,
      id: node.id,
      dragging: false,
    }
    newEdges.forEach((edge, index) => {
      if (edge.source === copycatNode.id) {
        newEdges[index] = { ...edge, source: node.id, id: edge.id.replace('copycat_', '') }
      }
      if (edge.target === copycatNode.id) {
        newEdges[index] = { ...edge, target: node.id, id: edge.id.replace('copycat_', '') }
      }
    })
    newNodes = removePlaceholderNodes(newNodes)

    newNodes = updateDiagramElementsPosition(
      { ...rung, nodes: newNodes, edges: newEdges },
      rung.defaultBounds as [number, number],
    )
    return { nodes: newNodes, edges: newEdges }
  }

  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnectionKeepingTheNode(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      node,
      {
        selectedPlaceholder,
        selectedPlaceholderIndex:
          oldNodeIndex < toInteger(selectedPlaceholderIndex)
            ? (toInteger(selectedPlaceholderIndex) - 1).toString()
            : selectedPlaceholderIndex,
      },
    )
    newEdges = parallelEdges
    newNodes = parallelNodes
  } else {
    const { nodes: serialNodes, edges: serialEdges } = appendSerialConnectionKeepingTheNode(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      node,
      {
        selectedPlaceholder,
        selectedPlaceholderIndex:
          oldNodeIndex < toInteger(selectedPlaceholderIndex)
            ? (toInteger(selectedPlaceholderIndex) - 1).toString()
            : selectedPlaceholderIndex,
      },
    )
    newEdges = serialEdges
    newNodes = serialNodes
  }

  // If the selected placeholder is not the same as the copycat node, remove the copycat node and the old one
  const { nodes: removedCopycatNodes, edges: removedCopycatEdges } = removeElement(
    { ...rung, nodes: newNodes, edges: newEdges },
    copycatNode,
  )
  newNodes = removedCopycatNodes
  newEdges = removedCopycatEdges

  return { nodes: newNodes, edges: newEdges }
}
