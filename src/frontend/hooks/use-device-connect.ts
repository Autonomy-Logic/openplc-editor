/**
 * useDeviceConnect (D72) — the persistent CONNECT for USB device screens.
 *
 * "Connect" opens the device channel and — unlike the earlier transient probe —
 * the main process HOLDS the link open (a liveness poll keeps it honest, the
 * port yields to upload/debug and reconnects afterwards). This hook drives that
 * toggle and the follow-up UX from the initial classification:
 *
 *   - no-response          → channel wouldn't open (wrong port / busy) → error dialog.
 *   - no-firmware          → opened, but nothing spoke the debug protocol → offer to
 *                            Build & Upload (flash) the firmware, then reconnect.
 *   - connected-with-firmware → link held.
 *
 * Live link state (`deviceConnection.status`) is pushed from the main process.
 */
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { describeDebugEndpoint } from '@root/middleware/shared/utils/debug-endpoint'
import { useCallback } from 'react'

import { resolveDeviceLinkWithUx } from '../services/device-link-resolution'
import { useOpenPLCStore } from '../store'
import { requestDeviceFlash } from '../utils/device-connect-events'
import { explainLicenseOutcome } from '../utils/license-outcome-dialog'
import { useDeviceLicense } from './use-device-license'

export interface UseDeviceConnectResult {
  /** Open + hold the link for the given board. Never throws. */
  connect: () => Promise<void>
  /** Close the held link. */
  disconnect: () => Promise<void>
  /** Live link status, mirrored from the main process. */
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** Convenience flags derived from `status`. */
  isConnecting: boolean
  isConnected: boolean
}

