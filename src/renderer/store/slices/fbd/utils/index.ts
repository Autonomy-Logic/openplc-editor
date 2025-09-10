import { CustomFbdNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BlockNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { CommentNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/comment'
import { ConnectionNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/connection'
import { VariableNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/variable'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
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

  const nodeIdMap = new Map<string, string>()
  const newNodes: Node[] = []
  for (const node of nodes) {
    const newNode = buildGenericNode({
      id: newGraphicalEditorNodeID(node.type),
      nodeType: (node.type as CustomFbdNodeTypes) ?? 'default',
      position: {
        x: mouse.x + (node.position.x - bounds.x1),
        y: mouse.y + (node.position.y - bounds.y1),
      },
      blockType: node.data.variant,
      executionControl: node.type === 'block' ? (node.data as BlockNodeData<BlockVariant>).executionControl : undefined,
    })
    if (!newNode) continue

    if (newNode.type?.includes('variable')) {
      ;(newNode as VariableNode).data.variable = (node as VariableNode).data.variable
    }
    if (newNode.type === 'connector' || newNode.type === 'continuation') {
      ;(newNode as ConnectionNode).data.variable = (node as ConnectionNode).data.variable
    }
    if (newNode.type === 'comment') {
      ;(newNode as CommentNode).data.content = (node as CommentNode).data.content
    }

    newNode.selected = true
    newNodes.push(newNode)
    nodeIdMap.set(node.id, newNode.id)
  }

  const remap = (id: string) => nodeIdMap.get(id) ?? id
  const isNodeSource = (edge: Edge) => nodeIdMap.has(edge.source)
  const isNodeTarget = (edge: Edge) => nodeIdMap.has(edge.target)

  const newEdges: Edge[] = []
  for (const edge of edges) {
    // If the edge is not only connected to a internal copy/cut node, ignore it
    if (!isNodeSource(edge) || !isNodeTarget(edge)) {
      continue
    }

    newEdges.push({
      ...edge,
      id: `xy-edge_${remap(edge.source)}_${remap(edge.target)}__${edge.sourceHandle ?? ''}_${edge.targetHandle ?? ''}`,
      source: remap(edge.source),
      target: remap(edge.target),
    })
  }

  return { nodes: newNodes, edges: newEdges }
}
