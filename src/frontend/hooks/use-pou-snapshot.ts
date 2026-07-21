import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'
import { flushFlowWriteBacks } from '../store/slices/shared/flow-writeback'

/**
 * Convenience hook wrapping snapshotActions.pushToHistory().
 * Captures the current POU state (variables, body, globalVariables, and
 * graphical flow state for LD/FBD) and pushes it to the undo history.
 *
 * State is read via getState() at capture time (not subscribed): the hook
 * never re-renders its consumers and `captureAndPush` keeps a stable identity.
 *
 * Snapshots hold plain references into the store state — no deep clone. The
 * store is immer-managed (frozen, copy-on-write), so later edits produce new
 * objects and can never reach a captured snapshot. The previous JSON
 * round-trips cloned the full body, both flows and all globals on every
 * capture (~150-200 MB of transient garbage per edit burst on large
 * projects).
 */
export function usePouSnapshot() {
  const { pushToHistory, undo, redo } = useOpenPLCStore((state) => state.snapshotActions)

  const captureAndPush = useCallback(
    (pouName: string) => {
      // A debounced graphical write-back may still be pending — flush it so
      // the snapshot can't pair a stale body with a fresh flow.
      flushFlowWriteBacks(useOpenPLCStore.getState, pouName)
      const { project, ladderFlows, fbdFlows } = useOpenPLCStore.getState()
      const pou = project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      pushToHistory(pouName, {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        ladderFlow: ladderFlows.find((f) => f.name === pouName),
        fbdFlow: fbdFlows.find((f) => f.name === pouName),
        globalVariables: project.data.configurations.resource.globalVariables,
      })
    },
    [pushToHistory],
  )

  return { captureAndPush, undo, redo }
}
