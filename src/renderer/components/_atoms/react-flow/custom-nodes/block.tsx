import { Node, NodeProps } from '@xyflow/react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { CustomHandle, CustomHandleProps } from './handle'

type BlockNode = Node<{ handles: CustomHandleProps[]; blockType: 'TON' }, 'text'>
type BlockProps = NodeProps<BlockNode>

export const BLOCK_WIDTH = 130
export const BLOCK_HEIGHT = 150

export const BLOCK_CONNECTOR_X = BLOCK_WIDTH
export const BLOCK_CONNECTOR_Y = 50
export const BLOCK_CONNECTOR_Y_OFFSET = 40

export const BLOCK_TOP_LABEL_Y = 28 // If altered, also alter in the Block component. Actual: "-top-[28px]"

const BLOCK_TYPES = {
  TON: {
    name: 'TON',
    leftConnectors: ['EN', 'IN', 'PT'],
    rightConnectors: ['ENO', 'Q', 'ET'],
  },
}

export const Block = ({ data }: BlockProps) => {
  const { name, leftConnectors, rightConnectors } = BLOCK_TYPES[data.blockType]

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div
              className='relative flex flex-col rounded-md border border-neutral-850 bg-white hover:border-brand dark:bg-neutral-900'
              style={{
                width: BLOCK_WIDTH,
                height: BLOCK_HEIGHT,
              }}
            >
              <div className='flex h-fit w-full justify-center py-1 text-sm'>{name}</div>
              <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y - 11, left: 7 }}>
                {leftConnectors[0]}
              </div>
              <div
                className='absolute text-sm'
                style={{ top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
              >
                {leftConnectors[1]}
              </div>
              <div
                className='absolute text-sm'
                style={{ top: BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
              >
                {leftConnectors[2]}
              </div>

              <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y - 11, right: 7 }}>
                {rightConnectors[0]}
              </div>
              <div
                className='absolute text-sm'
                style={{ top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
              >
                {rightConnectors[1]}
              </div>
              <div
                aria-label='Block top label'
                className='absolute text-sm'
                style={{ top: BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
              >
                {rightConnectors[2]}
              </div>
              <div className='absolute -top-[28px] flex w-full justify-center'>TON0</div>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam aliquam tristique tincidunt. Duis elementum
            tortor sem, non convallis orci facilisis at. Suspendisse id bibendum nisl. Mauris ac massa diam. Mauris
            ultrices massa justo, sed vehicula tellus rhoncus eget. Suspendisse lacinia nec dolor vitae sollicitudin.
            Interdum et malesuada fames ac ante ipsum primis in faucibus. Quisque rutrum, tellus eu maximus cursus,
            metus urna eleifend ex, vitae accumsan nisl neque luctus diam. Quisque vel dui vel eros lobortis maximus non
            eget mauris. Aenean aliquet, justo id tempor placerat, ipsum purus molestie justo, sed euismod est arcu
            fermentum odio. Nullam et mauris leo. Aenean magna ex, sollicitudin at consequat non, cursus nec elit. Morbi
            sodales porta elementum.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const buildBlockNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
}: {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}) => ({
  id,
  type: 'block',
  position: { x: posX, y: posY },
  data: {
    blockType: 'TON',
    handles: [
      {
        id: 'input',
        position: 'left',
        type: 'target',
        isConnectable: false,
        x: handleX,
        y: handleY,
        style: {
          top: BLOCK_CONNECTOR_Y,
          left: 0,
        },
      },
      {
        id: 'output',
        position: 'right',
        type: 'source',
        isConnectable: false,
        x: handleX + BLOCK_CONNECTOR_X,
        y: handleY,
        style: {
          top: BLOCK_CONNECTOR_Y,
          right: 0,
        },
      },
      {
        id: 'IN',
        position: 'left',
        type: 'target',
        isConnectable: false,
        x: handleX,
        y: handleY + BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET,
        style: {
          top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET,
          left: 0,
        },
      },
      {
        id: 'Q',
        position: 'right',
        type: 'source',
        isConnectable: false,
        x: handleX + BLOCK_CONNECTOR_X,
        y: handleY + BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET,
        style: {
          top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET,
          right: 0,
        },
      },
      {
        id: 'PT',
        position: 'left',
        type: 'target',
        isConnectable: false,
        x: handleX,
        y: handleY + BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET,
        style: {
          top: BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET,
          left: 0,
        },
      },
      {
        id: 'ET',
        position: 'right',
        type: 'source',
        isConnectable: false,
        x: handleX + BLOCK_CONNECTOR_X,
        y: handleY + BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET,
        style: {
          top: BLOCK_CONNECTOR_Y + 2 * BLOCK_CONNECTOR_Y_OFFSET,
          right: 0,
        },
      },
    ],
  },
  width: BLOCK_WIDTH,
  height: BLOCK_HEIGHT,
  draggable: false,
})
