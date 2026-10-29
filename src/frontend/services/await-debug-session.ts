import type { OpenPLCStore } from '../store'

/** How long an established connection gets to open its session. */
export const SESSION_OPEN_TIMEOUT_MS = 15000

/**
 * How a wait for the session ended. `cancelled`: the user backed out of a runtime
 * login. `failed`: the link or the login went to `error` (whatever failed has
 * already said why), or a device link dropped. `timeout`: no session in time.
 */
export type DebugSessionOutcome = 'connected' | 'cancelled' | 'failed' | 'timeout'

/**
 * Wait for the target's session after a connect was started.
 *
 * Settles `connected` once `deviceConnection.status` is `connected`, or with the
 * reason the attempt ended without one. A runtime waits through its login modal
 * with no timeout; the timeout starts once the login is done (or, for a device,
 * at once, as its connect has already succeeded).
 */
export function awaitDebugSession(
  store: OpenPLCStore,
  target: 'device' | 'runtime',
  timeoutMs: number = SESSION_OPEN_TIMEOUT_MS,
): Promise<DebugSessionOutcome> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    let settled = false

    const settle = (outcome: DebugSessionOutcome): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      resolve(outcome)
    }

    const check = (): void => {
      const state = store.getState()
      if (state.deviceConnection.status === 'connected') {
        settle('connected')
        return
      }
      if (target === 'runtime') {
        const status = state.runtimeConnection.connectionStatus
        if (status === 'disconnected') return settle('cancelled')
        if (status === 'error') return settle('failed')
        if (status === 'connected' && !timer) timer = setTimeout(() => settle('timeout'), timeoutMs)
        return
      }
      const status = state.deviceConnection.status
      if (status === 'disconnected' || status === 'error') return settle('failed')
      if (!timer) timer = setTimeout(() => settle('timeout'), timeoutMs)
    }

    // Only the two statuses decide anything, so nothing else wakes the wait.
    unsubscribe = store.subscribe(
      (state) => `${state.deviceConnection.status}|${state.runtimeConnection.connectionStatus}`,
      check,
    )
    check()
  })
}
