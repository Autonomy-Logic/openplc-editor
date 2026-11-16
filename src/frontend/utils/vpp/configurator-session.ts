/**
 * Boot sequence and change tracking for an embedded vendor configurator.
 *
 * Boot: `ready` → `setController` → `show` → `load(stored archive)` → compare the
 * loaded device setup with the stored one. The guest also reports `modified` for its
 * own boot calls, at no fixed step and sometimes after the call resolves, so events
 * are only taken as user changes once the guest has been quiet for `settleMs` after
 * boot. The session reports `ready` only then, so the host can hold input until edits
 * count. A change is reported as pending at once, so a host closing before the snapshot
 * still asks to save, and is snapshotted once the events settle. A failed snapshot is retried
 * with backoff, then reported. A snapshot equal to the stored state is not delivered.
 */

import type { ConfiguratorPort, ConfiguratorSnapshot } from '@root/middleware/shared/ports/configurator-port'

export const DEFAULT_SETTLE_MS = 300
/** Attempts at one pending change's snapshot before its error is reported; a new change starts over. */
export const SNAPSHOT_ATTEMPTS = 3

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
  /** A user change arrived that no snapshot has delivered yet. */
  onPending?: () => void
  /** The settled snapshot equals the stored state, so nothing was delivered. */
  onUnchanged?: () => void
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
  const { port, controller, storedArchive, storedModuleGuids, onStatus, onSnapshot, onError, onPending, onUnchanged } =
    options
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS

  let disposed = false
  let booted = false
  let accepting = false
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let snapshotting = false
  let changedDuringSnapshot = false
  let pending = false
  let failedSnapshots = 0
  let lastArchive = storedArchive

  // Nothing stored and no module configured is the state a fresh project already has.
  const isUnchanged = (snapshot: ConfiguratorSnapshot): boolean =>
    lastArchive === null
      ? storedModuleGuids.length === 0 && snapshot.deviceSetup.devices.length === 0
      : snapshot.archive === lastArchive

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
      if (changedDuringSnapshot) {
        scheduleSnapshot()
        return
      }
      pending = false
      failedSnapshots = 0
      if (isUnchanged(snapshot)) {
        onUnchanged?.()
        return
      }
      lastArchive = snapshot.archive
      onSnapshot(snapshot)
    } catch (error) {
      if (disposed) return
      failedSnapshots = changedDuringSnapshot ? 0 : failedSnapshots + 1
      if (failedSnapshots < SNAPSHOT_ATTEMPTS) {
        scheduleSnapshot(settleMs * 2 ** failedSnapshots)
      } else {
        // The change stays pending, so its tab stays unsaved until a later change snapshots.
        failedSnapshots = 0
        onError(messageOf(error))
      }
    } finally {
      snapshotting = false
    }
  }

  function scheduleSnapshot(delayMs = settleMs): void {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      void runSnapshot()
    }, delayMs)
  }

  function waitForQuiet(): void {
    if (quietTimer) clearTimeout(quietTimer)
    quietTimer = setTimeout(() => {
      quietTimer = null
      accepting = true
      onStatus({ kind: 'ready' })
    }, settleMs)
  }

  const offModified = port.onModified(() => {
    if (disposed) return
    if (!accepting) {
      if (booted) waitForQuiet()
      return
    }
    if (snapshotting) changedDuringSnapshot = true
    failedSnapshots = 0
    if (!pending) {
      pending = true
      onPending?.()
    }
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
