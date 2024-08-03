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
        x: handleX,
        y: handleY,
      },
      {
        id: 'right',
        position: 'right',
        type: 'source',
        isConnectable: false,
        x: handleX + 150,
        y: handleY,
      },
    ],
  },
  width: 150,
  height: 40,
  draggable: false,
  selectable: true,
})
