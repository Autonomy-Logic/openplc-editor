// import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { buildEdge, connectNodes, disconnectNodes, disconnectParallel } from './edges'
import { buildGenericNode, getNodeStyle, isNodeOfType } from './nodes'

export const getPreviousElement = (nodes: Node[], nodeIndex?: number) => {
  return nodes[(nodeIndex ?? nodes.length - 1) - 1]
}

const getPoisitionBasedOnPreviousNode = (previousElement: Node, newElement: string | Node) => {
  const previousElementOutputHandle = previousElement.data.outputConnector as CustomHandleProps
  const previousElementStyle = getNodeStyle({ node: previousElement })
  const newNodeStyle = getNodeStyle(typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement })

  const gap = previousElementStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const position = {
    posX: previousElement.position.x + previousElementStyle.width + gap,
    posY:
    previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? previousElement.position.y
        : previousElementOutputHandle.glbPosition.y - offsetY,
    handleX: previousElement.position.x + previousElementStyle.width + gap,
    handleY: previousElementOutputHandle.glbPosition.y,
  }

  return position
}

const getPositionBasenOnPlaceholderNode = (
  placeholderNode: Node,
  newElType: string,
  type: 'serial' | 'parallel' = 'serial',
) => {
  const newNodeStyle = getNodeStyle({ nodeType: newElType })

  const placeholderHandles = placeholderNode.data.handles as CustomHandleProps[]
  const placeholderHandle = placeholderHandles[0]

  const verticalPadding = type === 'parallel' ? 50 : 0

  const position = {
    posX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    posY: placeholderHandle.glbPosition.y - newNodeStyle.handle.y + verticalPadding,
    handleX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    handleY: placeholderHandle.glbPosition.y + verticalPadding,
  }

  return position
}

export const changeRailBounds = (rightRail: Node, nodes: Node[], defaultBounds: [number, number]) => {
  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getNodeStyle({ node: rightRail })
  const nodesWithNoRail = nodes.filter((node) => node.id !== 'right-rail')

  const flowXBounds = nodesWithNoRail.reduce(
    (acc, node) => {
      const nodeStyle = getNodeStyle({ node })
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

const rearrangeNodes = (nodes: Node[], _defaultBounds: [number, number]) => {
  /**
   * TODO: implement the rearrange of parallel nodes
   */
  const newNodes: Node[] = []
  nodes.forEach((node, index) => {
    if (node.type === 'powerRail') {
      newNodes.push(node)
      return
    }
    const prevNode = getPreviousElement(newNodes, index)
    const newNodePosition = getPoisitionBasedOnPreviousNode(prevNode, node)
    const nodeData = node.data as BasicNodeData
    const newNodeHandlesPosition = nodeData.handles.map((handle) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y: handle.glbPosition.y,
        },
      }
    })
    newNodes.push({
      ...node,
      position: { x: newNodePosition.posX, y: newNodePosition.posY },
      data: {
        ...nodeData,
        handles: newNodeHandlesPosition,
      },
    })
  })

  newNodes[newNodes.length - 1] = changeRailBounds(newNodes[newNodes.length - 1], newNodes, _defaultBounds)
  return newNodes
}

