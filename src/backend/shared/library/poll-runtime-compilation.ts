/**
 * Poll the OpenPLC v4 runtime's `/api/compilation-status` endpoint
 * after a program upload, streaming each new log line through a
 * callback until the runtime reports SUCCESS / FAILED (or the
 * deadline / comm-error guards trip).
 *
 * Canonical, pure orchestrator — same logic both openplc-editor's
 * `compileProgram` and openplc-web's `compileProgram` route through.
 * The platform-specific HTTP call (Electron `https.request` on
 * editor, orchestrator-agent device command on web) is injected via
 * `fetchStatus`; everything above that is shared.
 *
 * Behaviour pinned to match editor's previous inline implementation:
 *   - 20-min overall deadline.
 *   - 1-s poll interval.
 *   - 10 consecutive comm failures abort with `ERROR`.
 *   - Logs are deduplicated by index (`logs` is cumulative on the
 *     runtime side; only the slice past `lastLogCount` is emitted).
 *   - `[ERROR] / [WARN(ING)] / [INFO] / [DEBUG]` prefix on a log
 *     line is parsed into the corresponding level; everything else
 *     defaults to `info`.
 */

/** Shape the runtime returns from `/api/compilation-status`.
 *  `status` is the build state machine token — `COMPILING` while
 *  in-flight, `SUCCESS` / `FAILED` once the build settles. */
export interface RuntimeCompilationStatus {
  status: string
  logs: string[]
  exit_code: number | null
}

export type RuntimeCompilationLogLevel = 'info' | 'error' | 'warning' | 'debug'

export type PollRuntimeCompilationOutcome = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'ERROR'

export interface PollRuntimeCompilationOptions {
  /** One round-trip to the runtime's `/api/compilation-status`.  The
   *  caller wires this to its platform's HTTP transport (Electron
   *  https.request on editor, orchestrator-agent device command on
   *  web).  Returns a Result-shaped object so a comm failure can be
   *  counted toward the consecutive-error guard without crashing the
   *  whole poll loop. */
  fetchStatus(): Promise<{ success: true; data: RuntimeCompilationStatus } | { success: false; error: string }>
  /** Receives every newly-emitted log line as the build progresses,
   *  plus the final outcome summary.  Each call is one log entry —
   *  the caller decides how to surface it (console, toast, log panel). */
  onLog(level: RuntimeCompilationLogLevel, message: string): void
  /** Overall deadline.  Defaults to 20 minutes — large projects on a
   *  Pi 4 can hit ~15 min at -O1. */
  timeoutMs?: number
  /** Sleep between polls.  Defaults to 1 s. */
  pollIntervalMs?: number
  /** Bail with `ERROR` after this many consecutive comm failures.
   *  Defaults to 10 (≈ 10 s with the default interval). */
  maxConsecutiveErrors?: number
}

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const DEFAULT_POLL_INTERVAL_MS = 1000
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 10

/** Strip `[LEVEL]` prefix from a runtime log line and route the
 *  remainder at the matching level.  Same convention editor's
 *  `parseLogLevel` follows.
 *
 *  The runtime appends a trailing newline to every entry it pushes
 *  into `build_state.logs` (e.g. `build_state.log(f"[INFO] ...\\n")`
 *  in openplc-runtime's `plcapp_management.py`).  We can't anchor
 *  the body match with `$` because JS without the `m` flag treats
 *  the trailing `\\n` as still inside the string and the anchor
 *  fails — historically that dropped every classified line back to
 *  `level: 'info'` with the prefix preserved, which is why error
 *  output rendered blue in the console.  Anchor only the prefix
 *  and capture the rest by slicing, so trailing whitespace (or any
 *  control characters) doesn't break classification. */
function classifyLogLine(line: string): { level: RuntimeCompilationLogLevel; message: string } {
  const m = line.match(/^\[(ERROR|WARN|WARNING|INFO|DEBUG)\]\s*/i)
  if (!m) return { level: 'info', message: line.replace(/\r?\n$/, '') }
  const tag = m[1].toUpperCase()
  const level: RuntimeCompilationLogLevel =
    tag === 'ERROR' ? 'error' : tag === 'WARN' || tag === 'WARNING' ? 'warning' : tag === 'DEBUG' ? 'debug' : 'info'
  return { level, message: line.slice(m[0].length).replace(/\r?\n$/, '') }
}

/**
 * Run the polling loop.  Resolves with the outcome as soon as the
 * runtime emits a terminal status (or the loop trips a guard).
 */
export async function pollRuntimeCompilation(
  opts: PollRuntimeCompilationOptions,
): Promise<PollRuntimeCompilationOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS

  let lastLogCount = 0
  let consecutiveErrors = 0
  const deadline = Date.now() + timeoutMs

  while (true) {
    if (Date.now() > deadline) {
      opts.onLog('error', `Compilation status polling timed out after ${Math.round(timeoutMs / 60_000)} minutes.`)
      return 'TIMEOUT'
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))

    const result = await opts.fetchStatus()
    if (!result.success) {
      consecutiveErrors += 1
      if (consecutiveErrors >= maxConsecutiveErrors) {
        opts.onLog(
          'error',
          `Error polling compilation status: ${result.error} (${maxConsecutiveErrors} consecutive failures, giving up)`,
        )
        return 'ERROR'
      }
      continue
    }
    consecutiveErrors = 0

    const { status, logs, exit_code } = result.data
    if (logs.length > lastLogCount) {
      for (const raw of logs.slice(lastLogCount)) {
        const { level, message } = classifyLogLine(raw)
        opts.onLog(level, message)
      }
      lastLogCount = logs.length
    }

    if (status === 'SUCCESS') {
      opts.onLog('info', `Compilation completed successfully (exit code: ${exit_code ?? 0}).`)
      return 'SUCCESS'
    }
    if (status === 'FAILED') {
      opts.onLog('error', `Compilation failed (exit code: ${exit_code ?? 1}).`)
      return 'FAILED'
    }
    // status === 'COMPILING' (or anything in-flight) → keep polling.
  }
}
