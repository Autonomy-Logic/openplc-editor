import { FC } from 'react'
import { EdgeProps, getSmoothStepPath } from 'reactflow'

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
    <>
      <path
        id={id}
        style={style}
        className="react-flow__edge-path stroke-zinc-300 stroke-2"
        d={edgePath}
        markerEnd={markerEnd}
      />
    </>
  )
}

export default DefaultEdge
