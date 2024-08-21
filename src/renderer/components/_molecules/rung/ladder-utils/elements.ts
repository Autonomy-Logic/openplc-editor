// import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { buildEdge, connectNodes, disconnectNodes, disconnectParallel } from './edges'
import { buildGenericNode, getNodeStyle } from './nodes'

const getPreviousElement = (nodes: Node[]) => {
  return nodes[nodes.length - 1]
}

const getPoisitionToNewElement = (prevEl: Node, newElType: string, type: 'serial' | 'parallel' = 'serial') => {
  const prevElOutputHandle = prevEl.data.outputConnector as CustomHandleProps
  const prevElStyle = getNodeStyle({ node: prevEl })
  const newNodeStyle = getNodeStyle({ nodeType: newElType })

  const gap = prevElStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const verticalGap = type === 'serial' ? 0 : newNodeStyle.gap

  const position = {
    posX: prevEl.position.x + prevElStyle.width + gap,
    posY: prevEl.type === newElType ? prevEl.position.y : prevElOutputHandle.glbPosition.y - offsetY + verticalGap,
    handleX: prevEl.position.x + prevElStyle.width + gap,
    handleY: prevElOutputHandle.glbPosition.y + verticalGap,
  }

  return position
}

export const changeRailBounds = (rightRail: Node, nodes: Node[], defaultBounds: [number, number]) => {
  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getNodeStyle({ node: rightRail })
  const lastNodeStyle = getNodeStyle({ node: nodes[nodes.length - 1] })

  const nodeBounds = getNodesBounds(nodes)

  if (nodeBounds.width > defaultBounds[0]) {
    const newRail = {
      ...rightRail,
      position: { x: nodeBounds.width + lastNodeStyle.gap, y: rightRail.position.y },
      data: {
        ...rightRail.data,
        handles: handles.map((handle) => ({ ...handle, x: nodeBounds.width + lastNodeStyle.gap })),
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



export const addNewElement = (
  rung: FlowState,
  newElementType: string,
  defaultViewportBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  const rails = rung.nodes.filter((node) => node.type === 'powerRail')
  const nodes = rung.nodes.filter((node) => node.type !== 'powerRail')

  const prevElement = getPreviousElement([rails[0], ...nodes])
  const newElPosition = getPoisitionToNewElement(prevElement, newElementType)
  const newEl = buildGenericNode({
    nodeType: newElementType,
    id: `${newElementType}_${newElPosition.posX}_${newElPosition.posY}`,
    ...newElPosition,
  })

  const newNodes = [...nodes, newEl]
  let newEdges = connectNodes({ ...rung, nodes: [rails[0], ...newNodes, rails[1]] }, prevElement.id, newEl.id)

  if (newElementType === 'parallel') {
    const openParallel = newEl as ParallelNode
    const closeParallelPosition = getPoisitionToNewElement(newEl, newElementType)
    const closeParallel = nodesBuilder.parallel({
      id: `${newElementType}_${closeParallelPosition.posX}_${closeParallelPosition.posY}`,
      ...closeParallelPosition,
      type: 'close',
    })
    openParallel.data.parallelCloseReference = closeParallel.id
    closeParallel.data.parallelOpenReference = openParallel.id
    newNodes.push(closeParallel)
    newEdges = connectNodes(
      { ...rung, edges: newEdges, nodes: [rails[0], ...newNodes, rails[1]] },
      newEl.id,
      closeParallel.id,
    )
    newEdges = [
      ...newEdges,
      buildEdge(newEl.id, closeParallel.id, {
        sourceHandle: openParallel.data.parallelOutputConnector?.id,
        targetHandle: closeParallel.data.parallelInputConnector?.id,
      }),
    ]
  }

  rails[1] = changeRailBounds(rails[1], [rails[0], ...newNodes], defaultViewportBounds)

  return {
    nodes: [rails[0], ...newNodes, rails[1]],
    edges: newEdges,
  }
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
  console.log('ADD PLACEHOLDER NODES')
  console.log('Nodes:', nodes)
  const placeholderNodes: Node[] = []
  nodes.forEach((node) => {
    placeholderNodes.push(node)

    if (node.id === 'right-rail' || node.type === 'placeholder') return
    const placeholderPosition = getPoisitionToNewElement(node, 'placeholder')
    const placeholder = buildGenericNode({
      nodeType: 'placeholder',
      id: `placeholder_${placeholderPosition.posX}_${placeholderPosition.posY}`,
      ...placeholderPosition,
    })
    placeholderNodes.push(placeholder)
  })

  console.log('Placeholder nodes:', placeholderNodes)

  return placeholderNodes
}

export const removePlaceholderNodes = (nodes: Node[]): Node[] => {
  console.log('REMOVE PLACEHOLDER NODES')
  console.log('Nodes:', nodes)
  const nodesNoPlaceholder = nodes.filter((node) => node.type !== 'placeholder')
  console.log('nodesNoPlaceholder:', nodesNoPlaceholder)
  return nodesNoPlaceholder
}
