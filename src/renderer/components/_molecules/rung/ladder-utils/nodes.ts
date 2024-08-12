import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import { customNodesStyles, nodesBuilder } from '../../../_atoms/react-flow/custom-nodes'
import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { connectNodes, disconnectNodes } from './edges'

export const getNodeStyle = ({ node, nodeType }: { node?: Node; nodeType?: string }) => {
  return customNodesStyles[node?.type ?? nodeType ?? 'mockNode']
}

export const nodeBuild = ({
  nodeType,
  id,
  posX,
  posY,
  handleX,
  handleY,
}: {
  nodeType: string
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        posX,
        posY,
        handleX,
        handleY,
      })
    case 'coil':
      return nodesBuilder.coil({
        id,
        posX,
        posY,
        handleX,
        handleY,
      })
    case 'contact':
      return nodesBuilder.contact({
        id,
        posX,
        posY,
        handleX,
        handleY,
      })
    default:
      // mock block
      return nodesBuilder.mockNode({
        id,
        label: id,
        posX,
        posY,
        handleX,
        handleY,
      })
  }
}

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
  const lastNodeHandles = lastNode.data.handles as CustomHandleProps[]
  const sourceLastNodeHandle = lastNodeHandles.find((handle) => handle.type === 'source')

  const lastNodeStyle = getNodeStyle({ node: lastNode })
  const newNodeStyle = getNodeStyle({ nodeType: newNodeType })
  const gapBetweenNodes = lastNodeStyle.gapBetweenNodes + newNodeStyle.gapBetweenNodes
  const offsetY = newNodeStyle.handle.y

  const posX = lastNode.position.x + (lastNode.width ?? 0) + gapBetweenNodes
  const posY =
    lastNode.type === newNodeType ? lastNode.position.y : (sourceLastNodeHandle?.glbPosition.y ?? offsetY) - offsetY
  const handleX = lastNode.position.x + (lastNode.width ?? 0) + gapBetweenNodes
  const handleY = sourceLastNodeHandle?.glbPosition.y ?? 0

  const newNode = nodeBuild({
    nodeType: newNodeType,
    id: `${newNodeType}_${posX}_${posY}`,
    posX,
    posY,
    handleX,
    handleY,
  })

  const newRightPowerRail = changePowerRailBounds({
    rung: rungLocal,
    nodes: [leftPowerRailNode, ...nodes, newNode],
    gapNodes: newNodeStyle.gapBetweenNodes,
    defaultBounds: defaultBounds,
  })
  if (newRightPowerRail) rightPowerRailNode = newRightPowerRail

  let newEdge = rungLocal.edges
  newEdge = connectNodes(rungLocal, lastNode.id, newNode.id)

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
    gapNodes: removedNoveStyle.gapBetweenNodes,
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
