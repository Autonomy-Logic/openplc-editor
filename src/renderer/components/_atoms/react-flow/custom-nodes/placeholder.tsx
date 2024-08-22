import { PlaceholderNode, PlaceholderNodeFilled } from '@root/renderer/assets/icons/flow/Placeholder'
import { cn } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'

import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type PlaceholderNode = Node<BasicNodeData>
type PlaceholderProps = NodeProps<PlaceholderNode>
type ParallelBuilderProps = BuilderBasicProps

export const PLACEHOLDER_WIDTH = 16
export const PLACEHOLDER_HEIGHT = 16

export const PLACEHOLDER_CONNECTOR_Y = PLACEHOLDER_HEIGHT / 2

export const Placeholder = ({ selected, data }: PlaceholderProps) => {
  return (
    <>
      <PlaceholderNodeFilled className={cn({ 'fill-brand': selected })} />
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const builderPlaceholderNode = ({ id, posX, posY, handleX, handleY }: ParallelBuilderProps): PlaceholderNode => {
  const handles = [
    buildHandle({
      id: 'input',
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: 0,
      relY: PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: PLACEHOLDER_CONNECTOR_Y,
        left: 0,
      },
    }),
    buildHandle({
      id: 'output',
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: PLACEHOLDER_WIDTH,
      relY: PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: PLACEHOLDER_CONNECTOR_Y,
        right: 0,
      },
    }),
  ]

  return {
    id,
    type: 'placeholder',
    data: {
      handles: handles,
      inputConnector: undefined,
      outputConnector: undefined,
    },
    position: {
      x: posX,
      y: posY,
    },
    style: {
      width: PLACEHOLDER_WIDTH,
      height: PLACEHOLDER_HEIGHT,
    },
    draggable: false,
  }
}
