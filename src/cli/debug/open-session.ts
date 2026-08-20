/**
 * Opening a debug session against a real target.
 *
 * Establishes the same channel the GUI does — for a Runtime v3/v4 that means a
 * REST login for control plus the debug WebSocket for variables, built from the
 * same `WebSocketDebugTransport` the editor's main process instantiates.
 *
 * The MD5 gate is the important part. The debug map addresses variables by
 * (arr, elem) positions that are only meaningful for the exact program that was
 * compiled; pointing them at a target running something else does not fail
 * loudly, it reads the WRONG VARIABLES and reports plausible numbers. So a
 * mismatch aborts unless the caller asked for an upload, and after uploading it
 * is re-verified rather than assumed.
 */

import { RUNTIME_API_PORT, RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import type { DeviceDebugChannel } from '@root/backend/shared/debug/types'
import { WebSocketDebugTransport } from '@root/backend/shared/debug/websocket-debug-transport'
import { DEBUG_MEDIUM_PROFILE } from '@root/frontend/utils/debug-medium-profile'
import type { TargetEndian } from '@root/frontend/utils/endian'

import { restPlcControl, SessionCore } from '../session/session-core'
import { loadDebugIndex } from './variables'

export interface OpenSessionOptions {
  sessionId: string
  projectPath: string
  target: string
  host: string
  username: string
  password: string
  /**
   * Called when the target's program does not match the local build. Returning
   * true means "an upload happened, re-verify"; false aborts.
   */
  onMd5Mismatch?: (details: { targetMd5: string | null; localMd5: string }) => Promise<boolean>
  onProgress?: (message: string) => void
}

export type OpenSessionResult =
  | { success: true; core: SessionCore; runtime: RuntimeApiClient; programMd5: string | null }
  | { success: false; code: 'auth' | 'connection' | 'md5' | 'not-compiled'; error: string }

export async function openRuntimeSession(options: OpenSessionOptions): Promise<OpenSessionResult> {
  const progress = options.onProgress ?? (() => undefined)

  const indexResult = await loadDebugIndex(options.projectPath, options.target)
  if (!indexResult.success) {
    return { success: false, code: 'not-compiled', error: indexResult.error }
  }
  const index = indexResult.index

  progress(`Authenticating with ${options.host}…`)
  const runtime = new RuntimeApiClient()
  const login = await runtime.login(options.host, options.username, options.password)
  if (!login.success) {
    return { success: false, code: 'auth', error: login.error ?? 'Runtime rejected the credentials' }
  }

  const token = runtime.tokens.getToken()
  /* istanbul ignore if -- a successful login always yields a token */
  if (!token) return { success: false, code: 'auth', error: 'Login succeeded but produced no token' }

  progress('Opening the debug channel…')
  const channel: DeviceDebugChannel = new WebSocketDebugTransport({
    host: options.host,
    port: RUNTIME_API_PORT,
    token,
    rejectUnauthorized: false,
  })

  try {
    await channel.connect()
  } catch (error) {
    return {
      success: false,
      code: 'connection',
      error: `Could not open the debug channel: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let endian: TargetEndian = 'le'
  let targetMd5: string | null = null
  try {
    const probe = await channel.getMd5Hash()
    targetMd5 = probe.md5
    endian = probe.targetEndian
  } catch (error) {
    channel.disconnect()
    // The debug surface only answers for a program that is actually scanning, so
    // the usual cause is a stopped PLC — and on hardware with a mode switch the
    // user cannot fix that from here. Asking the runtime turns an opaque
    // `Unknown error code: 0x83` into the one sentence that resolves it.
    const status = await runtime.getStatus(options.host)
    const reason = describeStoppedTarget(status)
    return {
      success: false,
      code: 'connection',
      error:
        reason ??
        `The target did not answer the program MD5 probe: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!md5Matches(targetMd5, index.md5)) {
    const uploaded = options.onMd5Mismatch ? await options.onMd5Mismatch({ targetMd5, localMd5: index.md5 }) : false
    if (!uploaded) {
      channel.disconnect()
      return {
        success: false,
        code: 'md5',
        error:
          `The target is running a different program (target ${targetMd5 ?? 'unknown'}, ` +
          `local ${index.md5}). Pass --upload-if-needed to flash the local build first.`,
      }
    }
    // Re-verify rather than trust the upload: the runtime restarts the program
    // asynchronously, and reading variables against a stale map is silent
    // corruption, not an error.
    progress('Re-verifying the program MD5 after upload…')
    const reverified = await reverifyMd5(channel, index.md5)
    if (!reverified.ok) {
      channel.disconnect()
      return { success: false, code: 'md5', error: reverified.error }
    }
    targetMd5 = reverified.md5
  }

  const core = new SessionCore({
    sessionId: options.sessionId,
    projectPath: options.projectPath,
    target: options.target,
    transport: 'websocket',
    descriptor: `websocket ${options.host}`,
    channel,
    index,
    plc: restPlcControl(runtime, options.host),
    programMd5: targetMd5,
    endian,
    batchSize: DEBUG_MEDIUM_PROFILE.websocket.batchSize,
  })

  return { success: true, core, runtime, programMd5: targetMd5 }
}

function md5Matches(targetMd5: string | null, localMd5: string): boolean {
  if (!targetMd5 || !localMd5) return false
  return targetMd5.toLowerCase() === localMd5.toLowerCase()
}

/** Poll the MD5 for a short window after an upload, since the restart is async. */
async function reverifyMd5(
  channel: DeviceDebugChannel,
  expected: string,
): Promise<{ ok: true; md5: string } | { ok: false; error: string }> {
  const deadline = Date.now() + 30_000
  let last: string | null = null
  while (Date.now() < deadline) {
    try {
      const probe = await channel.getMd5Hash()
      last = probe.md5
      if (md5Matches(probe.md5, expected)) return { ok: true, md5: probe.md5 }
    } catch {
      // The debug socket drops while the runtime reloads the program; keep
      // trying until the deadline rather than treating the first gap as fatal.
    }
    await sleep(1000)
  }
  return {
    ok: false,
    error: `Uploaded, but the target still reports a different program (target ${last ?? 'unknown'}, local ${expected})`,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Why a target with no debug surface is unreachable, when the runtime can say.
 *
 * Returns undefined when the PLC looks fine, so the caller keeps the original
 * transport error rather than replacing a real fault with a guess.
 */
function describeStoppedTarget(status: {
  success: boolean
  status?: string
  switchPosition?: string
}): string | undefined {
  if (!status.success) return undefined
  const running = (status.status ?? '').toUpperCase().includes('RUNNING')
  if (running) return undefined
  if ((status.switchPosition ?? '').toLowerCase() === 'stop') {
    return (
      'The PLC is stopped and its physical mode switch is in STOP, so no program is scanning and ' +
      'the debug interface has nothing to serve. Move the switch to RUN, then retry.'
    )
  }
  return (
    'The PLC is stopped, so no program is scanning and the debug interface has nothing to serve. ' +
    'Start it (`openplc debug start`, or the runtime UI) and retry.'
  )
}
