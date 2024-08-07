import { Node, NodeProps, Position } from '@xyflow/react'

import { buildHandle, CustomHandle, CustomHandleProps } from './handle'

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

/**
 *
 * @param id: string - The id of the power rail node
 * @param posX: number - The x coordinate of the power rail node in the flow panel
 * @param posY: number - The y coordinate of the power rail node in the flow panel
 * @param connector: 'left' | 'right' - The connector of the power rail node
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @returns PowerRailNode
 */
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
}) => {
  const handles = [
    buildHandle({
      id: `${connector}-rail`,
      position: connector === 'left' ? Position.Left : Position.Right,
      type: connector === 'left' ? 'target' : 'source',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: POWER_RAIL_CONNECTOR_X,
      relY: POWER_RAIL_CONNECTOR_Y,
      style: {
        top: POWER_RAIL_CONNECTOR_Y,
        left: connector === 'left' ? -POWER_RAIL_WIDTH : undefined,
        right: connector === 'right' ? -POWER_RAIL_WIDTH : undefined,
      },
    }),
  ]

  return {
    id,
    type: 'powerRail',
    position: { x: posX, y: posY },
    data: {
      handles,
    },
    width: POWER_RAIL_WIDTH,
    height: POWER_RAIL_HEIGHT,
    draggable: false,
    selectable: false,
  }
}
