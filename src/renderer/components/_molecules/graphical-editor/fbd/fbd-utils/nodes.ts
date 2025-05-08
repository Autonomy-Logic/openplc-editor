import { CustomFbdNodeTypes, nodesBuilder } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BuilderBasicProps } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'

export const buildGenericNode = <T>({
  nodeType,
  blockType,
  connectionLabel,
  id,
  position,
}: BuilderBasicProps & {
  nodeType: CustomFbdNodeTypes
  blockType?: T | undefined
  connectionLabel?: string
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        position,
        variant: blockType ?? undefined,
      })
    case 'input-variable':
    case 'output-variable':
    case 'inout-variable':
      return nodesBuilder.variable({
        id,
        position,
        variant: nodeType,
      })
    case 'connector':
    case 'continuation':
      return nodesBuilder.connection({
        id,
        position,
        variant: nodeType,
        label: connectionLabel,
      })
    case 'comment':
      return nodesBuilder.comment({
        id,
        position,
      })
    default:
      return undefined
  }
}
