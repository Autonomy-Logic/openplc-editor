/**
 * Turning a resolved debug-channel config into something openable.
 *
 * Extracted out of `MainProcessBridge` so the headless CLI opens debug sessions
 * the same way the editor does: every transport a target can declare — Modbus
 * RTU over serial, Modbus TCP, the runtime-v4 debug WebSocket, the in-process
 * simulator — is built here, chosen from the board's declarative `debug` spec
 * rather than assumed by the caller.
 *
 * That is the whole point. The CLI briefly hardcoded the v4 WebSocket, which
 * silently made every baremetal target undebuggable from the terminal even
 * though the editor debugs them fine. Transport selection is a property of the
 * TARGET, and it already lives in data (`hals.json` / VPP manifests) plus the
 * resolver that reads it; a second opinion in a front end can only be wrong.
 */

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import type { DebugConnectionConfig } from '@root/middleware/shared/ports/types'
import { describeDebugEndpoint } from '@root/middleware/shared/utils/debug-endpoint'

import { WebSocketDebugTransport } from '../../shared/debug/websocket-debug-transport'
import { planBaudAttempts } from './device-probe'
import type { DeviceDebugCandidate, DeviceLinkCandidate } from './device-session-manager'
import { buildDeviceModbusTransport, modbusTransportKind } from './device-transport-factory'

/** The runtime's HTTPS port, shared by its REST API and its debug WebSocket. */
const RUNTIME_DEBUG_PORT = 8443

export interface DebugChannelFactoryDeps {
  /**
   * The live access token, read at channel-OPEN time.
   *
   * Not a closure over the login-time value. The token manager re-authenticates
   * transparently when the 15-minute JWT expires, and the runtime re-verifies the
   * token on every debug command (openplc-runtime#169) — so a channel opened
   * after a refresh and holding the old token is rejected on its first command,
   * taking the debug session and the licensing PDUs that ride the same WebSocket
   * with it. `config.connectionParams.jwtToken` is only the fallback for the
   * first instants, before a session exists.
   */
  getToken?: () => string | null
  /**
   * Builds the in-process serial port the simulator answers on. Injected because
   * the simulator instance belongs to whoever is hosting it — the main process
   * has one for the GUI, and a CLI session has its own.
   *
   * Omit it and simulator configs are simply not built, which is the right
   * outcome for a caller that cannot host an emulator.
   */
  createVirtualSerialPort?: () => object
}

/**
 * Turn a resolved channel config into something the link manager can try.
 * The only transport-specific step left in the flow; a config that names a
 * transport this build cannot speak is dropped rather than half-built.
 */
export function toDeviceLinkCandidates(
  configs: DebugConnectionConfig[],
  opts: { probeBaudRates?: boolean } = {},
  deps: DebugChannelFactoryDeps = {},
): DeviceLinkCandidate[] {
  const declared: DeviceLinkCandidate[] = []
  // Baud guesses go AFTER everything the project declared: a configured Modbus
  // TCP address is a better next try than a rate nobody asked for.
  const speculative: DeviceLinkCandidate[] = []

  const build = (config: DebugConnectionConfig, baudRate: number | undefined, isGuess: boolean): void => {
    const kind = modbusTransportKind(config.connectionType)
    if (kind === null) return
    const params = {
      connectionType: config.connectionType,
      port: config.connectionParams.port,
      baudRate,
      slaveId: config.connectionParams.slaveId,
      host: config.connectionParams.ipAddress,
    }
    // Only the simulator needs an in-process serial port; building one for a real
    // transport would allocate a virtual port nobody reads.
    const options =
      kind === 'simulator' && deps.createVirtualSerialPort ? { virtualSerialPort: deps.createVirtualSerialPort() } : {}
    // A simulator config with no host to run it is not buildable; dropping it
    // beats returning a candidate whose `create()` always throws.
    if (kind === 'simulator' && !deps.createVirtualSerialPort) return
    // Probe the params now so a malformed config fails resolution rather than
    // becoming a candidate that always throws on `create()`.
    if ('error' in buildDeviceModbusTransport(params, options)) return
    ;(isGuess ? speculative : declared).push({
      transport: kind,
      // The endpoint ONLY. It is matched against the OS port list and against
      // the port an upload asks to borrow, so the baud travels beside it rather
      // than inside it — decorating this string made every swept candidate match
      // no port and be skipped in 1ms.
      descriptor: describeDebugEndpoint(config),
      baudRate,
      speculative: isGuess,
      create: () => {
        const built = buildDeviceModbusTransport(params, options)
        if ('error' in built) throw new Error(built.error)
        return built.client
      },
    })
  }

  for (const config of configs) {
    // A wrong baud is the one misconfiguration that looks like healthy silence:
    // the port opens, so it is not "no response", and nothing decodes, so it
    // reads as "no firmware" — and the user gets told to reflash a board that is
    // running fine. Sweeping the rates OpenPLC is ever built with turns that dead
    // end into a connection. Serial only; a TCP address is either right or not.
    for (const attempt of planBaudAttempts(config.connectionParams.baudRate, { sweep: opts.probeBaudRates })) {
      build(config, attempt.baudRate, attempt.speculative)
    }
  }

  // The patient budget belongs to the last DECLARED endpoint, not to the last
  // candidate overall. Without this the baud sweep would silently take that
  // patience away from the configured endpoint and hand it to a guess — and a
  // board that was just flashed, still booting on the right rate, would be ruled
  // out in ~10s instead of the ~32s it sometimes needs.
  const lastDeclared = declared[declared.length - 1]
  if (lastDeclared) lastDeclared.patient = true

  return [...declared, ...speculative]
}

