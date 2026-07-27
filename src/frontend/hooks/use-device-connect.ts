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

/**
 * Where "Buy License" sends the user (Q-F). Stub for now — the real Edge
 * checkout is the other team's (D68a).
 */
const EDGE_BUY_URL = 'https://autonomylogic.com/store'

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
  const status = useOpenPLCStore((s) => s.serialConnection.status)

  // Mirror main-process link status (liveness failure, upload/debug handoff).
  useEffect(() => {
    return device.onConnectionStatus(({ status: next, port }) => {
      setSerialConnectionStatus(next, port)
      // A dropped link means the device screen no longer describes a live device.
      if (next === 'disconnected' || next === 'error') clearDeviceProbe()
    })
  }, [device, setSerialConnectionStatus, clearDeviceProbe])

  const buyLicense = useCallback((): void => {
    void system.openExternalLink(EDGE_BUY_URL)
  }, [system])

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
    setDeviceProbeResult({ status: result.status, anchorHex: result.anchorHex, licenseStatus: result.licenseStatus })

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
   * result in the FULL/DEMO badge. A runtime that doesn't answer the license FCs
   * (plugin not loaded yet / debugger disabled) leaves the badge cleared rather
   * than showing a misleading state (Q-B: runtime failures are connectivity).
   */
  const checkRuntimeLicense = useCallback(async (): Promise<void> => {
    const caps = resolveTargetCapabilities(boardInfo)
    const packageId = boardInfo?.vpp?.packageId
    if (!caps.isLicensable || !packageId) return
    const rt = useOpenPLCStore.getState().runtimeConnection
    if (!rt.ipAddress || !rt.jwtToken) return
    const deviceBoard = useOpenPLCStore.getState().deviceDefinitions.configuration.deviceBoard

    startDeviceProbe()
    const act = await device.activateLicense(
      { connectionType: 'websocket', host: rt.ipAddress, token: rt.jwtToken },
      { packageId, keyId: boardInfo?.vpp?.licenseKeyId },
    )

    if (act.outcome === 'no-id' || act.outcome === 'error') {
      clearDeviceProbe()
      return
    }

    const licensed = act.outcome === 'already-licensed' || act.outcome === 'activated'
    setDeviceProbeResult({
      status: 'connected-with-firmware',
      anchorHex: act.anchorHex,
      licenseStatus: licensed ? 'licensed' : 'unlicensed',
    })

    if (act.outcome === 'demo') {
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
  }, [boardInfo, device, startDeviceProbe, setDeviceProbeResult, clearDeviceProbe, openModal, buyLicense])

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
