import type { Node } from '@xyflow/react'

import type { HandleBranch, RungLadderState } from '../../../ports/types'

/** The id of the rung's left or right power rail, found by its `left-rail` / `right-rail` prefix. */
export function findRailId(nodes: Node[], side: 'left' | 'right'): string | undefined {
  const prefix = side === 'left' ? 'left-rail' : 'right-rail'
  return nodes.find((n) => n.id.startsWith(prefix))?.id
}

/** True when the block pin carries a handle branch. */
export function hasBranchOnHandle(rung: RungLadderState, blockId: string, handleId: string): boolean {
  return rung.handleBranches?.some((b) => b.blockId === blockId && b.handleId === handleId) ?? false
}

/** The handle branch on a block pin, if any. */
export function getBranch(rung: RungLadderState, blockId: string, handleId: string): HandleBranch | undefined {
  return rung.handleBranches?.find((b) => b.blockId === blockId && b.handleId === handleId)
}
