import { useUpdateNodeInternals } from '@xyflow/react'
import { useEffect, useMemo } from 'react'

import { CustomHandle } from './handle'
import { DEFAULT_POWER_RAIL_HEIGHT, DEFAULT_POWER_RAIL_WIDTH } from './utils/constants'
import { PowerRailProps } from './utils/types'

export const PowerRail = ({ id, data }: PowerRailProps) => {
  const updateNodeInternals = useUpdateNodeInternals()

  // Calculate dynamic height to cover all handles (including branch handles)
  const railHeight = useMemo(() => {
    if (data.handles.length <= 1) return DEFAULT_POWER_RAIL_HEIGHT

    let maxRelY = 0
    for (const handle of data.handles) {
      const relY = handle.relPosition?.y ?? 0
      if (relY > maxRelY) maxRelY = relY
    }

    // Add padding below the lowest handle
    const dynamicHeight = maxRelY + DEFAULT_POWER_RAIL_HEIGHT / 2
    return Math.max(DEFAULT_POWER_RAIL_HEIGHT, dynamicHeight)
  }, [data.handles])

  // Derive a stable key from handle IDs so we re-scan when handles are added,
  // removed, or replaced (e.g. reconcileBranches swaps the handle ID).
  const handleIds = useMemo(() => data.handles.map((h) => h.id).join(','), [data.handles])

  // Force ReactFlow to re-scan handle bounds when handles change count, IDs, or position
  useEffect(() => {
    updateNodeInternals(id)
  }, [handleIds, railHeight, id, updateNodeInternals])

  return (
    <>
      <svg width={DEFAULT_POWER_RAIL_WIDTH} height={railHeight} xmlns='http://www.w3.org/2000/svg'>
        <rect width={DEFAULT_POWER_RAIL_WIDTH} height={railHeight} className='fill-neutral-500' />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}
