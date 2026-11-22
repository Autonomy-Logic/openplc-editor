import type { Node } from '@xyflow/react'

import type { RungLadderState } from '../../ports/types'
import { EMPTY_LABEL_SOURCE, type LadderLabelSource } from './labels'
import { applyRungLayout, layoutRung, rungLayoutDiffers } from './layout'
import { updateVariableBlockPosition } from './legacy/variable-block'
import type { RungLayout } from './types'

/**
 * A rung after an edit: each block's pin variable boxes rebuilt for its pins (`previousNodes`: fallback box
 * identities), then `layoutRung` + `applyRungLayout` with the label source.
 */
export function relayoutRung(
  rung: RungLadderState,
  src: LadderLabelSource = EMPTY_LABEL_SOURCE,
  previousNodes?: Node[],
): RungLadderState {
  const synced: RungLadderState = { ...rung, ...updateVariableBlockPosition(rung, previousNodes) }
  return applyRungLayout(synced, layoutRung(synced, src))
}

/**
 * `rungs` with the geometry of `layouts` stored on every rung that is away from its layout, as after a rename or a
 * changed location; the same array when no rung is. A rung the layout cannot be stored on exactly is left as it is.
 */
export function withLaidOutGeometry(
  rungs: readonly RungLadderState[],
  layouts: ReadonlyMap<RungLadderState, RungLayout>,
): readonly RungLadderState[] {
  let changed = false
  const next = rungs.map((rung) => {
    const layout = layouts.get(rung)
    if (layout === undefined || !rungLayoutDiffers(rung, layout)) return rung
    const laidOut = applyRungLayout(rung, layout)
    if (rungLayoutDiffers(laidOut, layout)) return rung
    changed = true
    return laidOut
  })
  return changed ? next : rungs
}
