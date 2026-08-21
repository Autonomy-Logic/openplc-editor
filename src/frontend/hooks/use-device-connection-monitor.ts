/**
 * useDeviceConnectionMonitor — mirrors the held baremetal serial link into the
 * store, and warns when it is lost for good.
 *
 * This is a WORKSPACE-level concern, not a device-screen one. The link outlives
 * the screen that opened it: an upload, a debug session and the Start/Stop button
 * all depend on `deviceConnection.status` being true. Subscribing inside the
 * device screen left the store reading 'connected' after the cable was pulled
 * whenever the user happened to be editing a POU, so every request timed out
 * against a link the UI still advertised as up.
 *
 * The main process owns the state machine (liveness poll -> reopen attempts ->
 * give up); this hook only reflects it. A cable pulled and plugged back in shows
 * up as connected -> connecting -> connected with nothing to click. The warning
 * fires only on `reason: 'lost'`, i.e. recovery gave up — an 'error' raised by
 * something the user just clicked already has its own dialog, and warning twice
 * for one click is worse than not warning at all.
 *
 * Mount once at the workspace level, next to `useDevicePlcState`.
 */
import { useEffect } from 'react'

import { useDevice } from '../../middleware/shared/providers'
import { resolveRuntimeDebugChannel } from '../services/device-link-resolution'
import { useOpenPLCStore } from '../store'

/**
 * Keep the main process's session in step with a Runtime v3/v4 login.
 *
 * A runtime target is CONTROLLED over REST, which is connectionless — logging in
 * is what establishes its session. This mirrors that: when the runtime connection
 * comes up, tell the manager where control lives and how this target debugs; when
 * it goes down, close the session. The debug channel itself is not opened here —
 * the debugger asks for it when it needs it.
 *
 * The debug channel is DESCRIBED by resolving the board's spec (in the resolution
 * service, which owns spec interpretation) — legitimate at session-establishment
 * time. No command ever resolves anything.
 */
const useRuntimeSession = (): void => {
  const device = useDevice()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)

  useEffect(() => {
    if (!device.openRuntimeSession) return

    if (connectionStatus !== 'connected') {
      void device.closeRuntimeSession?.()
      return
    }

    const store = useOpenPLCStore.getState()
    const boardTarget = store.deviceDefinitions.configuration.deviceBoard
    const boardInfo = store.deviceAvailableOptions.availableBoards.get(boardTarget)
    const address = store.runtimeConnection.ipAddress

    // Every early return says why. Returning quietly is what let a runtime target
    // end up with no session at all while the UI showed it connected, so that every
    // command answered "not connected" on a target the user had just uploaded to.
    if (!address) {
      store.consoleActions.addLog({
        level: 'warning',
        message: '[connection] runtime is connected but has no address recorded; no session opened',
      })
      return
    }
    const debugChannel = resolveRuntimeDebugChannel(boardTarget, boardInfo)
    if (!debugChannel) {
      store.consoleActions.addLog({
        level: 'warning',
        message: `[connection] no debug channel could be described for ${boardTarget}; debugging will not be available`,
      })
      return
    }

    void device.openRuntimeSession({ address, debug: debugChannel }).then((result) => {
      if (!result.success) {
        store.consoleActions.addLog({
          level: 'error',
          message: `[connection] could not open the runtime session: ${result.error ?? 'unknown error'}`,
        })
      }
    })
    // `jwtToken` used to be a dependency so a refreshed token rebuilt the
    // session — but rebuilding CLOSES the debug channel under the debugger on
    // every refresh, and it is redundant now: the main-side candidate reads the
    // token manager at create() time and pushes renewals to a held channel via
    // reauth (review 2026-08-20, R1/E2).
  }, [device, connectionStatus])
}

export const useDeviceConnectionMonitor = (): void => {
  useRuntimeSession()
  const device = useDevice()
  const addLog = useOpenPLCStore((state) => state.consoleActions.addLog)
  const setDeviceConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setDeviceConnectionStatus)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

  // Mirror the main process's connection trace into the console. The interesting
  // decisions (which candidate was tried, what each poll concluded, which
  // connection served a command) happen in main; without this the user watching
  // the UI sees only "connecting..." and then a failure.
  useEffect(() => {
    if (!device.onLinkLog) return
    return device.onLinkLog((message) => {
      addLog({ level: 'info', message: `[connection] ${message}` })
    })
  }, [device, addLog])

  useEffect(() => {
    return device.onConnectionStatus(({ status, descriptor, transport, debugTransport, reason }) => {
      setDeviceConnectionStatus(status, descriptor ?? null, transport ?? null, debugTransport ?? null)

      if (status === 'error' && reason === 'lost') {
        const endpoint = descriptor ?? 'the device'
        // Name the endpoint AND what to check for that transport: "the cable" is
        // useless advice for a link that was running over ethernet.
        const advice =
          transport === 'tcp'
            ? 'Check that the device is powered and reachable on the network, then Connect again.'
            : 'Check that the cable is plugged in and the port is not in use, then Connect again.'
        openModal('runtime-connection-lost', {
          label: endpoint,
          body: `The connection to ${endpoint} was lost and could not be restored. ${advice}`,
        })
      }
    })
  }, [device, setDeviceConnectionStatus, openModal])
}
