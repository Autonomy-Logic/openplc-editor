/**
 * Boot sequence and change tracking for an embedded vendor configurator.
 *
 * Boot: `ready` → `setController` → `show` → `load(stored archive)` → compare the
 * loaded device setup with the stored one. The guest also reports `modified` for its
 * own boot calls, at no fixed step and sometimes after the call resolves, so events
 * are only taken as user changes once the guest has been quiet for `settleMs` after
 * boot. A change is snapshotted once the events settle.
 */

import type { ConfiguratorPort, ConfiguratorSnapshot } from '@root/middleware/shared/ports/configurator-port'

export const DEFAULT_SETTLE_MS = 300

export type ConfiguratorSessionStatus = { kind: 'booting' } | { kind: 'ready' } | { kind: 'failed'; message: string }

export interface ConfiguratorSessionOptions {
  port: ConfiguratorPort
  /** Controller type id passed to `setController`. */
  controller: string
  /** Archive to restore; `null` starts an empty configuration and never calls `load`. */
  storedArchive: string | null
  /** Module guids of the stored device setup, in slot order. */
  storedModuleGuids: readonly string[]
  settleMs?: number
  onStatus: (status: ConfiguratorSessionStatus) => void
  onSnapshot: (snapshot: ConfiguratorSnapshot) => void
  /** Errors that do not end the session: guest reports and failed snapshots. */
  onError: (message: string) => void
}

export interface ConfiguratorSession {
  dispose(): void
}

export const LOAD_FAILED_MESSAGE =
  'The saved I/O configuration could not be restored in the configurator. The saved configuration was kept unchanged.'

function sameGuids(loaded: readonly string[], stored: readonly string[]): boolean {
  return loaded.length === stored.length && loaded.every((guid, index) => guid === stored[index])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function startConfiguratorSession(options: ConfiguratorSessionOptions): ConfiguratorSession {
  const { port, controller, storedArchive, storedModuleGuids, onStatus, onSnapshot, onError } = options
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS

  let disposed = false
  let booted = false
  let accepting = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotting = false
  let changedDuringSnapshot = false

  const runSnapshot = async (): Promise<void> => {
    if (snapshotting) {
      changedDuringSnapshot = true
      return
    }
    snapshotting = true
    changedDuringSnapshot = false
    try {
      const snapshot = await port.snapshot()
      if (disposed) return
      // A newer change makes this snapshot stale; the rescheduled one supersedes it.
      if (changedDuringSnapshot) scheduleSnapshot()
      else onSnapshot(snapshot)
    } catch (error) {
      if (!disposed) onError(messageOf(error))
    } finally {
      snapshotting = false
    }
  }

  function scheduleSnapshot(): void {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      void runSnapshot()
    }, settleMs)
  }

  function waitForQuiet(): void {
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      accepting = true
    }, settleMs)
  }

  const offModified = port.onModified(() => {
    if (disposed) return
    if (!accepting) {
      if (booted) waitForQuiet()
      return
    }
    if (snapshotting) changedDuringSnapshot = true
    scheduleSnapshot()
  })
  const offError = port.onError((message) => {
    if (!disposed) onError(message)
  })

  const restore = async (archive: string): Promise<void> => {
    let loadedGuids: string[]
    try {
      await port.load(archive)
      loadedGuids = (await port.getDeviceSetup()).devices.map((device) => device.guid)
    } catch (error) {
      throw new Error(`${LOAD_FAILED_MESSAGE} ${messageOf(error)}`)
    }
    // A bundle can accept an archive and still load nothing, so the result is checked, not trusted.
    if (!sameGuids(loadedGuids, storedModuleGuids)) throw new Error(LOAD_FAILED_MESSAGE)
  }

  const boot = async (): Promise<void> => {
    onStatus({ kind: 'booting' })
    try {
      await port.ready()
      await port.setController(controller)
      await port.show()
      if (storedArchive) await restore(storedArchive)
      if (disposed) return
      booted = true
      waitForQuiet()
      onStatus({ kind: 'ready' })
    } catch (error) {
      if (!disposed) onStatus({ kind: 'failed', message: messageOf(error) })
    }
  }
  void boot()

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      if (quietTimer) clearTimeout(quietTimer)
      if (settleTimer) clearTimeout(settleTimer)
      offModified()
      offError()
      port.dispose()
    },
  }
}
