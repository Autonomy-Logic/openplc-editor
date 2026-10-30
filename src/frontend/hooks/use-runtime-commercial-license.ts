/**
 * Commercial licence of the connected runtime target.
 *
 * `useRuntimeCommercialLicenseOwner` is mounted ONCE, next to the runtime
 * polling. On every connect it reads the runtime's hardware ID and, where the
 * platform delivers licences, fetches the ones Edge holds for it and uploads
 * them. It resolves the status from the board's `runtimeLicense`, the VPP
 * licence state and the `license` the runtime polls report, stores it, and
 * opens the disclaimer dialog for an unlicensed target.
 *
 * `useRuntimeCommercialLicense` is what the views read: the stored status and
 * the buy action. Nothing here blocks build, upload, start or debug.
 */
import type { RuntimeLicenseMode } from '@root/middleware/shared/ports/types'
import { usePackages, useRuntime, useSystem } from '@root/middleware/shared/providers/platform-context'
import {
  buildRuntimeLicenseBuyUrl,
  COMMERCIAL_LICENSE_DISCLAIMER,
  resolveTargetCommercialLicense,
  type TargetCommercialLicenseStatus,
} from '@root/middleware/shared/utils/licensing'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useOpenPLCStore, useOpenPLCStoreApi } from '../store'

/** How often a purchase started here is checked for, and for how long. */
const PURCHASE_POLL_INTERVAL_MS = 20_000
const PURCHASE_WATCH_WINDOW_MS = 10 * 60_000

export interface RuntimeCommercialLicenseView {
  /** Null while no runtime target is connected. */
  status: TargetCommercialLicenseStatus | null
  hardwareId: string | null
  /** Purchase page for this hardware ID, or null when the ID is unknown. */
  buyUrl: string | null
  /** Opens the purchase page and watches for the licence to arrive. */
  buy: () => Promise<void>
  awaitingPurchase: boolean
}

export function useRuntimeCommercialLicense(): RuntimeCommercialLicenseView {
  const system = useSystem()
  const status = useOpenPLCStore((state) => state.runtimeCommercialLicense.status)
  const hardwareId = useOpenPLCStore((state) => state.runtimeCommercialLicense.hardwareId)
  const awaitingPurchaseUntil = useOpenPLCStore((state) => state.runtimeCommercialLicense.awaitingPurchaseUntil)
  const setPurchaseWatch = useOpenPLCStore((state) => state.deviceActions.setRuntimeLicensePurchaseWatch)

  const buyUrl = useMemo(() => buildRuntimeLicenseBuyUrl(system.getEdgeFrontendUrl(), hardwareId), [system, hardwareId])

  const buy = useCallback(async () => {
    if (!buyUrl) return
    const { success } = await system.openExternalLink(buyUrl)
    if (success) setPurchaseWatch(Date.now() + PURCHASE_WATCH_WINDOW_MS)
  }, [buyUrl, setPurchaseWatch, system])

  return useMemo(
    () => ({ status, hardwareId, buyUrl, buy, awaitingPurchase: awaitingPurchaseUntil !== null }),
    [status, hardwareId, buyUrl, buy, awaitingPurchaseUntil],
  )
}

export function useRuntimeCommercialLicenseOwner(): void {
  const store = useOpenPLCStoreApi()
  const runtime = useRuntime()
  const packages = usePackages()
  const { buy } = useRuntimeCommercialLicense()

  const connected = useOpenPLCStore(
    (state) => state.runtimeConnection.connectionStatus === 'connected' && state.runtimeConnection.jwtToken !== null,
  )
  const runtimeLicense = useOpenPLCStore((state) => state.runtimeConnection.license)
  const packageId = useOpenPLCStore(
    (state) =>
      state.deviceAvailableOptions.availableBoards.get(state.deviceDefinitions.configuration.deviceBoard)?.vpp
        ?.packageId,
  )
  const vppLicense = useOpenPLCStore((state) => state.deviceLicense.report?.outcome ?? null)
  const hardwareId = useOpenPLCStore((state) => state.runtimeCommercialLicense.hardwareId)
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

  const deliver = useCallback(async () => {
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

  const deliverRef = useRef(deliver)
  deliverRef.current = deliver

  // The dialog waits for this connection's delivery, so a licence still on its way never shows as GPLv3.
  const [delivered, setDelivered] = useState(false)
  useEffect(() => {
    const { deviceActions } = store.getState()
    setDelivered(false)
    if (!connected) {
      deviceActions.setRuntimeHardwareId(null)
      return
    }
    let cancelled = false
    void deliverRef.current().finally(() => {
      if (!cancelled) setDelivered(true)
    })
    return () => {
      cancelled = true
    }
  }, [connected, store])

  const resolved =
    connected && mode !== null ? resolveTargetCommercialLicense({ mode, vppLicense, runtimeLicense }) : null
  useEffect(() => {
    if (store.getState().runtimeCommercialLicense.status !== resolved) {
      store.getState().deviceActions.setRuntimeCommercialLicenseStatus(resolved)
    }
  }, [resolved, store])

  // Once per connection and device; a dismissal holds until the editor restarts.
  const shownForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!connected) shownForRef.current = null
  }, [connected])
  useEffect(() => {
    if (!delivered || status !== 'unlicensed' || !hardwareId || shownForRef.current === hardwareId) return
    const { runtimeCommercialLicense, modalActions, deviceActions } = store.getState()
    if (runtimeCommercialLicense.dismissedDisclaimers.includes(hardwareId)) return
    shownForRef.current = hardwareId
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
  }, [delivered, status, hardwareId, buy, store])

  // A purchase made in the browser reaches the runtime without another connect.
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
