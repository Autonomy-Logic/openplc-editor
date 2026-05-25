/**
 * Send START to the OpenPLC v4 runtime after a successful build,
 * retrying while the runtime is still finishing its previous STOP
 * transition.
 *
 * Canonical, pure orchestrator — same logic both openplc-editor's
 * `compileProgram` and openplc-web's `compileProgram` route through.
 * The platform-specific HTTP call (Electron `https.request` on editor,
 * orchestrator-agent device command on web) is injected via
 * `fetchStart`; everything above that is shared.
 *
 * Why retry: after an upload, the runtime begins unloading the
 * previous program (plugin cleanup, `pthread_join`, …) on a
 * background thread.  Until that finishes, `/api/start-plc` answers
 * with `COMMAND:BUSY`.  The editor used to retry this inline with a
 * 5 s deadline and 150 ms interval; that loop now lives here so both
 * platforms behave identically.
 *
 * Behaviour pinned to match editor's previous inline implementation:
 *   - 5-s overall deadline (`timeoutMs`).
 *   - 150-ms interval between attempts.
 *   - `START:OK` or `ALREADY_RUNNING` in the runtime's reply → SUCCESS.
 *   - `BUSY` in the reply → keep retrying.
 *   - Any other reply → terminal failure (e.g. invalid program).
 *   - Network error on the fetch → terminal failure.
 *   - Deadline elapsed → TIMEOUT (a warning, not a fatal error).
 */

export type StartPlcAfterBuildOutcome = 'STARTED' | 'FAILED' | 'TIMEOUT'

export type StartPlcAfterBuildLogLevel = 'info' | 'error' | 'warning'

export interface StartPlcAfterBuildOptions {
  /** One round-trip to the runtime's `/api/start-plc`.  Returns the
   *  parsed `status` field of the response body (e.g. `START:OK`,
   *  `ALREADY_RUNNING`, `COMMAND:BUSY`).  The Result envelope lets
   *  the caller surface a network error without crashing the loop. */
  fetchStart(): Promise<{ success: true; status: string } | { success: false; error: string }>
  /** Emits one log entry: the terminal outcome message.  Same shape
   *  the editor's `_mainProcessPort.postMessage({ logLevel, message })`
   *  takes; web routes it through `onProgress`. */
  onLog(level: StartPlcAfterBuildLogLevel, message: string): void
  /** Overall deadline.  Defaults to 5 s — matches editor's
   *  `POST_BUILD_START_TIMEOUT_MS`. */
  timeoutMs?: number
  /** Sleep between attempts.  Defaults to 150 ms — matches editor's
   *  `POST_BUILD_START_POLL_INTERVAL_MS`. */
  pollIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_POLL_INTERVAL_MS = 150

/**
 * Run the start-with-retry loop.  Resolves with the outcome as soon
 * as the runtime returns a terminal reply (or the loop trips the
 * deadline / a network error).
 */
export async function startPlcAfterBuild(opts: StartPlcAfterBuildOptions): Promise<StartPlcAfterBuildOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const result = await opts.fetchStart()
    if (!result.success) {
      opts.onLog('error', `Failed to start PLC: ${result.error}`)
      return 'FAILED'
    }

    const status = result.status ?? ''
    if (status.includes('START:OK') || status.includes('ALREADY_RUNNING')) {
      opts.onLog('info', 'PLC started.')
      return 'STARTED'
    }

    // Only BUSY is retryable — everything else is a real error
    // from the runtime (invalid program, compile error, …).
    if (!status.includes('BUSY')) {
      opts.onLog('error', `Failed to start PLC: ${status || 'unknown response'}`)
      return 'FAILED'
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  opts.onLog('warning', `PLC did not start within ${timeoutMs}ms — runtime remained busy. Press Play to retry.`)
  return 'TIMEOUT'
}
