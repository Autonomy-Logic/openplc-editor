import { memo } from 'react'

import { CustomHandle, ladderHandleStyle } from './handle'
import type { ParallelProps } from './utils/types'

/** A parallel junction node: a point on its junction line; the routed wires draw the line, so it draws nothing. */
const Parallel = ({ data }: ParallelProps) => {
  return (
    <>
      <div style={{ width: 1, height: 1 }} />
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} style={ladderHandleStyle(handle)} />
      ))}
    </>
  )
}

const exportParallel = memo(Parallel)

export { exportParallel as Parallel }
