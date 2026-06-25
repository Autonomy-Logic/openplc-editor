/**
 * Deploy a compiled program to an OpenPLC v4 runtime: upload the zip,
 * poll the runtime build until it settles, then send START.
 *
 * Canonical, pure orchestrator — same logic both openplc-editor and
 * openplc-web use after building the upload bundle.  The runtime is
 * the same on both platforms (Pi/x86 box running the v4 runtime);
 * only the *transport* differs — editor talks to it through `https`
 * directly, web routes through the orchestrator agent proxy.  Those
 * three round-trips are injected as callbacks; the sequencing,
 * logging, deadlines, and BUSY-retry logic all live here.
 *
 * The function composes the two lower-level shared helpers
 * (`pollRuntimeCompilation` and `startPlcAfterBuild`); callers that
 * only need one of them can still use those directly.
 *
 * Side effects: none.  No disk I/O, no HTTP, no DOM — every external
 * interaction goes through the injected callbacks.
 */

import { pollRuntimeCompilation, type PollRuntimeCompilationOptions } from './poll-runtime-compilation'
import { startPlcAfterBuild, type StartPlcAfterBuildOptions } from './start-plc-after-build'

export type DeployRuntimeProgramOutcome =
  | 'STARTED'
  | 'UPLOAD_FAILED'
  | 'BUILD_FAILED'
  | 'BUILD_TIMEOUT'
  | 'BUILD_ERROR'
  | 'START_FAILED'
  | 'START_TIMEOUT'

export type DeployRuntimeProgramLogLevel = 'info' | 'error' | 'warning' | 'debug'

export interface DeployRuntimeProgramOptions {
  /** Send the compiled zip to the runtime's `/api/upload-file`.  The
   *  caller owns compression (disk-walk on editor, in-memory file map
   *  on web) and the actual HTTPS / orchestrator-proxy call.  Returns
   *  a Result envelope so we can log a friendly upload-failed message
   *  without inspecting the transport's exception type. */
  uploadProgram(): Promise<{ success: boolean; error?: string }>
  /** One round-trip to `/api/compilation-status` — same callback
   *  shape `pollRuntimeCompilation` expects.  Threaded through here
   *  so this orchestrator stays platform-free. */
  fetchCompilationStatus: PollRuntimeCompilationOptions['fetchStatus']
  /** One round-trip to `/api/start-plc` — same callback shape
   *  `startPlcAfterBuild` expects. */
  fetchStartResponse: StartPlcAfterBuildOptions['fetchStart']
  /** Receives every log line — runtime build output, upload status,
   *  start outcome.  Each call is one entry; the caller picks the
   *  surface (console, toast, IPC log channel, …). */
  onLog(level: DeployRuntimeProgramLogLevel, message: string): void
  /** Forwarded to `pollRuntimeCompilation`. */
  pollTimeoutMs?: number
  pollIntervalMs?: number
  pollMaxConsecutiveErrors?: number
  /** Forwarded to `startPlcAfterBuild`. */
  startTimeoutMs?: number
  startIntervalMs?: number
}

/**
 * Run the upload + poll + start sequence.  Resolves with the
 * outcome describing how far the deploy got.  Any non-`STARTED`
 * value is terminal — the runtime did not begin running the new
 * program, and the caller should surface the corresponding log
 * entry to the user.
 */
export async function deployRuntimeProgram(opts: DeployRuntimeProgramOptions): Promise<DeployRuntimeProgramOutcome> {
  // 1. Upload.  The runtime answers HTTP 200 the moment the zip is
  //    accepted; the actual build runs async on the device and is
  //    surfaced through `/api/compilation-status` below.  The caller
  //    is expected to emit any pre-upload context message (e.g.
  //    "Uploading to <ip>...") before calling deployRuntimeProgram
  //    — keeping it out of here lets editor preserve its IP-specific
  //    log without web fighting it.
  const uploadResult = await opts.uploadProgram()
  if (!uploadResult.success) {
    opts.onLog('error', `Failed to upload program to runtime: ${uploadResult.error ?? 'unknown error'}`)
    return 'UPLOAD_FAILED'
  }
  opts.onLog('info', 'Program uploaded successfully to runtime.')

  // 2. Poll runtime build.  Editor used to print "Runtime compilation
  //    started: COMPILING" before entering the loop; the poller's
  //    own log fan-out covers the per-line output once compile.sh
  //    starts emitting.
  opts.onLog('info', 'Runtime compilation started: COMPILING')
  const pollOutcome = await pollRuntimeCompilation({
    fetchStatus: opts.fetchCompilationStatus,
    onLog: opts.onLog,
    timeoutMs: opts.pollTimeoutMs,
    pollIntervalMs: opts.pollIntervalMs,
    maxConsecutiveErrors: opts.pollMaxConsecutiveErrors,
  })
  if (pollOutcome === 'FAILED') return 'BUILD_FAILED'
  if (pollOutcome === 'TIMEOUT') return 'BUILD_TIMEOUT'
  if (pollOutcome === 'ERROR') return 'BUILD_ERROR'
  // pollOutcome === 'SUCCESS' — fall through to start.

  // 3. Start the PLC.  Retry while the runtime answers BUSY (its
  //    STOP transition thread is still finishing the unload — plugin
  //    cleanup, pthread_join, etc.).  Without this, the new binary
  //    sits unloaded and the debugger reads the old program's MD5.
  const startOutcome = await startPlcAfterBuild({
    fetchStart: opts.fetchStartResponse,
    onLog: opts.onLog,
    timeoutMs: opts.startTimeoutMs,
    pollIntervalMs: opts.startIntervalMs,
  })
  if (startOutcome === 'STARTED') return 'STARTED'
  if (startOutcome === 'TIMEOUT') return 'START_TIMEOUT'
  return 'START_FAILED'
}
