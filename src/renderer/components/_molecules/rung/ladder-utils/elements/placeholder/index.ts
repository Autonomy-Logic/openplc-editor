import type { Node } from '@xyflow/react'

export const renderPlaceholderElements = () => {}

export const removePlaceholderElements = (nodes: Node[]) => {
  return nodes.filter((node) => node.type !== 'placeholder' && node.type !== 'parallelPlaceholder')
}
export const searchNearestPlaceholder = () => {}
