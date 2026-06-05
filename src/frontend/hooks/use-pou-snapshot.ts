import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'

/**
 * Convenience hook wrapping snapshotActions.pushToHistory().
 * Captures the current POU state (variables, body, globalVariables, and
 * graphical flow state for LD/FBD) and pushes it to the undo history.
 */
export function usePouSnapshot() {
  const {
    project,
    ladderFlows,
    fbdFlows,
    snapshotActions: { pushToHistory, undo, redo },
  } = useOpenPLCStore()

  const captureAndPush = useCallback(
    (pouName: string) => {
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
    [project.data.pous, project.data.configurations.resource.globalVariables, ladderFlows, fbdFlows, pushToHistory],
  )

  return { captureAndPush, undo, redo }
}
