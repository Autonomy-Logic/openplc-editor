import { Handle, Node, NodeProps, Position } from '@xyflow/react'

type PowerRailNode = Node<{ position: 'left' | 'right'; rungId: string }, 'text'>
type PowerRailProps = NodeProps<PowerRailNode>

const POWER_RAIL_WIDTH = 3
const POWER_RAIL_HEIGHT = 200

const POWER_RAIL_CONNECTOR_X_OFFSET = POWER_RAIL_WIDTH + 1
const POWER_RAIL_CONNECTOR_Y_OFFSET = POWER_RAIL_HEIGHT / 2

export const PowerRail = ({ data }: PowerRailProps) => {
  const { position } = data

  const handlePosition = position === 'left' ? Position.Left : Position.Right
  const handleType = position === 'left' ? 'target' : 'source'

  const handleOffset =
    position === 'left' ? { left: -POWER_RAIL_CONNECTOR_X_OFFSET } : { right: -POWER_RAIL_CONNECTOR_X_OFFSET }

  return (
    <>
      <div aria-label='left-power-rail'>
        <svg width={POWER_RAIL_WIDTH} height={POWER_RAIL_HEIGHT} xmlns='http://www.w3.org/2000/svg'>
          <rect width={POWER_RAIL_WIDTH} height={POWER_RAIL_HEIGHT} className='fill-black dark:fill-neutral-500' />
        </svg>
      </div>
      <Handle
        position={handlePosition}
        type={handleType}
        isConnectable={false}
        style={{
          top: POWER_RAIL_CONNECTOR_Y_OFFSET,
          ...handleOffset,
        }}
      />
    </>
  )
}
