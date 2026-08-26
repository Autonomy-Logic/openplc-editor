import { useOpenPLCStore } from '@root/frontend/store'
import { isRetainConfigCapableRuntime } from '@root/frontend/utils/device'
import { hiddenNativeScreens } from '@root/frontend/utils/native-screens'
import { useRuntime } from '@root/middleware/shared/providers'
import { useEffect, useRef } from 'react'

/**
 * Makes "hidden" mean "disabled".
 *
 * A VPP declares `hidesNativeScreens` when its own driver implements something
 * the runtime also provides. Removing the screen alone would only hide the
 * setting, not the behaviour — the runtime would still have its native feature
 * switched on, and the operator would have no way left to see it, let alone
 * turn it off.
 *
 * The case that forced this: a project on plain runtime v4 with retention
 * enabled, then retargeted at a VPP whose HAL keeps retained values in
 * hardware. Both stores would be live, each writing every scan, and both would
 * appear to work. The next power cut decides which one the values came from.
 *
 * So whenever the target hides a native screen, the feature behind it is turned
 * off on the connected device, and the console says so — silently changing a
 * device's configuration is not something to do without a line in the log.
 *
 * Runs on connect and on target change. Idempotent: it reads the current
 * setting first and only writes when there is something to turn off, so a
 * device that was never configured is left alone and no redundant PUT goes out
 * on every reconnect.
 */
export const useNativeScreenEnforcement = () => {
  const runtime = useRuntime()
  const connectionStatus = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus)
  const runtimeVersion = useOpenPLCStore((s) => s.runtimeConnection.runtimeVersion)
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)

  // One attempt per (device, target) pair. Without this an in-flight PUT would
  // be re-issued by every unrelated re-render while it is still running.
  const attempted = useRef<string | null>(null)

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      attempted.current = null
      return
    }

    const board = availableBoards.get(deviceBoard)
    const hidden = hiddenNativeScreens(board)
    if (!hidden.has('persistent-storage')) return
    // Nothing to switch off on a runtime that has no built-in store.
    if (!isRetainConfigCapableRuntime(runtimeVersion)) return

    const key = `${deviceBoard} persistent-storage`
    if (attempted.current === key) return
    attempted.current = key

    void (async () => {
      const current = await runtime.getRetainConfig()
      // A read failure is not a reason to blind-write: the device may be
      // mid-restart, and the next connect retries.
      if (!current.success || !current.config) {
        attempted.current = null
        return
      }
      if (!current.config.enabled) return

      const result = await runtime.updateRetainConfig({ enabled: false })
      const store = useOpenPLCStore.getState()
      if (!result.success) {
        store.consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message:
            `[retain] ${deviceBoard} handles retained variables in its own driver, but the runtime's ` +
            `built-in file store could not be switched off (${result.error ?? 'unknown error'}). ` +
            `Two stores may now be active.`,
        })
        return
      }
      store.consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message:
          `[retain] ${deviceBoard} handles retained variables in its own driver; the runtime's ` +
          `built-in file store has been switched off so only one is active.`,
      })
    })()
  }, [connectionStatus, runtimeVersion, deviceBoard, availableBoards, runtime])
}
