/**
 * useDeviceConnect (D72) — the persistent CONNECT for USB device screens.
 *
 * "Connect" opens the serial channel and — unlike the earlier transient probe —
 * the main process HOLDS the RTU link open (a liveness poll keeps it honest, the
 * port yields to upload/debug and reconnects afterwards). This hook drives that
 * toggle and the follow-up UX from the initial classification:
 *
 *   - no-response          → channel wouldn't open (wrong port / busy) → error dialog.
 *   - no-firmware          → opened, but nothing spoke the debug protocol → offer to
 *                            Build & Upload (flash) the firmware, then reconnect.
 *   - connected-with-firmware → link held. For a licensable target the recover ran
 *                            in the main process; if it landed in demo, prompt Buy /
 *                            Run in Demo.
 *
 * Live link state (`serialConnection.status`) is pushed from the main process; the
 * license classification lands in `deviceProbeInfo` for the FULL/DEMO badge.
 */
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { useDevice, useSystem } from '@root/middleware/shared/providers/platform-context'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect } from 'react'

import { type DebugResolverContext, resolveDebugConnection } from '../../backend/shared/hardware/debug-spec'
import type { DeviceConnectParams } from '../../middleware/shared/ports/device-port'
import { useOpenPLCStore } from '../store'
import { requestDeviceFlash } from '../utils/device-connect-events'
import { buildLicenseBuyUrl } from '../utils/license-buy-url'

/** Build the debug resolver context for a USB connect (serial port + baud only). */
function buildUsbResolverContext(): DebugResolverContext {
  const cfg = useOpenPLCStore.getState().deviceDefinitions.configuration
  const screens = (cfg.vendorScreenData ?? {}) as Record<string, Record<string, unknown>>
  return {
    state: {
      configuration: {
        deviceBoard: cfg.deviceBoard,
        ...(cfg.communicationPort ? { communicationPort: cfg.communicationPort } : {}),
      },
      screens,
      runtimeConnection: {},
      promptCache: {},
    },
    capabilities: { runtimeConnected: false, jwtToken: false },
  }
}

export interface UseDeviceConnectResult {
  /** Open + hold the serial link for the given board. Never throws. */
  connect: () => Promise<void>
  /** Close the held serial link. */
  disconnect: () => Promise<void>
  /** Run the license check for a runtime-v4 target over its WebSocket (F7). */
  checkRuntimeLicense: () => Promise<void>
  /** Live link status, mirrored from the main process. */
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  /** Convenience flags derived from `status`. */
  isConnecting: boolean
  isConnected: boolean
  /** Open the store where a license for this device can be purchased (Q-F). */
  buyLicense: () => void
}

