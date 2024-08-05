import { Node, NodeProps } from '@xyflow/react'

import { CustomHandle, CustomHandleProps } from './handle'

type BlockNode = Node<{ handles: CustomHandleProps[] }, 'text'>
type BlockProps = NodeProps<BlockNode>

export const BLOCK_WIDTH = 130
export const BLOCK_HEIGHT = 150

export const BLOCK_CONNECTOR_X = BLOCK_WIDTH
export const BLOCK_CONNECTOR_Y = 50
export const BLOCK_CONNECTOR_Y_OFFSET = 40

export const Block = ({ data }: BlockProps) => {
  return (
    <>
      <div
        className='relative flex flex-col rounded-md border border-neutral-850 bg-white dark:bg-neutral-900 hover:border-brand'
        style={{
          width: BLOCK_WIDTH,
          height: BLOCK_HEIGHT,
        }}
      >
        <div className='flex h-fit w-full justify-center py-1 text-sm'>TON</div>
        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y - 11, left: 7 }}> EN </div>
        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}> IN </div>
        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET) - 11, left: 7 }}> PT </div>

        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y - 11, right: 7 }}> ENO </div>
        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y + BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}> Q   </div>
        <div className='absolute text-sm' style={{ top: BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET) - 11, right: 7 }}> ET  </div>
      </div>
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
        }
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
        }
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
        }
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
        }
      },
      {
        id: 'PT',
        position: 'left',
        type: 'target',
        isConnectable: false,
        x: handleX,
        y: handleY + BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET),
        style: {
          top: BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET),
          left: 0,
        }
      },
      {
        id: 'ET',
        position: 'right',
        type: 'source',
        isConnectable: false,
        x: handleX + BLOCK_CONNECTOR_X,
        y: handleY + BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET),
        style: {
          top: BLOCK_CONNECTOR_Y + (2 * BLOCK_CONNECTOR_Y_OFFSET),
          right: 0,
        }
      }
    ],
  },
  width: BLOCK_WIDTH,
  height: BLOCK_HEIGHT,
  draggable: false,
})
