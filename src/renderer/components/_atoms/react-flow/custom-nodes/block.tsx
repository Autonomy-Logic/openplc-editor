import { cn } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

type BlockNode = Node<BasicNodeData & { variant: 'default' | 'TON' }>
type BlockProps = NodeProps<BlockNode>
type BlockBuilderProps = BuilderBasicProps & { variant: 'default' | 'TON' }

export const DEFAULT_BLOCK_WIDTH = 96
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_X = DEFAULT_BLOCK_WIDTH
export const DEFAULT_BLOCK_CONNECTOR_Y = 40
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 32

type BlockTypes = {
  [key: string]: {
    name: string
    leftConnectors: string[]
    rightConnectors: string[]
    tooltipContent: string
  }
}
const DEFAULT_BLOCK_TYPES: BlockTypes = {
  default: {
    name: '???',
    leftConnectors: ['???', '???'],
    rightConnectors: ['???'],
    tooltipContent: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam aliquam tristique tincidunt. Duis elementum
            tortor sem, non convallis orci facilisis at. Suspendisse id bibendum nisl. Mauris ac massa diam. Mauris
            ultrices massa justo, sed vehicula tellus rhoncus eget. Suspendisse lacinia nec dolor vitae sollicitudin.
            Interdum et malesuada fames ac ante ipsum primis in faucibus. Quisque rutrum, tellus eu maximus cursus,
            metus urna eleifend ex, vitae accumsan nisl neque luctus diam. Quisque vel dui vel eros lobortis maximus non
            eget mauris. Aenean aliquet, justo id tempor placerat, ipsum purus molestie justo, sed euismod est arcu
            fermentum odio. Nullam et mauris leo. Aenean magna ex, sollicitudin at consequat non, cursus nec elit. Morbi
            sodales porta elementum.`,
  },
  TON: {
    name: 'TON',
    leftConnectors: ['EN', 'IN', 'PT'],
    rightConnectors: ['EN0', 'Q', 'ET'],
    tooltipContent: `The TON block is a timer block that can be used to trigger an event after a certain amount of time has passed.`,
  },
}

export const Block = ({ height, selected, data, id, dragging }: BlockProps) => {
  const [blockLabelValue, setBlockLabelValue] = useState<string>('')
  const { name, leftConnectors, rightConnectors, tooltipContent } = DEFAULT_BLOCK_TYPES[data.variant]

  return (
    <div
      className={cn('relative', {
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div
              className={cn(
                'relative flex flex-col rounded-md border border-neutral-850 bg-white hover:border-transparent hover:ring-2 hover:ring-brand dark:bg-neutral-900',
                {
                  'ring-2 ring-brand': selected,
                },
              )}
              style={{
                width: DEFAULT_BLOCK_WIDTH,
                height: height,
              }}
            >
              <div className='flex h-fit w-full justify-center py-1 text-sm'>{name}</div>
              {leftConnectors.map((connector, index) => (
                <div
                  key={index}
                  className='absolute text-sm'
                  style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
                >
                  {connector}
                </div>
              ))}
              {rightConnectors.map((connector, index) => (
                <div
                  key={index}
                  className='absolute text-sm'
                  style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
                >
                  {connector}
                </div>
              ))}
            </div>
          </TooltipTrigger>
          {!dragging && <TooltipContent side='right'>{tooltipContent}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-7'
        style={{
          width: DEFAULT_BLOCK_WIDTH,
        }}
      >
        <InputWithRef
          value={blockLabelValue}
          onChange={(e) => setBlockLabelValue(e.target.value)}
          placeholder='???'
          className='w-full bg-transparent text-center text-sm outline-none'
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
export const buildBlockNode = ({ id, posX, posY, handleX, handleY, variant }: BlockBuilderProps) => {
  const type = DEFAULT_BLOCK_TYPES[variant]
  const leftConnectors = type.leftConnectors
  const rightConnectors = type.rightConnectors

  const leftHandles = leftConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
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
      glbX: handleX + DEFAULT_BLOCK_CONNECTOR_X,
      glbY: handleY + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: DEFAULT_BLOCK_CONNECTOR_X,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  const blocKHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    Math.max(leftConnectors.length, rightConnectors.length) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
    data: {
      variant,
      handles,
      inputConnector: leftHandles[0],
      outputConnector: rightHandles[0],
    },
    width: DEFAULT_BLOCK_WIDTH,
    height: DEFAULT_BLOCK_HEIGHT < blocKHeight ? blocKHeight : DEFAULT_BLOCK_HEIGHT,
    draggable: true,
    selectable: true,
    selected: false,
  }
}
