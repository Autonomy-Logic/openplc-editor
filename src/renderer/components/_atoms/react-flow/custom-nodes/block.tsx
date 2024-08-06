import { Node, NodeProps, Position } from '@xyflow/react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { buildHandle, CustomHandle, CustomHandleProps } from './handle'

type BlockNode = Node<{ handles: CustomHandleProps[]; blockType: 'template' }, 'text'>
type BlockProps = NodeProps<BlockNode>

export const BLOCK_WIDTH = 130
export const BLOCK_HEIGHT = 150

export const BLOCK_CONNECTOR_X = BLOCK_WIDTH
export const BLOCK_CONNECTOR_Y = 50
export const BLOCK_CONNECTOR_Y_OFFSET = 40

export const BLOCK_TOP_LABEL_Y = 28

type BlockTypes = {
  [key: string]: {
    name: string
    leftConnectors: string[]
    rightConnectors: string[]
    tooltipContent: string
  }
}
const BLOCK_TYPES: BlockTypes = {
  template: {
    name: '???',
    leftConnectors: ['EN', 'PT'],
    rightConnectors: ['EN0'],
    tooltipContent: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam aliquam tristique tincidunt. Duis elementum
            tortor sem, non convallis orci facilisis at. Suspendisse id bibendum nisl. Mauris ac massa diam. Mauris
            ultrices massa justo, sed vehicula tellus rhoncus eget. Suspendisse lacinia nec dolor vitae sollicitudin.
            Interdum et malesuada fames ac ante ipsum primis in faucibus. Quisque rutrum, tellus eu maximus cursus,
            metus urna eleifend ex, vitae accumsan nisl neque luctus diam. Quisque vel dui vel eros lobortis maximus non
            eget mauris. Aenean aliquet, justo id tempor placerat, ipsum purus molestie justo, sed euismod est arcu
            fermentum odio. Nullam et mauris leo. Aenean magna ex, sollicitudin at consequat non, cursus nec elit. Morbi
            sodales porta elementum.`,
  },
}

export const Block = ({ data }: BlockProps) => {
  const [blockLabelValue, setBlockLabelValue] = useState<string>('???')
  const { name, leftConnectors, rightConnectors, tooltipContent } = BLOCK_TYPES[data.blockType]

  return (
    <div className='relative'>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div
              className='relative flex flex-col rounded-md border border-neutral-850 bg-white hover:border-transparent hover:ring-2 hover:ring-brand dark:bg-neutral-900'
              style={{
                width: BLOCK_WIDTH,
                height: BLOCK_HEIGHT,
              }}
            >
              <div className='flex h-fit w-full justify-center py-1 text-sm'>{name}</div>
              {leftConnectors.map((connector, index) => (
                <div
                  key={index}
                  className='absolute text-sm'
                  style={{ top: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
                >
                  {connector}
                </div>
              ))}
              {rightConnectors.map((connector, index) => (
                <div
                  key={index}
                  className='absolute text-sm'
                  style={{ top: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
                >
                  {connector}
                </div>
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent side='right'>{tooltipContent}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute flex justify-center'
        style={{
          top: -BLOCK_TOP_LABEL_Y,
          width: BLOCK_WIDTH,
        }}
      >
        <InputWithRef
          value={blockLabelValue}
          onChange={(e) => setBlockLabelValue(e.target.value)}
          className='w-full bg-transparent text-center outline-none'
        />
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
}

/**
 *
 * @param id: string - The id of the block node
 * @param posX: number - The x coordinate of the block node in the flow panel
 * @param posY: number - The y coordinate of the block node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @param blockType: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  blockType = 'template',
}: {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
  blockType?: 'template'
}) => {
  const type = BLOCK_TYPES[blockType]
  const leftConnectors = type.leftConnectors
  const rightConnectors = type.rightConnectors

  const leftHandles = leftConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY + index * BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = rightConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX + BLOCK_CONNECTOR_X,
      glbY: handleY + index * BLOCK_CONNECTOR_Y_OFFSET,
      relX: BLOCK_CONNECTOR_X,
      relY: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: BLOCK_CONNECTOR_Y + index * BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
    data: {
      blockType,
      handles,
    },
    width: BLOCK_WIDTH,
    height: BLOCK_HEIGHT,
    draggable: false,
  }
}
