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
import { useOpenPLCStore } from '../store'

export const useDeviceConnectionMonitor = (): void => {
  const device = useDevice()
  const setDeviceConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setDeviceConnectionStatus)
  const clearDeviceProbe = useOpenPLCStore((state) => state.deviceActions.clearDeviceProbe)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)

  useEffect(() => {
    return device.onConnectionStatus(({ status, descriptor, transport, reason }) => {
      setDeviceConnectionStatus(status, descriptor ?? null)

      // A dropped link means the device screen no longer describes a live device.
      // 'connecting' is deliberately NOT included: during recovery the probe
      // result (FULL/DEMO badge, device id) still describes this device, and
      // clearing it would make the badge flicker on every cable glitch.
      if (status === 'disconnected' || status === 'error') clearDeviceProbe()

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
  }, [device, setDeviceConnectionStatus, clearDeviceProbe, openModal])
}
