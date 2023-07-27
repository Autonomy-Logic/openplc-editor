import { FC } from 'react'
import { EdgeProps, getSmoothStepPath } from 'reactflow'

import { classNames } from '@/utils'

const DefaultEdge: FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
  selected,
}) => {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <path
      id={id}
      style={style}
      className={classNames(
        'react-flow__edge-path stroke-2',
        selected ? 'stroke-open-plc-blue' : 'stroke-black',
      )}
      d={edgePath}
      markerEnd={markerEnd}
    />
  )
}

export default DefaultEdge
