/**
 * Commercial licence of the connected target: a runtime, or a built-in board.
 *
 * `useRuntimeCommercialLicenseOwner` is mounted ONCE, next to the runtime
 * polling. On every runtime connect it reads the runtime's hardware ID and,
 * where the platform delivers licences, fetches the ones Edge holds for it and
 * uploads them. On every board connect (simulator excluded) whose VPP is `user`
 * it runs the board licence flow for the runtime product: read the board ID and
 * the stored licence, verify it, and recover it from Edge when missing. It
 * resolves the status from the board's `runtimeLicense`, the VPP licence state
 * and the runtime licence found, stores it, and opens the disclaimer dialog for
 * an unlicensed target.
 *
 * `useRuntimeCommercialLicense` is what the views read: the stored status and
 * the buy action. Nothing here blocks build, upload, start or debug.
 */
import type { DeviceLicenseState } from '@root/middleware/shared/ports/device-port'
import type { RuntimeLicenseMode } from '@root/middleware/shared/ports/types'
import { useDevice, usePackages, useRuntime, useSystem } from '@root/middleware/shared/providers/platform-context'
import {
  buildRuntimeLicenseBuyUrl,
  COMMERCIAL_LICENSE_DISCLAIMER,
  resolveTargetCommercialLicense,
  RUNTIME_LICENSE_PRODUCT_ID,
  type RuntimeCommercialLicense,
  type TargetCommercialLicenseStatus,
} from '@root/middleware/shared/utils/licensing'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'
import { isOpenPLCRuntimeTarget, isSimulatorTarget } from '../utils/device'
import { buildLicenseBuyUrl } from '../utils/license-buy-url'

/** How often a purchase started here is checked for, and for how long. */
const PURCHASE_POLL_INTERVAL_MS = 20_000
const PURCHASE_WATCH_WINDOW_MS = 10 * 60_000

/** Runtime licence a built-in board holds, from the board licence flow's outcome; null when not known. */
export function boardRuntimeLicense(outcome: DeviceLicenseState): RuntimeCommercialLicense | null {
  if (outcome.state === 'licensed') return 'commercial'
  if (outcome.state === 'unlicensed' || outcome.state === 'unsupported') return 'gpl'
  return null
}

export interface RuntimeCommercialLicenseView {
  /** Null while no runtime target or built-in board is connected. */
  status: TargetCommercialLicenseStatus | null
  /** Hardware ID of a connected runtime, else the device ID of a connected built-in board. */
  hardwareId: string | null
  /** Label for `hardwareId`. */
  idLabel: 'Hardware ID' | 'Device ID'
  /** Purchase page for this ID, or null when the ID is unknown. */
  buyUrl: string | null
  /** Opens the purchase page and watches for the licence to arrive. */
  buy: () => Promise<void>
  awaitingPurchase: boolean
  /** True while the licence check that runs on connect has not finished. */
  checking: boolean
}

/**
 * Commercial licence status of the connected runtime or built-in board. A board's delivery waits for its
 * VPP manifest; the no-licence dialog shows once per runtime connection and once per board until restart;
 * a purchase is watched until the licence reaches the target.
 */
export function useRuntimeCommercialLicense(): RuntimeCommercialLicenseView {
  const system = useSystem()
  const status = useOpenPLCStore((state) => state.runtimeCommercialLicense.status)
  const runtimeHardwareId = useOpenPLCStore((state) => state.runtimeCommercialLicense.hardwareId)
  const boardDeviceId = useOpenPLCStore((state) => state.runtimeCommercialLicense.boardDeviceId)
  const awaitingPurchaseUntil = useOpenPLCStore((state) => state.runtimeCommercialLicense.awaitingPurchaseUntil)
  const checking = useOpenPLCStore((state) => state.runtimeCommercialLicense.checking)
  const setPurchaseWatch = useOpenPLCStore((state) => state.deviceActions.setRuntimeLicensePurchaseWatch)

  const hardwareId = runtimeHardwareId ?? boardDeviceId
  const idLabel = runtimeHardwareId === null && boardDeviceId !== null ? 'Device ID' : 'Hardware ID'
  const buyUrl = useMemo(() => {
    const baseUrl = system.getEdgeFrontendUrl()
    if (runtimeHardwareId) return buildRuntimeLicenseBuyUrl(baseUrl, runtimeHardwareId)
    if (boardDeviceId)
      return buildLicenseBuyUrl({ baseUrl, vppId: RUNTIME_LICENSE_PRODUCT_ID, deviceId: boardDeviceId })
    return null
  }, [system, runtimeHardwareId, boardDeviceId])

  const buy = useCallback(async () => {
    if (!buyUrl) return
    const { success } = await system.openExternalLink(buyUrl)
    if (success) setPurchaseWatch(Date.now() + PURCHASE_WATCH_WINDOW_MS)
  }, [buyUrl, setPurchaseWatch, system])

  return useMemo(
    () => ({ status, hardwareId, idLabel, buyUrl, buy, awaitingPurchase: awaitingPurchaseUntil !== null, checking }),
    [status, hardwareId, idLabel, buyUrl, buy, awaitingPurchaseUntil, checking],
  )
}

