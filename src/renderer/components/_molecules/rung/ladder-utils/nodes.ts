import { defaultCustomNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import type { BuilderBasicProps } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { FlowState } from '@root/renderer/store/slices'
import type { Node } from '@xyflow/react'

export const findNode = (rung: FlowState, nodeId: string): { node: Node | undefined; position: number | undefined } => {
  return {
    node: rung.nodes.find((node) => node.id === nodeId),
    position: rung.nodes.findIndex((node) => node.id === nodeId),
  }
}

export const removeNode = (rung: FlowState, nodeId: string): Node[] => {
  return rung.nodes.filter((node) => node.id !== nodeId)
}

export const isNodeOfType = (node: Node, nodeType: string): boolean => {
  return node.type === nodeType
}

export const getDefaultNodeStyle = ({ node, nodeType }: { node?: Node; nodeType?: string }) => {
  return defaultCustomNodesStyles[node?.type ?? nodeType ?? 'mockNode']
}

export const buildGenericNode = ({
  nodeType,
  id,
  posX,
  posY,
  handleX,
  handleY,
}: BuilderBasicProps & {
  nodeType: string
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: 'default',
      })
    case 'coil':
      return nodesBuilder.coil({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: 'default',
      })
    case 'contact':
      return nodesBuilder.contact({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: 'default',
      })
    case 'parallel':
      return nodesBuilder.parallel({
        id,
        posX,
        posY,
        handleX,
        handleY,
        type: 'open',
      })
    default:
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
