import { nodesBuilder } from "@root/renderer/components/_atoms/graphical-editor/fbd"
import { BuilderBasicProps } from "@root/renderer/components/_atoms/graphical-editor/fbd/utils"

export const buildGenericNode = <T> ({
  nodeType,
  blockType,
  id,
  position
}: BuilderBasicProps & {
  nodeType: string
  blockType?: T | undefined
}) => {
  switch (nodeType) {
    case 'block':
      return nodesBuilder.block({
        id,
        position,
        variant: blockType ?? undefined,
      })
    default:
      return undefined
  }
}
