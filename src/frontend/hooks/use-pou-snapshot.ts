import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'

/**
 * Convenience hook wrapping snapshotActions.pushToHistory().
 * Captures the current POU state (variables, body, globalVariables, and
 * graphical flow state for LD/FBD) and pushes it to the undo history.
 *
 * State is read via getState() at capture time (not subscribed): the hook
 * never re-renders its consumers and `captureAndPush` keeps a stable identity.
 */
export function usePouSnapshot() {
  const { pushToHistory, undo, redo } = useOpenPLCStore((state) => state.snapshotActions)

  const captureAndPush = useCallback(
    (pouName: string) => {
      const { project, ladderFlows, fbdFlows } = useOpenPLCStore.getState()
      const pou = project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      const ladderFlow = ladderFlows.find((f) => f.name === pouName)
      const fbdFlow = fbdFlows.find((f) => f.name === pouName)

      pushToHistory(pouName, {
        variables: JSON.parse(JSON.stringify(pou.interface?.variables ?? [])),
        body: JSON.parse(JSON.stringify(pou.body.value)),
        ladderFlow: ladderFlow ? JSON.parse(JSON.stringify(ladderFlow)) : undefined,
        fbdFlow: fbdFlow ? JSON.parse(JSON.stringify(fbdFlow)) : undefined,
        globalVariables: JSON.parse(JSON.stringify(project.data.configurations.resource.globalVariables)),
      })
    },
    [pushToHistory],
  )

  return { captureAndPush, undo, redo }
}
