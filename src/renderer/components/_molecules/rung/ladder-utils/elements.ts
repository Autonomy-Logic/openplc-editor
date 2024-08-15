import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { connectNodes, disconnectNodes } from './edges'
import { buildGenericNode, getNodeStyle } from './nodes'

const getPreviousElement = (nodes: Node[]) => {
  return nodes[nodes.length - 1]
}

const getPoisitionToNewElement = (prevEl: Node, newElType: string) => {
  const prevElOutputHandle = prevEl.data.outputConnector as CustomHandleProps
  const prevElStyle = getNodeStyle({ node: prevEl })
  const newNodeStyle = getNodeStyle({ nodeType: newElType })

  const gap = prevElStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const position = {
    posX: prevEl.position.x + prevElStyle.width + gap,
    posY: prevEl.type === newElType ? prevEl.position.y : prevElOutputHandle.glbPosition.y - offsetY,
    handleX: prevEl.position.x + prevElStyle.width + gap,
    handleY: prevElOutputHandle.glbPosition.y,
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

  rails[1] = changeRailBounds(rails[1], [rails[0], ...nodes, newEl], defaultViewportBounds)

  const prevElementData = prevElement.data as BasicNodeData
  const newEdges = connectNodes({ ...rung, nodes: [rails[0], ...nodes, newEl, rails[1]] }, prevElement.id, newEl.id, {
    sourceHandle: prevElementData.outputConnector?.id,
  })

  return {
    nodes: [rails[0], ...nodes, newEl, rails[1]],
    edges: newEdges,
  }
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

  return { nodes: rungState.nodes, edges: rungState.edges }
}
