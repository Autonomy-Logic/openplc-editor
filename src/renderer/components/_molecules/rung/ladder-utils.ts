import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { getNodesBounds } from '@xyflow/react'

import { customNodesStyles, nodesBuilder } from '../../_atoms/react-flow/custom-nodes'
import { CustomHandleProps } from '../../_atoms/react-flow/custom-nodes/handle'

/**
 * EDGES
 */
const buildEdge = (sourceNodeId: string, targetNodeId: string): Edge => {
  return {
    id: `e_${sourceNodeId}_${targetNodeId}`,
    source: sourceNodeId,
    target: targetNodeId,
    type: 'step',
  }
}

const removeEdge = (edges: Edge[], edgeId: string): Edge[] => {
  return edges.filter((edge) => edge.id !== edgeId)
}

export const connectNodes = (rung: FlowState, sourceNodeId: string, targetNodeId: string): Edge[] => {
  // Find the source edge
  const sourceEdge = rung.edges.find((edge) => edge.source === sourceNodeId)

  // If the source edge is found, update the target
  if (sourceEdge) {
    // Remove the source edge
    const edges = rung.edges.filter((edge) => edge.id !== sourceEdge.id)
    // Update the target of the source edge
    edges.push(buildEdge(sourceNodeId, targetNodeId))
    // Update the target of the target edge
    edges.push(buildEdge(targetNodeId, sourceEdge.target))
    return edges
  }

  const edges = rung.edges
  return [...edges, buildEdge(sourceNodeId, targetNodeId)]
}

export const disconnectNodes = (rung: FlowState, sourceNodeId: string, targetNodeId: string): Edge[] => {
  // sourceEdge -> edge that connect the source node
  // targetEdge -> edge that connect the target node
  const sourceEdge = rung.edges.find((edge) => edge.target === sourceNodeId)
  const targetEdge = rung.edges.find((edge) => edge.target === targetNodeId)

  if (!sourceEdge) return rung.edges

  let newEdges = removeEdge(rung.edges, sourceEdge.id)

  if (targetEdge) {
    newEdges = removeEdge(newEdges, targetEdge.id)
    newEdges.push(buildEdge(sourceEdge.source, targetEdge.target))
  }

  return newEdges
}

/**
 * NODES
 */
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
        variant: 'TON',
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

export const removeNode = ({
  rungLocal,
  defaultBounds,
}: {
  rungLocal: FlowState
  defaultBounds: [number, number]
}): { nodes: Node[]; edges: Edge[] } => {
  const leftPowerRailNode = rungLocal.nodes.find((node) => node.id === 'left-rail') as Node
  let rightPowerRailNode = rungLocal.nodes.find((node) => node.id === 'right-rail') as Node
  const nodes = rungLocal.nodes.filter((node) => node.id !== 'left-rail' && node.id !== 'right-rail')

  const removedNode = nodes[nodes.length - 1]
  if (!removedNode) return { nodes: rungLocal.nodes, edges: rungLocal.edges }

  const removedNoveStyle = getNodeStyle({ node: removedNode })

  const newRightPowerRail = changePowerRailBounds({
    rung: rungLocal,
    nodes: [leftPowerRailNode, ...nodes.slice(0, -1)],
    gapNodes: removedNoveStyle.gapBetweenNodes,
    defaultBounds: defaultBounds,
  })
  if (newRightPowerRail) rightPowerRailNode = newRightPowerRail

  const edge = rungLocal.edges.find((edge) => edge.source === removedNode.id)
  const newEdges = disconnectNodes(rungLocal, edge?.source ?? '', edge?.target ?? '')

  return {
    nodes: [leftPowerRailNode, ...nodes.slice(0, -1), rightPowerRailNode],
    edges: newEdges,
  }
}