export const addNewElement = (
  rung: FlowState,
  newElementType: string,
  defaultViewportBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  const [selectedPlaceholderIndex, selectedPlaceholder] =
    Object.entries(rung.nodes).find(
      (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
    ) ?? []
  if (!selectedPlaceholder || !selectedPlaceholderIndex) return { nodes: rung.nodes, edges: rung.edges }

  const newElPosition = getPositionBasenOnPlaceholderNode(selectedPlaceholder, newElementType)
  const newElement = buildGenericNode({
    nodeType: newElementType,
    id: `${newElementType.toUpperCase()}_${uuidv4()}`,
    ...newElPosition,
  })

  let newNodes = [...rung.nodes]
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, newElement)

  let newEdges = connectNodes(
    { ...rung, nodes: newNodes },
    getPreviousElement(
      newNodes,
      newNodes.findIndex((node) => node.id === newElement.id),
    ).id,
    newElement.id,
    'serial',
  )

  if (isNodeOfType(newElement, 'parallel')) {
    const openParallel = newElement as ParallelNode
    const closeParallelPosition = getPositionBasenOnPlaceholderNode(selectedPlaceholder, newElementType)
    const closeParallel = nodesBuilder.parallel({
      id: `${newElementType.toUpperCase()}_close_${uuidv4()}`,
      ...closeParallelPosition,
      type: 'close',
    })
    openParallel.data.parallelCloseReference = closeParallel.id
    closeParallel.data.parallelOpenReference = openParallel.id
    newNodes.splice(toInteger(selectedPlaceholderIndex) + 1, 0, closeParallel)
    newEdges = connectNodes(
      { ...rung, nodes: newNodes, edges: newEdges },
      getPreviousElement(
        newNodes,
        newNodes.findIndex((node) => node.id === closeParallel.id),
      ).id,
      closeParallel.id,
      'serial',
    )
    newEdges.push(
      buildEdge(openParallel.id, closeParallel.id, {
        sourceHandle: openParallel.data.parallelOutputConnector?.id,
        targetHandle: closeParallel.data.parallelInputConnector?.id,
      }),
    )
  }

  newNodes = removePlaceholderNodes(newNodes)
  newNodes = rearrangeNodes(newNodes, defaultViewportBounds)

  return { nodes: newNodes, edges: newEdges }
}

export const removeElement = (rung: FlowState, element: Node, defaultViewportBounds: [number, number]) => {
  const rails = rung.nodes.filter((node) => node.type === 'powerRail')
  const nodes = rung.nodes.filter((node) => node.type !== 'powerRail')

  if (element.type === 'parallel') {
    const { nodes: newNodes, edges: newEdges } = disconnectParallel(rung, element.id)
    return { nodes: newNodes, edges: newEdges }
  }

  const newNodes = nodes.filter((n) => n.id !== element.id)
  const newRails = changeRailBounds(rails[1], [rails[0], ...newNodes], defaultViewportBounds)

  const edge = rung.edges.find((edge) => edge.source === element.id)
  if (!edge) return { nodes: [rails[0], ...newNodes, newRails], edges: rung.edges }
  const newEdges = disconnectNodes(rung, edge.source, edge.target)

  return {
    nodes: [rails[0], ...newNodes, newRails],
    edges: newEdges,
  }
}

export const removeElements = (
  rungLocal: FlowState,
  nodes: Node[],
  defaultBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  if (!nodes) return { nodes: rungLocal.nodes, edges: rungLocal.edges }
  const rungState = rungLocal

  for (const node of nodes) {
    const { nodes: newNodes, edges: newEdges } = removeElement(rungState, node, defaultBounds)
    rungState.nodes = newNodes
    rungState.edges = newEdges
  }

  return { nodes: rungState.nodes, edges: rungState.edges }
}

export const renderPlaceholderNodes = (nodes: Node[]): Node[] => {
  const placeholderNodes: Node[] = []
  nodes.forEach((node) => {
    placeholderNodes.push(node)
    if (node.id === 'right-rail' || node.type === 'placeholder') return
    const placeholderPosition = getPoisitionBasedOnPreviousNode(node, 'placeholder')
    const placeholderStyle = getNodeStyle({ nodeType: 'placeholder' })
    const placeholder = buildGenericNode({
      nodeType: 'placeholder',
      id: `placeholder_${placeholderPosition.posX}_${placeholderPosition.posY}`,
      ...placeholderPosition,
      posX: placeholderPosition.posX - placeholderStyle.width / 2,
    })
    placeholderNodes.push(placeholder)
  })

  return placeholderNodes
}

export const removePlaceholderNodes = (nodes: Node[]): Node[] => {
  const nodesNoPlaceholder = nodes.filter((node) => node.type !== 'placeholder')
  return nodesNoPlaceholder
}
