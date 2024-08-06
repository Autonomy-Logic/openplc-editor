import { Node, NodeProps } from '@xyflow/react'

import { CustomHandle, CustomHandleProps } from './handle'

type PowerRailNode = Node<{ handles: CustomHandleProps[] }, 'text'>
type PowerRailProps = NodeProps<PowerRailNode>

export const POWER_RAIL_WIDTH = 3
export const POWER_RAIL_HEIGHT = 200

export const POWER_RAIL_CONNECTOR_X = POWER_RAIL_WIDTH
export const POWER_RAIL_CONNECTOR_Y = POWER_RAIL_HEIGHT / 2

export const PowerRail = ({ data }: PowerRailProps) => {
  return (
    <>
      <svg width={POWER_RAIL_WIDTH} height={POWER_RAIL_HEIGHT} xmlns='http://www.w3.org/2000/svg'>
        <rect width={POWER_RAIL_WIDTH} height={POWER_RAIL_HEIGHT} className='fill-neutral-500' />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const buildPowerRailNode = ({
  id,
  posX,
  posY,
  connector,
  handleX,
  handleY,
}: {
  id: string
  posX: number
  posY: number
  connector: 'left' | 'right'
  handleX: number
  handleY: number
}) => ({
  id,
  type: 'powerRail',
  position: { x: posX, y: posY },
  data: {
    handles: [
      {
        id: `${connector}-rail`,
        position: connector === 'left' ? 'left' : 'right',
        type: connector === 'left' ? 'target' : 'source',
        isConnectable: false,
        x: handleX,
        y: handleY,
        style: {
          top: POWER_RAIL_CONNECTOR_Y,
          left: connector === 'left' ? -POWER_RAIL_WIDTH : null,
          right: connector === 'right' ? -POWER_RAIL_WIDTH : null,
        },
      },
    ],
  },
  width: POWER_RAIL_WIDTH,
  height: POWER_RAIL_HEIGHT,
  draggable: false,
  selectable: false,
})
