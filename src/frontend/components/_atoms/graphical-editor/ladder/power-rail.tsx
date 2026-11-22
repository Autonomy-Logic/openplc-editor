import { useUpdateNodeInternals } from '@xyflow/react'
import { memo, useEffect, useMemo } from 'react'

import { CustomHandle, ladderHandleStyle } from './handle'
import { useLadderNodeView, useLadderRungId } from './rung-view'
import { DEFAULT_POWER_RAIL_HEIGHT } from './utils/constants'
import { PowerRailProps } from './utils/types'

/** Stroke width of a power rail. */
const RAIL_STROKE = 2.5

/** A power rail: one vertical line in the rail colour, as tall as its rung, with its handles where the wires meet it. */
const PowerRail = ({ id, data, height }: PowerRailProps) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { palette, geometry } = useLadderNodeView(id)
  const rungId = useLadderRungId()

  const railHeight = useMemo(() => {
    const lowestHandle = Math.max(0, ...data.handles.map((handle) => handle.relPosition?.y ?? 0))
    return Math.max(
      geometry?.height ?? height ?? DEFAULT_POWER_RAIL_HEIGHT,
      lowestHandle + DEFAULT_POWER_RAIL_HEIGHT / 2,
    )
  }, [data.handles, geometry, height])

  // Derive a stable key from handle IDs so we re-scan when handles are added,
  // removed, or replaced (e.g. reconcileBranches swaps the handle ID).
  const handleIds = useMemo(() => data.handles.map((h) => h.id).join(','), [data.handles])

  // Force ReactFlow to re-scan handle bounds when handles change count, IDs, or position
  useEffect(() => {
    updateNodeInternals(id)
  }, [handleIds, railHeight, id, updateNodeInternals])

  return (
    <>
      <svg
        width={1}
        height={railHeight}
        style={{ display: 'block', overflow: 'visible' }}
        data-testid={data.variant === 'right' && rungId !== undefined ? `ld-right-rail-${rungId}` : undefined}
      >
        <line x1={0} y1={0} x2={0} y2={railHeight} stroke={palette.rail} strokeWidth={RAIL_STROKE} />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} style={ladderHandleStyle(handle)} />
      ))}
    </>
  )
}

const exportPowerRail = memo(PowerRail)

export { exportPowerRail as PowerRail }