export function useDeviceConnect(boardInfo: BoardInfo | undefined): UseDeviceConnectResult {
  const device = useDevice()
  const system = useSystem()
  const openModal = useOpenPLCStore((s) => s.modalActions.openModal)
  const startDeviceProbe = useOpenPLCStore((s) => s.deviceActions.startDeviceProbe)
  const setDeviceProbeResult = useOpenPLCStore((s) => s.deviceActions.setDeviceProbeResult)
  const clearDeviceProbe = useOpenPLCStore((s) => s.deviceActions.clearDeviceProbe)
  const setSerialConnectionStatus = useOpenPLCStore((s) => s.deviceActions.setSerialConnectionStatus)
  const addLog = useOpenPLCStore((s) => s.consoleActions.addLog)
  const status = useOpenPLCStore((s) => s.serialConnection.status)

  // Mirror main-process link status (liveness failure, upload/debug handoff).
  useEffect(() => {
    return device.onConnectionStatus(({ status: next, port }) => {
      setSerialConnectionStatus(next, port)
      // A dropped link means the device screen no longer describes a live device.
      if (next === 'disconnected' || next === 'error') clearDeviceProbe()
    })
  }, [device, setSerialConnectionStatus, clearDeviceProbe])

  /**
   * Send the user to the Edge purchase page FOR THIS DEVICE (D68a). The page
   * needs the VPP and the device id in the link — without them it can only show
   * "Invalid purchase link", and a purchase can't be bound to any device.
   *
   * Both ids are read at call time (not closed over): the probe result lands in
   * the store just before the demo prompt opens, and the popover's Buy button
   * fires arbitrarily later.
   */
  const buyLicense = useCallback((): void => {
    const url = buildLicenseBuyUrl({
      baseUrl: system.getEdgeFrontendUrl(),
      vppId: boardInfo?.vpp?.packageId,
      deviceId: useOpenPLCStore.getState().deviceProbeInfo.result?.deviceId,
    })
    if (!url) {
      // Better to say why than to open a page that rejects the link. Reachable
      // only if Buy is offered without a completed probe (the device id comes
      // from the hardware read), so name that as the fix.
      openModal('debugger-message', {
        type: 'error',
        title: 'Cannot Open Purchase Page',
        message:
          'The purchase page needs the Device ID, which is read from the hardware. Connect the device first, then try again.',
        buttons: ['OK'],
        onResponse: () => undefined,
      })
      return
    }
    void system.openExternalLink(url)
  }, [boardInfo, openModal, system])

  const connect = useCallback(async (): Promise<void> => {
    const caps = resolveTargetCapabilities(boardInfo)
    const deviceBoard = useOpenPLCStore.getState().deviceDefinitions.configuration.deviceBoard

    const resolved = boardInfo?.debug
      ? resolveDebugConnection(boardInfo.debug, buildUsbResolverContext(), undefined)
      : undefined
    if (!(resolved?.kind === 'config' && resolved.config.connectionType === 'rtu')) {
      openModal('debugger-message', {
        type: 'error',
        title: 'Cannot Connect',
        message: 'Select a communication port for this device first, then try Connect again.',
        buttons: ['OK'],
        onResponse: () => undefined,
      })
      return
    }

    const cp = resolved.config.connectionParams
    const params: DeviceConnectParams = {
      connectionType: 'rtu',
      port: String(cp.port),
      baudRate: cp.baudRate != null ? Number(cp.baudRate) : undefined,
      slaveId: cp.slaveId != null ? Number(cp.slaveId) : undefined,
    }

    startDeviceProbe()
    setSerialConnectionStatus('connecting', String(cp.port))
    const result = await device.connect(params, {
      isLicensable: caps.isLicensable,
      packageId: boardInfo?.vpp?.packageId,
      keyId: boardInfo?.vpp?.licenseKeyId,
    })

    // Land the classification for the badge (main already ran the recover).
    // `activation` + `error` travel with it: without them the badge cannot tell
    // a confirmed "no license" from a check that never got an answer, and the
    // main process's careful distinction dies here.
    setDeviceProbeResult({
      status: result.status,
      anchorHex: result.anchorHex,
      deviceId: result.deviceId,
      licenseStatus: result.licenseStatus,
      activation: result.activation,
      error: result.error,
    })

    if (result.status === 'no-response') {
      openModal('debugger-message', {
        type: 'error',
        title: 'No Response',
        message: `Could not open ${String(cp.port)}. Check that the device is plugged in and the correct port is selected.`,
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
        message: `No OpenPLC firmware responded on ${String(cp.port)}. Build & Upload the program to flash this device, then Connect again.`,
        buttons: ['Build & Upload', 'Cancel'],
        onResponse: (buttonIndex: number) => {
          if (buttonIndex === 0) requestDeviceFlash()
        },
      })
      return
    }

    // connected-with-firmware. The recover already ran in the main process; a
    // 'demo' outcome means the backend has no license for this device.
    if (result.activation === 'demo') {
      openModal('debugger-message', {
        type: 'warning',
        title: 'License Required',
        message: `No license was found for "${deviceBoard}". Buy a license to unlock the full version, or continue running in demo mode.`,
        buttons: ['Buy License', 'Run in Demo'],
        onResponse: (buttonIndex: number) => {
          if (buttonIndex === 0) buyLicense()
        },
      })
    }
  }, [boardInfo, device, openModal, startDeviceProbe, setDeviceProbeResult, setSerialConnectionStatus, buyLicense])

  const disconnect = useCallback(async (): Promise<void> => {
    await device.disconnect()
    setSerialConnectionStatus('disconnected', null)
    clearDeviceProbe()
  }, [device, setSerialConnectionStatus, clearDeviceProbe])

  /**
   * License check for a runtime-v4 (network) target (F7). The runtime owns its
   * own persistent connection (login + JWT + polling), so this is a transient
   * probe + recover over the debug WebSocket — not a held link. Runs the same
   * 0x48 -> derive -> backend -> 0x49 recover the serial path does and lands the
   * result in the license badge.
   *
   * What separates "clear the badge" from "show a state" (Q-B, refined): if the
   * device answered at all, whatever it said is landed — including a failed
   * check. The badge is only cleared when we never got a device-level answer
   * (no firmware on 0x48, or the transport died), because that is connectivity,
   * not a license state. Clearing on a FAILED CHECK was the bug: it made the
   * main process's error-vs-demo distinction invisible, trading a wrong prompt
   * for silence.
   */
  const checkRuntimeLicense = useCallback(async (): Promise<void> => {
    const caps = resolveTargetCapabilities(boardInfo)
    if (!caps.isLicensable) return
    const packageId = boardInfo?.vpp?.packageId
    if (!packageId) {
      // A licensable board whose VPP declares no packageId: we cannot ask the
      // backend anything, so the badge would be a guess. Nothing to show the
      // user, but it IS a packaging defect — leave a trail instead of vanishing.
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message:
          'License check skipped: this board is licensable but its VPP declares no package id. The badge cannot be determined.',
      })
      return
    }
    const rt = useOpenPLCStore.getState().runtimeConnection
    if (!rt.ipAddress || !rt.jwtToken) return
    const deviceBoard = useOpenPLCStore.getState().deviceDefinitions.configuration.deviceBoard

    startDeviceProbe()
    const act = await device.activateLicense(
      { connectionType: 'websocket', host: rt.ipAddress, token: rt.jwtToken },
      { packageId, keyId: boardInfo?.vpp?.licenseKeyId },
    )

    // No device-level answer -> connectivity, not a license state.
    if (act.outcome === 'no-id' || !act.activation) {
      clearDeviceProbe()
      return
    }

    // Land exactly what the device/backend concluded — the same fields, with the
    // same meanings, the serial path lands. This is also what makes the two
    // paths agree on `unsupported` instead of one showing "License unknown" and
    // the other showing nothing at all.
    setDeviceProbeResult({
      status: 'connected-with-firmware',
      anchorHex: act.anchorHex,
      deviceId: act.deviceId,
      licenseStatus: act.licenseStatus,
      activation: act.activation,
      error: act.error,
    })

    if (act.activation === 'demo') {
      openModal('debugger-message', {
        type: 'warning',
        title: 'License Required',
        message: `No license was found for "${deviceBoard}". Buy a license to unlock the full version, or continue running in demo mode.`,
        buttons: ['Buy License', 'Run in Demo'],
        onResponse: (buttonIndex: number) => {
          if (buttonIndex === 0) buyLicense()
        },
      })
    }
  }, [boardInfo, device, startDeviceProbe, setDeviceProbeResult, clearDeviceProbe, openModal, buyLicense, addLog])

  return {
    connect,
    disconnect,
    checkRuntimeLicense,
    status,
    isConnecting: status === 'connecting',
    isConnected: status === 'connected',
    buyLicense,
  }
}
