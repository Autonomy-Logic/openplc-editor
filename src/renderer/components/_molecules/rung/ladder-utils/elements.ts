import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { buildEdge, connectNodes, disconnectNodes, removeEdge } from './edges'
import { buildGenericNode, getNodeStyle, isNodeOfType, removeNode } from './nodes'

export const getPreviousElement = (nodes: Node[], nodeIndex?: number) => {
  return nodes[(nodeIndex ?? nodes.length - 1) - 1]
}

export const getPreviousElementsByEdges = (
  rung: FlowState,
  node: Node,
): { nodes: Node[] | undefined; edges: Edge[] | undefined } => {
  const edges = rung.edges.filter((edge) => edge.target === node.id)
  if (!edges) return { nodes: undefined, edges: undefined }
  const previousNodes = rung.nodes.filter((n) => edges.map((edge) => edge.source).includes(n.id))
  if (!previousNodes) return { nodes: undefined, edges: edges }
  return { nodes: previousNodes, edges: edges }
}

const getPositionBasedOnPreviousNode = (
  previousElement: Node,
  newElement: string | Node,
  type: 'serial' | 'parallel',
) => {
  const previousElementOutputHandle = previousElement.data.outputConnector as CustomHandleProps
  const previousElementStyle = getNodeStyle({ node: previousElement })
  const newNodeStyle = getNodeStyle(typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement })

  const gap = previousElementStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const verticalPadding = type === 'parallel' ? 100 : 0

  const position = {
    posX: previousElement.position.x + previousElementStyle.width + gap,
    posY:
      previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? type === 'serial'
          ? previousElement.position.y
          : previousElement.position.y + verticalPadding
        : previousElementOutputHandle.glbPosition.y - offsetY + verticalPadding,
    handleX: previousElement.position.x + previousElementStyle.width + gap,
    handleY: previousElementOutputHandle.glbPosition.y + verticalPadding,
  }

  return position
}

