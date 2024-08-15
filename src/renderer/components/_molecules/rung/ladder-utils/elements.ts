import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { connectNodes, disconnectNodes } from './edges'
import { buildGenericNode, getNodeStyle } from './nodes'

export const changePowerRailBounds = ({
  rung,
  nodes,
  gapNodes,
  defaultBounds,
}: {
  rung: FlowState
  nodes: Node[]
  gapNodes: number
  defaultBounds: [number, number]
}): Node | undefined => {
  const rightPowerRailNode = rung.nodes.find((node) => node.id === 'right-rail') as Node
  if (!rightPowerRailNode) return undefined

  const handles = rightPowerRailNode.data.handles as CustomHandleProps[]
  const nodeBounds = getNodesBounds(nodes)

  // If the width of the nodes is greater than the default bounds, update the right power rail node
  if (nodeBounds.width + gapNodes > defaultBounds[0]) {
    const newRail = {
      ...rightPowerRailNode,
      position: { x: nodeBounds.width + gapNodes, y: rightPowerRailNode.position.y },
      data: {
        ...rightPowerRailNode.data,
        handles: handles.map((handle) => ({ ...handle, x: nodeBounds.width + gapNodes })),
      },
    }
    return newRail
  }

  // If the width of the nodes is less than the default bounds, update the right power rail node to the default bounds
  const newRail = {
    ...rightPowerRailNode,
    position: { x: defaultBounds[0] - (rightPowerRailNode.width ?? 0), y: rightPowerRailNode.position.y },
    data: {
      ...rightPowerRailNode.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - (rightPowerRailNode.width ?? 0) })),
    },
  }

  return newRail
}

export const addNewNode = ({
  rungLocal,
  newNodeType,
  defaultBounds,
}: {
  rungLocal: FlowState
  newNodeType: string
  defaultBounds: [number, number]
}): { nodes: Node[]; edges: Edge[] } => {
  const leftPowerRailNode = rungLocal.nodes.find((node) => node.id === 'left-rail') as Node
  let rightPowerRailNode = rungLocal.nodes.find((node) => node.id === 'right-rail') as Node
  const nodes = rungLocal.nodes.filter((node) => node.id !== 'left-rail' && node.id !== 'right-rail')

  const lastNode = nodes[nodes.length - 1] ?? leftPowerRailNode
  const lastNodeData = lastNode.data as BasicNodeData
  const sourceLastNodeHandle = lastNodeData.handles.find((handle) => handle.type === 'source')

  const lastNodeStyle = getNodeStyle({ node: lastNode })
  const newNodeStyle = getNodeStyle({ nodeType: newNodeType }) ?? getNodeStyle({ nodeType: 'mockNode' })
  const gap = lastNodeStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const posX = lastNode.position.x + (lastNode.width ?? 0) + gap
  const posY =
    lastNode.type === newNodeType ? lastNode.position.y : (sourceLastNodeHandle?.glbPosition.y ?? offsetY) - offsetY
  const handleX = lastNode.position.x + (lastNode.width ?? 0) + gap
  const handleY = sourceLastNodeHandle?.glbPosition.y ?? 0

  const newNode = buildGenericNode({
    nodeType: newNodeType,
    id: `${newNodeType}_${posX}_${posY}`,
    posX,
    posY,
    handleX,
    handleY,
  })
  const newNodeData = newNode.data as BasicNodeData

  const newRightPowerRail = changePowerRailBounds({
    rung: rungLocal,
    nodes: [leftPowerRailNode, ...nodes, newNode],
    gapNodes: newNodeStyle.gap,
    defaultBounds: defaultBounds,
  })
  if (newRightPowerRail) rightPowerRailNode = newRightPowerRail

  let newEdge = rungLocal.edges
  newEdge = connectNodes(
    {
      ...rungLocal,
      nodes: [leftPowerRailNode, ...nodes, newNode, rightPowerRailNode],
      edges: newEdge,
    },
    lastNode.id,
    newNode.id,
    { sourceHandle: sourceLastNodeHandle?.id, targetHandle: newNodeData.inputConnector?.id },
  )

  return {
    nodes: [leftPowerRailNode, ...nodes, newNode, rightPowerRailNode],
    edges: newEdge,
  }
}

const removeNode = ({
  rungLocal,
  defaultBounds,
  node,
}: {
  rungLocal: FlowState
  defaultBounds: [number, number]
  node: Node
}): { nodes: Node[]; edges: Edge[] } => {
  if (!node) return { nodes: rungLocal.nodes, edges: rungLocal.edges }

  const leftPowerRailNode = rungLocal.nodes.find((node) => node.id === 'left-rail') as Node
  let rightPowerRailNode = rungLocal.nodes.find((node) => node.id === 'right-rail') as Node
  const nodes = rungLocal.nodes.filter((node) => node.id !== 'left-rail' && node.id !== 'right-rail')

  const newNodes = nodes.filter((n) => n.id !== node.id)
  const removedNoveStyle = getNodeStyle({ node: node })

  const newRightPowerRail = changePowerRailBounds({
    rung: rungLocal,
    nodes: [leftPowerRailNode, ...newNodes],
    gapNodes: removedNoveStyle.gap,
    defaultBounds: defaultBounds,
  })
  if (newRightPowerRail) rightPowerRailNode = newRightPowerRail

  const edge = rungLocal.edges.find((edge) => edge.source === node.id)
  const newEdges = disconnectNodes(rungLocal, edge?.source ?? '', edge?.target ?? '')

  return {
    nodes: [leftPowerRailNode, ...newNodes, rightPowerRailNode],
    edges: newEdges,
  }
}

export const removeNodes = ({
  rungLocal,
  defaultBounds,
  nodes,
}: {
  rungLocal: FlowState
  defaultBounds: [number, number]
  nodes: Node[]
}): { nodes: Node[]; edges: Edge[] } => {
  if (!nodes) return { nodes: rungLocal.nodes, edges: rungLocal.edges }
  const rungState = rungLocal

  for (const node of nodes) {
    const { nodes: newNodes, edges: newEdges } = removeNode({ rungLocal: rungState, defaultBounds, node })
    rungState.nodes = newNodes
    rungState.edges = newEdges
  }

  return { nodes: rungState.nodes, edges: rungState.edges }
}