export function useRuntimeCommercialLicenseOwner(): void {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const device = useDevice()
  const packages = usePackages()
  const { buy } = useRuntimeCommercialLicense()

  const runtimeConnected = useOpenPLCStore(
    (state) => state.runtimeConnection.connectionStatus === 'connected' && state.runtimeConnection.jwtToken !== null,
  )
  const boardInfo = useOpenPLCStore((state) =>
    state.deviceAvailableOptions.availableBoards.get(state.deviceDefinitions.configuration.deviceBoard),
  )
  const isBoardTarget = !!boardInfo && !isOpenPLCRuntimeTarget(boardInfo) && !isSimulatorTarget(boardInfo)
  const linkConnected = useOpenPLCStore(
    (state) => state.deviceConnection.status === 'connected' && state.deviceConnection.transport !== null,
  )
  const target: 'runtime' | 'board' | null = runtimeConnected
    ? 'runtime'
    : linkConnected && isBoardTarget
      ? 'board'
      : null
  const connected = target !== null
  const runtimeLicense = useOpenPLCStore((state) => state.runtimeConnection.license)
  const boardLicense = useOpenPLCStore((state) => state.runtimeCommercialLicense.boardLicense)
  const packageId = boardInfo?.vpp?.packageId
  const vppLicense = useOpenPLCStore((state) => state.deviceLicense.report?.outcome ?? null)
  const runtimeHardwareId = useOpenPLCStore((state) => state.runtimeCommercialLicense.hardwareId)
  const boardDeviceId = useOpenPLCStore((state) => state.runtimeCommercialLicense.boardDeviceId)
  const hardwareId = target === 'board' ? boardDeviceId : runtimeHardwareId
  const status = useOpenPLCStore((state) => state.runtimeCommercialLicense.status)
  const awaitingPurchaseUntil = useOpenPLCStore((state) => state.runtimeCommercialLicense.awaitingPurchaseUntil)

  // Null while the manifest is being read, so a vendor board never flashes as unlicensed.
  const [mode, setMode] = useState<RuntimeLicenseMode | null>(null)
  useEffect(() => {
    if (!packageId || !packages) {
      setMode('user')
      return
    }
    let cancelled = false
    setMode(null)
    packages
      .getManifest(packageId)
      .then((manifest) => {
        if (!cancelled) setMode(manifest?.package.runtimeLicense ?? 'user')
      })
      .catch(() => {
        if (!cancelled) setMode('user')
      })
    return () => {
      cancelled = true
    }
  }, [packageId, packages])

  const deliverToBoard = useCallback(async () => {
    const { deviceActions, consoleActions } = store.getState()
    if (mode !== 'user' || !device.refreshLicense) {
      deviceActions.setBoardRuntimeLicense({ deviceId: null, license: null })
      return
    }
    const report = await device.refreshLicense({ packageId: RUNTIME_LICENSE_PRODUCT_ID })
    const { outcome } = report
    deviceActions.setBoardRuntimeLicense({ deviceId: report.deviceId ?? null, license: boardRuntimeLicense(outcome) })
    if (outcome.state === 'check-failed') {
      consoleActions.addLog({ level: 'debug', message: `Runtime license check skipped: ${outcome.error}` })
    } else if (outcome.state === 'unlicensed' && outcome.detail) {
      consoleActions.addLog({ level: 'debug', message: `Runtime license not confirmed: ${outcome.detail}` })
    } else if (outcome.state === 'licensed' && outcome.how === 'activated') {
      consoleActions.addLog({ level: 'info', message: 'Commercial runtime license installed on the board.' })
    }
  }, [device, mode, store])

  const deliverToRuntime = useCallback(async () => {
    const { deviceActions, consoleActions } = store.getState()
    const id = await runtime.getHardwareId?.()
    deviceActions.setRuntimeHardwareId(id?.success ? id.hardwareId : null)

    const result = await runtime.syncRuntimeLicenses?.()
    if (!result) return
    if (result.status === 'failed') {
      consoleActions.addLog({ level: 'debug', message: `Runtime license check skipped: ${result.error}` })
      return
    }
    if (result.status !== 'synced') return
    if (result.uploads.some((upload) => upload.stored)) {
      const status = await runtime.getStatus()
      if (status.success) deviceActions.setRuntimeLicense(status.license ?? null)
    }
    for (const upload of result.uploads) {
      consoleActions.addLog(
        upload.stored
          ? { level: 'info', message: `Commercial runtime license ${upload.orderId} installed on the target.` }
          : {
              level: 'debug',
              message: `Runtime license ${upload.orderId} not installed: ${upload.error ?? 'refused'}`,
            },
      )
    }
  }, [runtime, store])

  const deliverRef = useRef(deliverToRuntime)
  deliverRef.current = target === 'board' ? deliverToBoard : deliverToRuntime

  const deliveryKey =
    target === 'runtime' ? 'runtime' : target === 'board' && mode !== null ? `board:${packageId ?? ''}:${mode}` : null

  // The dialog waits for this connection's delivery, so a licence still on its way never shows as GPLv3.
  const [delivered, setDelivered] = useState(false)
  useEffect(() => {
    const { deviceActions } = store.getState()
    setDelivered(false)
    if (deliveryKey === null) {
      deviceActions.setRuntimeHardwareId(null)
      deviceActions.setBoardRuntimeLicense({ deviceId: null, license: null })
      deviceActions.setRuntimeLicenseChecking(false)
      return
    }
    let cancelled = false
    deviceActions.setRuntimeLicenseChecking(true)
    void deliverRef.current().finally(() => {
      if (cancelled) return
      setDelivered(true)
      store.getState().deviceActions.setRuntimeLicenseChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [deliveryKey, store])

  const resolved =
    connected && mode !== null
      ? resolveTargetCommercialLicense({
          mode,
          vppLicense,
          runtimeLicense: target === 'board' ? boardLicense : runtimeLicense,
        })
      : null
  useEffect(() => {
    if (store.getState().runtimeCommercialLicense.status !== resolved) {
      store.getState().deviceActions.setRuntimeCommercialLicenseStatus(resolved)
    }
  }, [resolved, store])

  const shownForRef = useRef<string | null>(null)
  const boardsShownRef = useRef(new Set<string>())
  useEffect(() => {
    if (!runtimeConnected) shownForRef.current = null
  }, [runtimeConnected])
  useEffect(() => {
    if (!delivered || status !== 'unlicensed' || !hardwareId) return
    if (target === 'board' ? boardsShownRef.current.has(hardwareId) : shownForRef.current === hardwareId) return
    const { runtimeCommercialLicense, modalActions, deviceActions } = store.getState()
    if (runtimeCommercialLicense.dismissedDisclaimers.includes(hardwareId)) return
    if (target === 'board') boardsShownRef.current.add(hardwareId)
    else shownForRef.current = hardwareId
    modalActions.openModal('debugger-message', {
      type: 'warning',
      title: 'No commercial license',
      message: COMMERCIAL_LICENSE_DISCLAIMER,
      buttons: ['Buy licences', 'Dismiss'],
      primaryButtonIndex: 0,
      dismissButtonIndex: 1,
      onResponse: (index: number) => {
        if (index === 0) void buy()
        else deviceActions.dismissRuntimeLicenseDisclaimer(hardwareId)
      },
    })
  }, [delivered, status, hardwareId, target, buy, store])

  useEffect(() => {
    if (awaitingPurchaseUntil === null) return
    if (status === 'licensed' || !connected) {
      store.getState().deviceActions.setRuntimeLicensePurchaseWatch(null)
      return
    }
    const tick = () => {
      if (Date.now() >= awaitingPurchaseUntil) {
        store.getState().deviceActions.setRuntimeLicensePurchaseWatch(null)
        return
      }
      void deliverRef.current()
    }
    const timer = setInterval(tick, PURCHASE_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [awaitingPurchaseUntil, status, connected, store])
}
