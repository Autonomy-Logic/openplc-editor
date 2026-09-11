/**
 * Re-stamp every placed library block in the open project, applying pin-set
 * changes as well as types.
 *
 * The reconcile that runs on project load cannot grow a block: adding a pin
 * needs the node's handles rebuilt, and each language builds those itself.
 * This runs in the components layer, where both `getBlockSize` functions are
 * reachable, so it is the one place a library update reaches the diagrams.
 */

import { getBlockSize as fbdBlockSize } from '@root/frontend/components/_atoms/graphical-editor/fbd/utils/utils'
import { getBlockSize as ladderBlockSize } from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/utils'
import { useOpenPLCStore } from '@root/frontend/store'
import type { MeasureBlock, RestampChange } from '@root/frontend/utils/PLC/restamp-library-variants'
import { restampFlowLibraryVariants, summariseRestampChanges } from '@root/frontend/utils/PLC/restamp-library-variants'

// The graphical editors declare their own `BlockVariant`, differing only in
// requiring `extensible`. `getBlockSize` reads `name` and `variables`, so the
// two are interchangeable here.
const measureLadder = ladderBlockSize as unknown as MeasureBlock
const measureFbd = fbdBlockSize as unknown as MeasureBlock

/**
 * Reconcile the open project's diagrams against the libraries it now pins.
 * Reports through the console and leaves the project unsaved when anything
 * changed. Returns the changes so callers can act on the breaking ones.
 */
export function reconcilePlacedBlocks(): RestampChange[] {
  const state = useOpenPLCStore.getState()
  const systemLibraries = state.libraries.system
  const userPouNames = state.project.data.pous.filter((pou) => pou.pouType !== 'program').map((pou) => pou.name)

  const changes: RestampChange[] = []
  let modified = false

  // The store's flows are frozen by immer, and re-stamping mutates in place,
  // so work on a copy and hand the copy back -- the same thing project load
  // does before it re-stamps.
  for (const flow of state.ladderFlows) {
    const draft = structuredClone(flow)
    const report = restampFlowLibraryVariants([draft], systemLibraries, userPouNames, {
      pou: flow.name,
      measureBlock: measureLadder,
    })
    changes.push(...report.changes)
    if (!report.modified) continue
    modified = true
    state.ladderFlowActions.addLadderFlow(draft)
    // The canvas reads the flow; saving and compiling read `pou.body.value`.
    state.projectActions.updatePou({ name: flow.name, content: { language: 'ld', value: draft } })
  }

  for (const flow of state.fbdFlows) {
    const draft = structuredClone(flow)
    const report = restampFlowLibraryVariants([draft], systemLibraries, userPouNames, {
      pou: flow.name,
      measureBlock: measureFbd,
    })
    changes.push(...report.changes)
    if (!report.modified) continue
    modified = true
    state.fbdFlowActions.addFBDFlow(draft)
    state.projectActions.updatePou({ name: flow.name, content: { language: 'fbd', value: draft } })
  }

  for (const line of summariseRestampChanges(changes)) {
    state.consoleActions.addLog({ level: line.severity, message: line.message })
  }
  if (modified) {
    state.workspaceActions.setEditingState('unsaved')
  }

  return changes
}
