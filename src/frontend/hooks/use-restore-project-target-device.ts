import { useEffect } from 'react'

import { useCapabilities, useOrchestrator } from '../../middleware/shared/providers'
import { findProjectTargetDevice } from '../services/project-target-device'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'

const SIMULATOR_BOARD_NAME = 'OpenPLC Simulator'

/**
 * Selects the project's recorded vPLC again when the project is opened, or
 * falls back to the simulator when the user's listing no longer offers it.
 *
 * Runs once per recorded target object: a project load replaces it, a
 * disconnect does not, so a deliberate disconnect is not undone. It only
 * selects, never connects, and leaves an existing selection alone, including
 * one made or cleared while the listing is in flight. A failed listing changes
 * nothing. Inert where vPLCs are not targeted (the desktop).
 *
 * Should be called once at the workspace level.
 */
export const useRestoreProjectTargetDevice = (): void => {
  const { hasOrchestratorDevices } = useCapabilities()
  const orchestratorPort = useOrchestrator()
  const store = useOpenPLCStoreApi()
  const target = useOpenPLCStore((state) => state.deviceDefinitions.configuration.targetDevice)

  useEffect(() => {
    if (!hasOrchestratorDevices || !target) return
    if (store.getState().runtimeConnection.selectedDevice) return

    let interrupted = false
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.runtimeConnection.selectedDevice !== previous.runtimeConnection.selectedDevice) interrupted = true
    })

    orchestratorPort
      .listOrchestrators()
      .then((orchestrators) => {
        const state = store.getState()
        // The project or the choice moved on while the listing was in flight.
        if (interrupted || state.deviceDefinitions.configuration.targetDevice !== target) return
        if (state.runtimeConnection.selectedDevice) return
        const selection = findProjectTargetDevice(target, orchestrators)
        if (selection) state.deviceActions.setSelectedDevice(selection)
        else if (state.deviceDefinitions.configuration.deviceBoard !== SIMULATOR_BOARD_NAME) {
          state.deviceActions.setDeviceBoard(SIMULATOR_BOARD_NAME)
        }
      })
      .catch((error: unknown) => {
        console.error('[RestoreTargetDevice] Listing Edge Devices failed', error)
      })
      .finally(unsubscribe)

    return () => {
      interrupted = true
      unsubscribe()
    }
  }, [hasOrchestratorDevices, orchestratorPort, store, target])
}
