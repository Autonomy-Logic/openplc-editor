import type { Node } from '@xyflow/react'

import type { RungLadderState } from '../../ports/types'
import { EMPTY_LABEL_SOURCE, type LadderLabelSource } from './labels'
import { applyRungLayout, layoutRung } from './layout'
import { updateVariableBlockPosition } from './legacy/variable-block'

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
