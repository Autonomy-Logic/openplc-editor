import { CustomFbdNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { buildGenericNode } from '@root/renderer/components/_molecules/graphical-editor/fbd/fbd-utils/nodes'
import { newGraphicalEditorNodeID } from '@root/utils/new-graphical-editor-node-id'
import { Edge, Node } from '@xyflow/react'

export const pasteNodesAtFBD = (nodes: Node[], edges: Edge[], mouse: { x: number; y: number }) => {
  const bounds = nodes.reduce(
    (acc, node) => {
      acc.x1 = Math.min(acc.x1, node.position.x)
      acc.y1 = Math.min(acc.y1, node.position.y)
      acc.x2 = Math.max(acc.x2, node.position.x + (node.width ?? 0))
      acc.y2 = Math.max(acc.y2, node.position.y + (node.height ?? 0))
      return acc
    },
    { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
  )

  const newNodes = nodes
    .map((node) => {
      return buildGenericNode({
        id: newGraphicalEditorNodeID(node.type),
        nodeType: (node.type as CustomFbdNodeTypes) ?? 'default',
        position: {
          x: mouse.x + (node.position.x - bounds.x1),
          y: mouse.y + (node.position.y - bounds.y1),
        },
        blockType: node.data.variant,
      })
    })
    .filter((node) => node !== undefined) as Node[]

  const nodeIdMap = new Map(nodes.map((node, index) => [node.id, newNodes[index].id]))

  const remap = (id: string) => nodeIdMap.get(id) ?? id
  const isNodeSource = (edge: Edge) => nodeIdMap.has(edge.source)
  const isNodeTarget = (edge: Edge) => nodeIdMap.has(edge.target)

  const newEdges = edges.filter(isNodeSource).map((edge) => ({
    ...edge,
    id: `xy-edge_${isNodeSource(edge) ? remap(edge.source) : edge.source}_${isNodeTarget(edge) ? remap(edge.target) : edge.target}__${edge.sourceHandle ?? ''}_${edge.targetHandle ?? ''}`,
    source: isNodeSource(edge) ? remap(edge.source) : edge.source,
    target: isNodeTarget(edge) ? remap(edge.target) : edge.target,
  }))

  return { nodes: newNodes, edges: newEdges }
}
