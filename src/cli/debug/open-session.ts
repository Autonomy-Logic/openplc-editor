/**
 * Opening a debug session — for whatever transport the target declares.
 *
 * The channel is NOT chosen here. `resolveRuntimeDebugChannel` reads the
 * board's declarative `debug` spec (from `hals.json` or its VPP manifest) and
 * answers with a `DebugConnectionConfig`; `toDebugCandidate` builds the matching
 * channel — Modbus RTU over serial, Modbus TCP, the runtime-v4 WebSocket, or the
 * in-process simulator. Both are the editor's own, so a target the GUI can debug
 * is a target the CLI can debug, and neither has an opinion the other lacks.
 *
 * An earlier version constructed a `WebSocketDebugTransport` directly. It worked
 * against a runtime v4 and silently made every baremetal board undebuggable from
 * the terminal — the exact drift that comes from a front end deciding something
 * the target already declares.
 *
 * The MD5 gate is the other load-bearing part. The debug map addresses variables
 * by (arr, elem) positions that mean something only for the program that was
 * compiled; pointing them at a target running something else does not fail
 * loudly, it reads the WRONG VARIABLES and reports plausible numbers.
 */

import { toDebugCandidate } from '@root/backend/editor/hardware/debug-channel-factory'
import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import type { DeviceDebugChannel } from '@root/backend/shared/debug/types'
import { resolveRuntimeDebugChannel } from '@root/frontend/services/device-link-resolution'
import { openPLCStoreBase } from '@root/frontend/store'
import { DEBUG_MEDIUM_PROFILE } from '@root/frontend/utils/debug-medium-profile'
import type { TargetEndian } from '@root/frontend/utils/endian'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { channelPlcControl, restPlcControl, SessionCore } from '../session/session-core'
import { disconnectAndWait } from './close-channel'
import { loadDebugIndex } from './variables'

export interface OpenSessionOptions {
  sessionId: string
  projectPath: string
  target: string
  /** Runtime address. Optional: a baremetal target needs none. */
  host?: string
  username?: string
  password?: string
  onProgress?: (message: string) => void
}

export type OpenSessionResult =
  | { success: true; core: SessionCore; programMd5: string | null }
  | { success: false; code: 'auth' | 'connection' | 'md5' | 'not-compiled' | 'unsupported'; error: string }

