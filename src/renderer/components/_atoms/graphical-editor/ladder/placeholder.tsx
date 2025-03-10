import { PlaceholderNode, PlaceholderNodeFilled } from '@root/renderer/assets/icons/flow/Placeholder'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'

import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type PlaceholderNode = Node<
  BasicNodeData & { relatedNode: Node | undefined; position: 'left' | 'right' | 'bottom' }
>
type PlaceholderProps = NodeProps<PlaceholderNode>
type ParallelBuilderProps = BuilderBasicProps & {
  type: 'parallel' | 'default'
  relatedNode: Node | undefined
  position: 'left' | 'right' | 'bottom'
}

export const DEFAULT_PLACEHOLDER_WIDTH = 10
export const DEFAULT_PLACEHOLDER_HEIGHT = 10
export const DEFAULT_PLACEHOLDER_GAP = 15

export const DEFAULT_PLACEHOLDER_CONNECTOR_Y = DEFAULT_PLACEHOLDER_HEIGHT / 2

export const Placeholder = ({ selected, data }: PlaceholderProps) => {
  return (
    <>
      <PlaceholderNodeFilled
        className={cn({ 'fill-brand': selected })}
        width={DEFAULT_PLACEHOLDER_WIDTH}
        height={DEFAULT_PLACEHOLDER_HEIGHT}
      />
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const builderPlaceholderNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  type,
  position,
  relatedNode = undefined,
}: ParallelBuilderProps): PlaceholderNode => {
  const handles = [
    buildHandle({
      id: 'input',
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: 0,
      relY: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
        left: 0,
      },
    }),
    buildHandle({
      id: 'output',
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX + DEFAULT_PLACEHOLDER_WIDTH,
      glbY: handleY,
      relX: DEFAULT_PLACEHOLDER_WIDTH,
      relY: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
        right: 0,
      },
    }),
  ]

  return {
    id,
    type: type === 'default' ? 'placeholder' : 'parallelPlaceholder',
    data: {
      handles: handles,
      inputHandles: [handles[0]],
      outputHandles: [handles[1]],
      inputConnector: handles[0],
      outputConnector: handles[1],
      numericId: generateNumericUUID(),
      position,
      relatedNode,
      variable: { name: '' },
      executionOrder: 0,
      draggable: false,
      selectable: true,
      deletable: true,
    },
    position: {
      x: posX,
      y: posY,
    },
    style: {
      width: DEFAULT_PLACEHOLDER_WIDTH,
      height: DEFAULT_PLACEHOLDER_HEIGHT,
    },
    measured: {
      width: DEFAULT_PLACEHOLDER_WIDTH,
      height: DEFAULT_PLACEHOLDER_HEIGHT,
    },
    draggable: false,
    selectable: true,
    selected: false
  }
}