/**
 * Turn a resolved channel config into an openable DEBUG channel. The one place
 * that knows a WebSocket is a debug channel too.
 */
export function toDebugCandidate(
  config: DebugConnectionConfig,
  deps: DebugChannelFactoryDeps = {},
): DeviceDebugCandidate | null {
  if (config.connectionType === 'websocket') {
    const host = config.connectionParams.ipAddress
    const loginToken = config.connectionParams.jwtToken
    // Either source will do to justify BUILDING the candidate: the manager is
    // the authority on the token, so a config that carries none is still
    // openable when a session exists — and requiring the config's copy here
    // would refuse a channel whose token is merely held elsewhere.
    if (!host || !(deps.getToken?.() ?? loginToken)) return null

    /** Re-read at OPEN time — see `getToken` on the deps. */
    const resolveToken = (): string => {
      const token = deps.getToken?.() ?? loginToken
      // Reachable only if the token disappeared between building this candidate
      // and opening it (a logout, mid-session). Opening an unauthenticated
      // socket instead would fail on the runtime's first verify anyway, and
      // report it as a debug fault rather than as the auth problem it is.
      if (!token) throw new Error('No runtime access token for the debug WebSocket — log in again')
      return token
    }

    return {
      transport: 'websocket',
      // The endpoint ONLY, like the serial candidates above: every display site
      // composes `${transport} ${descriptor}` itself, so spelling the transport
      // in here printed it twice ("websocket websocket 192.168.2.4").
      descriptor: host,
      create: () =>
        new WebSocketDebugTransport({
          host,
          port: RUNTIME_DEBUG_PORT,
          // Read from the token MANAGER at open time, falling back to the token
          // the session was opened with. The manager transparently re-logins
          // with stored credentials, and the runtime re-verifies the token on
          // every command (openplc-runtime#169) — so a channel opened after a
          // refresh has to present the CURRENT token, not the one captured in
          // this closure, or the session dies on its first command. The closure
          // token only covers the first instants, before the manager has a
          // session recorded.
          token: resolveToken(),
          // The SHARED policy, not a hardcoded `false`. The REST path already
          // honours `getRuntimeHttpsOptions()`, so pinning this to `false` meant
          // an operator who tightened TLS verification for the runtime API
          // silently kept an unverified debug socket to the same device.
          rejectUnauthorized: getRuntimeHttpsOptions().rejectUnauthorized,
        }),
    }
  }
  // One config in, one candidate out: this builds the DEBUG channel for a
  // session that already exists, so the rate is settled and guessing is wrong.
  const [candidate] = toDeviceLinkCandidates([config], { probeBaudRates: false }, deps)
  if (!candidate) return null
  return {
    transport: candidate.transport,
    // Bare, for the same reason as above and as the link candidates it is built
    // from: the transport is a separate field, and every caller that shows it
    // pairs the two itself.
    descriptor: candidate.descriptor,
    create: candidate.create,
  }
}