const getPositionBasedOnPlaceholderNode = (
  placeholderNode: Node,
  newElType: string,
  type: 'serial' | 'parallel' = 'serial',
) => {
  const newNodeStyle = getNodeStyle({ nodeType: newElType })

  const placeholderHandles = placeholderNode.data.handles as CustomHandleProps[]
  const placeholderHandle = placeholderHandles[0]

  const verticalPadding = type === 'parallel' ? 100 : 0

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

const removeEmptyParallelConnections = (rung: FlowState) => {
  const { nodes, edges } = rung

  let newNodes = [...nodes]
  let newEdges = [...edges]
  nodes.forEach((node) => {
    if (node.type === 'parallel') {
      const parallelNode = node as ParallelNode
      // check if it is an open parallel
      if (parallelNode.data.type === 'close') {
        const closeParallel = parallelNode
        const openParallel = newNodes.find((n) => n.id === closeParallel.data.parallelOpenReference) as ParallelNode

        const parallelEdge = newEdges.find(
          (edge) =>
            edge.source === openParallel.id && edge.sourceHandle === openParallel.data.parallelOutputConnector?.id,
        )
        if (parallelEdge && parallelEdge.source === openParallel.id && parallelEdge.target === closeParallel.id) {
          newEdges = removeEdge(newEdges, parallelEdge.id)

          const openParallelTarget = newEdges.find((edge) => edge.target === openParallel.id)
          const openParallelSource = newEdges.find((edge) => edge.source === openParallel.id)
          const closeParallelTarget = newEdges.find((edge) => edge.target === closeParallel.id)
          const closeParallelSource = newEdges.find((edge) => edge.source === closeParallel.id)

          if (!openParallelTarget || !openParallelSource || !closeParallelSource || !closeParallelTarget) return

          /**
           * Serial connection between the openParallel and closeParallel
           */
          if (openParallelSource.id === closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, closeParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }
          /**
           * If have other nodes inside the serial connection
           */
          if (openParallelSource.id !== closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges = removeEdge(newEdges, closeParallelTarget.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, openParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: openParallelSource.targetHandle ?? undefined,
              }),
            )
            newEdges.push(
              buildEdge(closeParallelTarget.source, closeParallelSource.target, {
                sourceHandle: closeParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }

          newEdges = removeEdge(newEdges, openParallelTarget.id)
          newEdges = removeEdge(newEdges, closeParallelSource.id)

          newNodes = removeNode({ ...rung, nodes: newNodes }, closeParallel.id)
          newNodes = removeNode({ ...rung, nodes: newNodes }, openParallel.id)
        }
      }
    }
  })
  return { nodes: newNodes, edges: newEdges }
}

const rearrangeNodes = (rung: FlowState, _defaultBounds: [number, number]) => {
  const { nodes } = rung
  const newNodes: Node[] = []

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
        newNodePosition = getPositionBasedOnPreviousNode(previousNode, node, 'parallel')
      } else {
        newNodePosition = getPositionBasedOnPreviousNode(previousNode, node, 'serial')
      }
    } else {
      /**
       * Nodes that have multiple edges connecting to them
       */
      const openParallel = newNodes.find((n) => n.id === (node as ParallelNode).data.parallelOpenReference) as Node
      const openParallelPosition = getPositionBasedOnPreviousNode(openParallel, node, 'serial')

      let acc = newNodePosition
      for (let j = 0; j < previousNodes.length; j++) {
        const previousNode = previousNodes[j]
        const position = getPositionBasedOnPreviousNode(previousNode, node, 'serial')
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
  }

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

  const newElPosition = getPositionBasedOnPlaceholderNode(selectedPlaceholder, newElementType)
  const newElement = buildGenericNode({
    nodeType: newElementType,
    id: `${newElementType.toUpperCase()}_${uuidv4()}`,
    ...newElPosition,
  })

  let newNodes = [...rung.nodes]
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, newElement)

  let newEdges = [...rung.edges]
  if (selectedPlaceholder.type === 'parallelPlaceholder') {
    const parallelPlaceholder = selectedPlaceholder as PlaceholderNode
    const sourceEdge = newEdges.find((edge) => edge.source === parallelPlaceholder.id)
    const targetEdge = newEdges.find((edge) => edge.target === parallelPlaceholder.id)
    if (!sourceEdge || !targetEdge) return { nodes: rung.nodes, edges: rung.edges }
    newEdges = removeEdge(newEdges, newEdges.find((edge) => edge.id === sourceEdge.id)?.id ?? '')
    newEdges = removeEdge(newEdges, newEdges.find((edge) => edge.id === targetEdge.id)?.id ?? '')
    newEdges = connectNodes(
      { ...rung, nodes: newNodes, edges: newEdges },
      targetEdge.source,
      sourceEdge.target,
      'parallel',
      {
        sourceHandle: targetEdge.sourceHandle ?? '',
        targetHandle: sourceEdge.targetHandle ?? '',
      },
    )
    newEdges = connectNodes({ ...rung, nodes: newNodes, edges: newEdges }, targetEdge.source, newElement.id, 'parallel')
  } else {
    newEdges = connectNodes(
      { ...rung, nodes: newNodes },
      getPreviousElement(
        newNodes,
        newNodes.findIndex((node) => node.id === newElement.id),
      ).id,
      newElement.id,
      'serial',
    )
  }

  if (isNodeOfType(newElement, 'parallel')) {
    const openParallel = newElement as ParallelNode

    const parallelPlaceholderPosition = getPositionBasedOnPreviousNode(openParallel, 'parallelPlaceholder', 'parallel')
    const parallelPlaceholder = buildGenericNode({
      nodeType: 'parallelPlaceholder',
      id: `parallelPlaceholder_${parallelPlaceholderPosition.posX}_${parallelPlaceholderPosition.posY}`,
      ...parallelPlaceholderPosition,
    })

    const closeParallelPosition = getPositionBasedOnPreviousNode(openParallel, 'parallel', 'serial')
    const { posX: closePositionX } = getPositionBasedOnPreviousNode(parallelPlaceholder, 'parallel', 'serial')
    const closeParallel = nodesBuilder.parallel({
      id: `${newElementType.toUpperCase()}_close_${uuidv4()}`,
      ...closeParallelPosition,
      type: 'close',
      posX: closePositionX,
      handleX: closePositionX,
    })
    openParallel.data.parallelCloseReference = closeParallel.id
    closeParallel.data.parallelOpenReference = openParallel.id

    newNodes.splice(toInteger(selectedPlaceholderIndex) + 1, 0, parallelPlaceholder, closeParallel)
    newEdges = connectNodes({ ...rung, nodes: newNodes, edges: newEdges }, openParallel.id, closeParallel.id, 'serial')
    newEdges = connectNodes(
      { ...rung, nodes: newNodes, edges: newEdges },
      openParallel.id,
      closeParallel.id,
      'parallel',
      {
        sourceHandle: openParallel.data.parallelOutputConnector?.id,
        targetHandle: closeParallel.data.parallelInputConnector?.id,
      },
    )
    newEdges = connectNodes(
      { ...rung, nodes: newNodes, edges: newEdges },
      openParallel.id,
      parallelPlaceholder.id,
      'parallel',
    )
  }

  newNodes = removePlaceholderNodes(newNodes)
  newNodes = rearrangeNodes({ ...rung, nodes: newNodes, edges: newEdges }, defaultViewportBounds)

  console.log('newNodes', newNodes)
  console.log('newEdges', newEdges)

  return { nodes: newNodes, edges: newEdges }
}

export const removeElement = (rung: FlowState, element: Node, defaultViewportBounds: [number, number]) => {
  const rails = rung.nodes.filter((node) => node.type === 'powerRail')
  const nodes = rung.nodes.filter((node) => node.type !== 'powerRail')

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

  const { nodes: newNodes, edges: newEdges } = removeEmptyParallelConnections(rungState)
  rungState.nodes = newNodes
  rungState.edges = newEdges

  rungState.nodes = rearrangeNodes(rungState, defaultBounds)

  return { nodes: rungState.nodes, edges: rungState.edges }
}

export const renderPlaceholderNodes = (nodes: Node[]): Node[] => {
  const placeholderNodes: Node[] = []
  nodes.forEach((node) => {
    placeholderNodes.push(node)
    if (node.id === 'right-rail' || node.type === 'parallelPlaceholder') return
    const placeholderPosition = getPositionBasedOnPreviousNode(node, 'placeholder', 'serial')
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
