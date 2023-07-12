import '@reactflow/node-resizer/dist/style.css'

import { FC } from 'react'
import { Handle, NodeProps, Position } from 'reactflow'

import { classNames } from '@/utils'

type PowerRailProps = {
  pinNumber: number
  pinPosition: 'right' | 'left'
}

const PowerRail: FC<NodeProps<PowerRailProps>> = ({
  selected,
  data: { pinNumber, pinPosition = 'right' },
}) => {
  const HANDLE_HEIGHT = 5
  const HANDLE_SPACE = HANDLE_HEIGHT
  const POWER_RAIL_HEIGHT =
    HANDLE_HEIGHT * HANDLE_SPACE * pinNumber + HANDLE_HEIGHT * HANDLE_SPACE

  return (
    <div
      className={classNames(
        'flex h-full w-1 flex-col justify-between rounded bg-black',
        selected && 'border border-open-plc-blue',
      )}
      style={{ minHeight: POWER_RAIL_HEIGHT }}
    >
      {[...Array(pinNumber)].map((_, index) => (
        <Handle
          key={index}
          id={index.toString()}
          type="source"
          position={Position[pinPosition === 'right' ? 'Right' : 'Left']}
          style={{ top: (index + 1) * (HANDLE_HEIGHT * HANDLE_SPACE) }}
          className={classNames(
            'h-[0.125rem] min-h-0 w-6 rounded-none bg-black',
            pinPosition === 'right' ? '-right-6' : '-left-6',
            selected ? 'border border-open-plc-blue' : 'border-none',
          )}
        />
      ))}
    </div>
  )
}

export default PowerRail
