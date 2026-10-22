import type { OpenPLCStore } from '../store'

/** How long an established connection gets to open its session. */
export const SESSION_OPEN_TIMEOUT_MS = 15000

/**
 * Wait for the target's session after a connect was started.
 *
 * Resolves `true` once `deviceConnection.status` is `connected`, and `false` once
 * the attempt has ended without one: the link or the runtime login went to
 * `disconnected` / `error`, or the session did not open in time. A runtime waits
 * through its login modal with no timeout; the timeout starts once the login is
 * done (or, for a device, at once, as its connect has already succeeded).
 */
export function awaitDebugSession(
  store: OpenPLCStore,
  target: 'device' | 'runtime',
  timeoutMs: number = SESSION_OPEN_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    let settled = false

    const settle = (ready: boolean): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      resolve(ready)
    }

    const check = (): void => {
      const state = store.getState()
      if (state.deviceConnection.status === 'connected') {
        settle(true)
        return
      }
      const status = target === 'runtime' ? state.runtimeConnection.connectionStatus : state.deviceConnection.status
      if (status === 'disconnected' || status === 'error') {
        settle(false)
        return
      }
      if (!timer && (target === 'device' || status === 'connected')) {
        timer = setTimeout(() => settle(false), timeoutMs)
      }
    }

    unsubscribe = store.subscribe(check)
    check()
  })
}
