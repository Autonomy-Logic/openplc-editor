import { generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'

import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

export type PowerRailNode = Node<BasicNodeData & { variant: 'left' | 'right' }>
type PowerRailProps = NodeProps<PowerRailNode>
type PowerRailBuilderProps = BuilderBasicProps & { connector: 'left' | 'right' }

export const DEFAULT_POWER_RAIL_WIDTH = 3
export const DEFAULT_POWER_RAIL_HEIGHT = 200

export const DEFAULT_POWER_RAIL_CONNECTOR_X = DEFAULT_POWER_RAIL_WIDTH
export const DEFAULT_POWER_RAIL_CONNECTOR_Y = DEFAULT_POWER_RAIL_HEIGHT / 2

export const PowerRail = ({ data }: PowerRailProps) => {
  return (
    <>
      <svg width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} xmlns='http://www.w3.org/2000/svg'>
        <rect width={DEFAULT_POWER_RAIL_WIDTH} height={DEFAULT_POWER_RAIL_HEIGHT} className='fill-neutral-500' />
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
export const buildPowerRailNode = ({ id, posX, posY, connector, handleX, handleY }: PowerRailBuilderProps) => {
  const handles = [
    buildHandle({
      id: `${connector === 'left' ? 'right' : 'left'}-rail`,
      position: connector === 'left' ? Position.Left : Position.Right,
      type: connector === 'left' ? 'target' : 'source',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: DEFAULT_POWER_RAIL_CONNECTOR_X,
      relY: DEFAULT_POWER_RAIL_CONNECTOR_Y,
      style: {
        top: DEFAULT_POWER_RAIL_CONNECTOR_Y,
        left: connector === 'left' ? -DEFAULT_POWER_RAIL_WIDTH : undefined,
        right: connector === 'right' ? -DEFAULT_POWER_RAIL_WIDTH : undefined,
      },
    }),
  ]

  return {
    id,
    type: 'powerRail',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputHandles: connector === 'left' ? handles : [],
      outputHandles: connector === 'right' ? handles : [],
      inputConnector: connector === 'left' ? handles[0] : undefined,
      outputConnector: connector === 'right' ? handles[0] : undefined,
      numericId: generateNumericUUID(),
      variant: connector === 'right' ? 'left' : 'right',
      variable: { name: '' },
      executionOrder: 0,
      draggable: false,
      selectable: false,
      deletable: false,
    },
    width: DEFAULT_POWER_RAIL_WIDTH,
    height: DEFAULT_POWER_RAIL_HEIGHT,
    measured: {
      width: DEFAULT_POWER_RAIL_WIDTH,
      height: DEFAULT_POWER_RAIL_HEIGHT,
    },
    draggable: false,
    selectable: false,
    selected: false,
  }
}
