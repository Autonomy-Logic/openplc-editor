import { FC } from 'react'
import { EdgeProps, getSmoothStepPath } from 'reactflow'

import { classNames } from '@/utils'

/**
 * DefaultEdge component used to render edges between nodes in a flowchart.
 * @param id - The unique identifier for the edge.
 * @param sourceX - The x-coordinate of the source node.
 * @param sourceY - The y-coordinate of the source node.
 * @param targetX - The x-coordinate of the target node.
 * @param targetY - The y-coordinate of the target node.
 * @param sourcePosition - The position of the source anchor on the node.
 * @param targetPosition - The position of the target anchor on the node.
 * @param style - Additional styles for the edge path.
 * @param data - Additional data associated with the edge.
 * @param markerEnd - The marker used at the end of the edge path.
 * @param selected - Whether the edge is selected.
 */
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