export async function openDebugSession(options: OpenSessionOptions): Promise<OpenSessionResult> {
  const progress = options.onProgress ?? (() => undefined)

  const indexResult = await loadDebugIndex(options.projectPath, options.target)
  if (!indexResult.success) return { success: false, code: 'not-compiled', error: indexResult.error }
  const index = indexResult.index
  // The tree walk reports variables it could not resolve (unknown datatypes,
  // library FBs without externals). Silence there would look like a variable
  // that simply does not exist.
  for (const warning of index.warnings) progress(`warning: ${warning}`)

  const boards = openPLCStoreBase.getState().deviceAvailableOptions.availableBoards
  const boardInfo: BoardInfo | undefined = boards.get(options.target)
  if (!boardInfo) {
    return {
      success: false,
      code: 'unsupported',
      error: `Board "${options.target}" is not available (not in hals.json, and no installed VPP package declares it)`,
    }
  }

  const capabilities = resolveTargetCapabilities(boardInfo)

  // Targets controlled over REST need an authenticated session before the debug
  // spec can even resolve: its preconditions include `runtimeConnected` and
  // `jwtToken`, which is how the resolver knows a v4 WebSocket is reachable.
  let runtime: RuntimeApiClient | null = null
  // `directUsbUpload` is the editor's own discriminator between a board it
  // flashes over USB and a target it reaches through a runtime API — the same
  // check the build flow's stop-PLC gate uses.
  if (!capabilities.directUsbUpload && !capabilities.isInProcessSimulator) {
    if (!options.host || !options.username || !options.password) {
      return {
        success: false,
        code: 'auth',
        error: `Target "${options.target}" is controlled over its runtime API — pass --host and credentials`,
      }
    }
    progress(`Authenticating with ${options.host}…`)
    runtime = new RuntimeApiClient()
    const login = await runtime.login(options.host, options.username, options.password)
    if (!login.success) {
      return { success: false, code: 'auth', error: login.error ?? 'The runtime rejected the credentials' }
    }
    // The same store updates the login modal makes, because the resolver reads
    // the connection state from the store rather than being told.
    const deviceActions = openPLCStoreBase.getState().deviceActions
    deviceActions.setRuntimeJwtToken(login.accessToken ?? '')
    deviceActions.setRuntimeConnectionStatus('connected')
    deviceActions.setStoredCredentials({ username: options.username, password: options.password })
  }

  progress('Resolving the debug channel from the target’s spec…')
  const config = resolveRuntimeDebugChannel(options.target, boardInfo)
  if (!config) {
    return {
      success: false,
      code: 'unsupported',
      error: `Could not resolve a debug channel for "${options.target}" — the target declares none this build can open`,
    }
  }

  const candidate = toDebugCandidate(config)
  if (!candidate) {
    return {
      success: false,
      code: 'unsupported',
      error: `The debug channel "${config.connectionType}" for "${options.target}" cannot be opened headlessly`,
    }
  }

  progress(`Opening the debug channel (${candidate.descriptor})…`)
  const channel: DeviceDebugChannel = candidate.create()
  try {
    await channel.connect()
  } catch (error) {
    return {
      success: false,
      code: 'connection',
      error: `Could not open ${candidate.descriptor}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let endian: TargetEndian = 'le'
  let targetMd5: string | null = null
  try {
    const probe = await channel.getMd5Hash()
    targetMd5 = probe.md5
    endian = probe.targetEndian
  } catch (error) {
    await disconnectAndWait(channel)
    // The debug surface only answers for a program that is scanning, so the
    // usual cause is a stopped PLC — which the transport error never says.
    const stopped = runtime && options.host ? await describeStoppedTarget(runtime, options.host) : undefined
    return {
      success: false,
      code: 'connection',
      error:
        stopped ??
        `The target did not answer the program MD5 probe over ${candidate.descriptor}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    }
  }

  if (!md5Matches(targetMd5, index.md5)) {
    await disconnectAndWait(channel)
    return {
      success: false,
      code: 'md5',
      error:
        `The target is running a different program (target ${targetMd5 ?? 'unknown'}, local ${index.md5}). ` +
        'Pass --upload-if-needed to flash the local build first.',
    }
  }

  const core = new SessionCore({
    sessionId: options.sessionId,
    projectPath: options.projectPath,
    target: options.target,
    transport: candidate.transport,
    descriptor: candidate.descriptor,
    channel,
    index,
    // Run/stop follows the target: a runtime drives it over REST, a baremetal
    // board answers it on the debug channel itself (FC 0x4b).
    plc: runtime && options.host ? restPlcControl(runtime, options.host) : channelPlcControl(channel),
    programMd5: targetMd5,
    endian,
    // Batch size is a property of the medium's frame budget, from the shared table.
    batchSize: DEBUG_MEDIUM_PROFILE[candidate.transport].batchSize,
  })

  return { success: true, core, programMd5: targetMd5 }
}

function md5Matches(targetMd5: string | null, localMd5: string): boolean {
  if (!targetMd5 || !localMd5) return false
  return targetMd5.toLowerCase() === localMd5.toLowerCase()
}

/** Why a target with no debug surface is unreachable, when the runtime can say. */
async function describeStoppedTarget(runtime: RuntimeApiClient, host: string): Promise<string | undefined> {
  const status = await runtime.getStatus(host)
  if (!status.success) return undefined
  if ((status.status ?? '').toUpperCase().includes('RUNNING')) return undefined
  if ((status.switchPosition ?? '').toLowerCase() === 'stop') {
    return (
      'The PLC is stopped and its physical mode switch is in STOP, so no program is scanning and ' +
      'the debug interface has nothing to serve. Move the switch to RUN, then retry.'
    )
  }
  return (
    'The PLC is stopped, so no program is scanning and the debug interface has nothing to serve. ' +
    'Start it (`openplc-cli debug start`) and retry.'
  )
}