export function useDeviceConnect(boardInfo: BoardInfo | undefined): UseDeviceConnectResult {
  const device = useDevice()
  const openModal = useOpenPLCStore((s) => s.modalActions.openModal)
  const setDeviceConnectionStatus = useOpenPLCStore((s) => s.deviceActions.setDeviceConnectionStatus)
  const clearDeviceLicense = useOpenPLCStore((s) => s.deviceActions.clearDeviceLicense)
  const status = useOpenPLCStore((s) => s.deviceConnection.status)
  const licensing = useDeviceLicense(boardInfo)

  const connect = useCallback(async (): Promise<void> => {
    const deviceBoard = useOpenPLCStore.getState().deviceDefinitions.configuration.deviceBoard

    // FIRST PASS: everything that needs nothing from the user — serial, then
    // Modbus TCP on a static address. `deferPrompts` means a DHCP channel is set
    // aside rather than interrupting with an address dialog, because with a cable
    // attached the user should never be asked for one.
    const silent = await resolveDeviceLinkWithUx(deviceBoard, boardInfo, { deferPrompts: true })
    if (!silent) return
    if (silent.candidates.length === 0 && silent.awaitingInput.length === 0) return

    const tried: string[] = []
    setDeviceConnectionStatus('connecting', null)

    // Declared out here so the `finally` can tell "we never got a connection" from
    // "we did, and the main process has already published it".
    let result: { status: 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'; error?: string } = {
      status: 'no-response',
    }

    try {
      if (silent.candidates.length > 0) {
        tried.push(...silent.candidates.map((candidate) => describeDebugEndpoint(candidate.config)))
        result = await device.connect(silent.candidates.map((candidate) => candidate.config))
      }

      // SECOND PASS: nothing silent worked, so now it is worth asking. Resolving
      // only the deferred channels surfaces the address dialog, and a cancel here
      // ends the attempt rather than looping.
      if (result.status !== 'connected-with-firmware' && silent.awaitingInput.length > 0) {
        const prompted = await resolveDeviceLinkWithUx(deviceBoard, boardInfo, {
          onlyChannels: silent.awaitingInput,
        })
        if (prompted && prompted.candidates.length > 0) {
          tried.push(...prompted.candidates.map((candidate) => describeDebugEndpoint(candidate.config)))
          result = await device.connect(prompted.candidates.map((candidate) => candidate.config))
        } else if (tried.length === 0) {
          // The user declined to supply the address and there was nothing else to
          // try, so nothing was attempted at all. Saying "could not reach the
          // device" would be reporting a failure that never happened — they
          // cancelled. The `finally` below clears the button.
          return
        }
      }

      const endpoints = tried.join(' or ') || 'this device'

      if (result.status === 'no-response') {
        openModal('debugger-message', {
          type: 'error',
          title: 'No Response',
          message: `Could not reach the device on ${endpoints}. Check that it is powered and plugged in, and that the port or IP address is correct.`,
          buttons: ['OK'],
          onResponse: () => undefined,
        })
        return
      }

      if (result.status === 'error') {
        openModal('debugger-message', {
          type: 'error',
          title: 'Connection Error',
          message: result.error ?? 'An unexpected error occurred while connecting to the device.',
          buttons: ['OK'],
          onResponse: () => undefined,
        })
        return
      }

      if (result.status === 'no-firmware') {
        openModal('debugger-message', {
          type: 'question',
          title: 'No Firmware Detected',
          message: `No OpenPLC firmware responded on ${endpoints}. Build & Upload the program to flash this device, then Connect again.`,
          buttons: ['Build & Upload', 'Cancel'],
          onResponse: (buttonIndex: number) => {
            if (buttonIndex === 0) requestDeviceFlash()
          },
        })
        return
      }

      // The link is up and a firmware answered. If this board's VPP is sold
      // licensed, settle its licence now — over the link that is already open.
      //
      // AWAITED, not fired and forgotten: the whole flow runs on one held Modbus
      // link, and letting the connect return first invites the user to click
      // Upload or Debug into the middle of a read/write sequence. It is also why
      // this is the LAST thing connect does — a non-licensable board (the common
      // case) never reaches it, and pays nothing.
      if (licensing.isLicensable) {
        const report = await licensing.refresh()
        if (report) {
          explainLicenseOutcome(report, {
            openModal,
            buy: licensing.buy,
            // A retry re-runs the flow and explains the NEW outcome, so a
            // transient failure or a purchase completed in the browser resolves
            // without disconnecting.
            retry: async () => {
              const next = await licensing.refresh()
              if (next) explainLicenseOutcome(next, { openModal, buy: licensing.buy })
            },
          })
        }
      }
    } finally {
      // 'connecting' is set OPTIMISTICALLY above, and normally only the main process
      // clears it — every settled state is pushed from there. But a path that
      // returns without ever reaching `deviceSession.open()` leaves nothing to push:
      // a cancelled address prompt, a config that built no usable candidate, or an
      // IPC rejection. The button is disabled while 'connecting' and Disconnect only
      // fires when 'connected', so a stuck 'connecting' is not recoverable from the
      // UI at all — the user has to close and reopen the project. Settle it here.
      //
      // Only on a NON-success outcome. On success the main process has published
      // 'connected', but that push and this invoke's reply travel separate IPC
      // channels with no ordering guarantee between them, so settling here as well
      // would risk a visible flicker for no reason.
      if (
        result.status !== 'connected-with-firmware' &&
        useOpenPLCStore.getState().deviceConnection.status === 'connecting'
      ) {
        setDeviceConnectionStatus('disconnected', null)
      }
    }
  }, [boardInfo, device, licensing, openModal, setDeviceConnectionStatus])

  const disconnect = useCallback(async (): Promise<void> => {
    await device.disconnect()
    setDeviceConnectionStatus('disconnected', null)
    // A DELIBERATE disconnect is the one link event that should drop the licence
    // too: the user is done with this device, and leaving a badge behind would
    // assert possession for hardware nothing is talking to. A link that merely
    // DROPS keeps it — see `clearDeviceConnection` in the device slice.
    clearDeviceLicense()
  }, [clearDeviceLicense, device, setDeviceConnectionStatus])

  return {
    connect,
    disconnect,
    status,
    isConnecting: status === 'connecting',
    isConnected: status === 'connected',
  }
}
