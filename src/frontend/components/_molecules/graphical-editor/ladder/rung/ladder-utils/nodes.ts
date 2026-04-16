import type { Node } from '@xyflow/react'

import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { defaultCustomNodesStyles, nodesBuilder } from '../../../../../_atoms/graphical-editor/ladder/node-builders'
import type { BuilderBasicProps } from '../../../../../_atoms/graphical-editor/ladder/utils/types'

export const findNode = (
  rung: RungLadderState,
  nodeId: string,
): { node: Node | undefined; position: number | undefined } => {
  return {
    node: rung.nodes.find((node) => node.id === nodeId),
    position: rung.nodes.findIndex((node) => node.id === nodeId),
  }
}

export const removeNode = (rung: RungLadderState, nodeId: string): Node[] => {
  return rung.nodes.filter((node) => node.id !== nodeId)
}

export const isNodeOfType = (node: Node, nodeType: string): boolean => {
  return node.type === nodeType
}

export const getDefaultNodeStyle = ({ node, nodeType }: { node?: Node; nodeType?: string }) => {
  return defaultCustomNodesStyles[node?.type ?? nodeType ?? 'mockNode']
}

export const buildGenericNode = <T>({
  nodeType,
  blockType,
  id,
  posX,
  posY,
  handleX,
  handleY,
}: BuilderBasicProps & {
  nodeType: string
  blockType?: T | undefined
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        posX,
        posY,
        handleX,
        handleY,
        variant: blockType ?? undefined,
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
