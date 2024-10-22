import { generateNumericUUID } from '@root/utils'
import { Node, NodeProps } from '@xyflow/react'

import { CustomHandle, CustomHandleProps } from './handle'

type MockNode = Node<{ label: string; handles: CustomHandleProps[] }, 'text'>
type MockNodeProps = NodeProps<MockNode>

export const MockNode = ({ data }: MockNodeProps) => {
  return (
    <>
      <div className='h-[40px] w-[150px] border border-red-600 bg-white'>
        <p>{data.label}</p>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

/**
 *
 * @param id: string - The id of the mock node
 * @param label: string - The label of the mock node
 * @param posX: number - The x coordinate of the mock node in the flow panel
 * @param posY: number - The y coordinate of the mock node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @returns MockNode
 */
export const buildMockNode = ({
  id,
  label,
  posX,
  posY,
  handleX,
  handleY,
}: {
  id: string
  label: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}) => ({
  id,
  type: 'mockNode',
  position: { x: posX, y: posY },
  data: {
    label,
    handles: [
      {
        id: 'left',
        position: 'left',
        type: 'target',
        isConnectable: false,
        glbPosition: {
          x: handleX,
          y: handleY,
        },
        relPosition: {
          x: 0,
          y: 20,
        },
      },
      {
        id: 'right',
        position: 'right',
        type: 'source',
        isConnectable: false,
        glbPosition: {
          x: handleX + 150,
          y: handleY,
        },
        relPosition: {
          x: 150,
          y: 20,
        },
      },
    ],
    inputHandles: [
      {
        id: 'left',
        position: 'left',
        type: 'target',
        isConnectable: false,
        glbPosition: {
          x: handleX,
          y: handleY,
        },
        relPosition: {
          x: 0,
          y: 20,
        },
      },
    ],
    outputHandles: [
      {
        id: 'right',
        position: 'right',
        type: 'source',
        isConnectable: false,
        glbPosition: {
          x: handleX + 150,
          y: handleY,
        },
        relPosition: {
          x: 150,
          y: 20,
        },
      },
    ],
    inputConnector: {
      id: 'left',
      position: 'left',
      type: 'target',
      isConnectable: false,
      glbPosition: {
        x: handleX,
        y: handleY,
      },
      relPosition: {
        x: 0,
        y: 20,
      },
    },
    outputConnector: {
      id: 'right',
      position: 'right',
      type: 'source',
      isConnectable: false,
      glbPosition: {
        x: handleX + 150,
        y: handleY,
      },
      relPosition: {
        x: 150,
        y: 20,
      },
    },
    numericId: generateNumericUUID(),
    variable: '',
  },
  width: 150,
  height: 40,
  measured: {
    width: 150,
    height: 40,
  },
  draggable: false,
  selectable: true,
})
