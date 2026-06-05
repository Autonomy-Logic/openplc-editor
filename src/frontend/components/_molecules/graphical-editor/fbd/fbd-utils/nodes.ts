import { CustomFbdNodeTypes, nodesBuilder } from '../../../../_atoms/graphical-editor/fbd'
import { BuilderBasicProps } from '../../../../_atoms/graphical-editor/fbd/utils/types'

export const buildGenericNode = <T>({
  nodeType,
  blockType,
  connectionLabel,
  executionControl,
  id,
  position,
}: BuilderBasicProps & {
  nodeType: CustomFbdNodeTypes | 'default'
  blockType?: T | undefined
  connectionLabel?: string
  executionControl?: boolean
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        position,
        variant: blockType ?? undefined,
        executionControl,
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
