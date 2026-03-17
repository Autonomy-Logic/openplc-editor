import { useCallback } from 'react'

import { useOpenPLCStore } from '../store'

/**
 * Convenience hook wrapping snapshotActions.pushToHistory().
 * Captures the current POU state (variables, body, globalVariables) and pushes it
 * to the undo history in a single call.
 */
export function usePouSnapshot() {
  const {
    project,
    snapshotActions: { pushToHistory, undo, redo },
  } = useOpenPLCStore()

  const captureAndPush = useCallback(
    (pouName: string) => {
      const pou = project.data.pous.find((p) => p.name === pouName)
      if (!pou) return

      pushToHistory(pouName, {
        variables: pou.interface?.variables ?? [],
        body: pou.body.value,
        globalVariables: project.data.configurations.resource.globalVariables,
      })
    },
    [project.data.pous, project.data.configurations.resource.globalVariables, pushToHistory],
  )

  return { captureAndPush, undo, redo }
}
