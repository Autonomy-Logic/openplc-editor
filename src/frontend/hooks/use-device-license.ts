/**
 * useDeviceLicense — the renderer side of the VPP licensing flow.
 *
 * Owns the five things the UI needs and nothing else:
 *   - whether licensing applies to this board at all (`isLicensable`);
 *   - the last landed report, from the store;
 *   - `check()` (read + verify, local) and `refresh()` (full flow, may reach the
 *     network and write);
 *   - `buy()`, which opens the device-bound purchase page and starts the
 *     purchase watch;
 *   - the purchase watch itself: while `awaitingPurchase`, `refresh()` runs on an
 *     interval so the licence bought in the external browser is activated and
 *     WRITTEN to the device without the user having to click anything.
 *
 * Deliberately NOT folded into `useDeviceConnect`: that hook is about resolving
 * and holding a link, this one about what the device is entitled to run. The only
 * coupling is one call after a successful connect.
 */
import type { DeviceLicenseReport } from '@root/middleware/shared/ports/device-port'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { useDevice, useSystem } from '@root/middleware/shared/providers/platform-context'
import { resolveLicensingTarget } from '@root/middleware/shared/utils/licensing'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useOpenPLCStore } from '../store'
import { buildLicenseBuyUrl } from '../utils/license-buy-url'

/**
 * Purchase-watch cadence. Each tick is one Modbus read frame plus, while the
 * backend still answers "no purchase", one cheap HTTP round-trip — light enough
 * to repeat, heavy enough not to hammer a public rate-limited route. 30 ticks
 * of 20s = a 10-minute window, generous for a checkout without leaving a
 * forgotten tab polling forever.
 */
const PURCHASE_POLL_INTERVAL_MS = 20_000
const PURCHASE_POLL_MAX_TICKS = 30

export interface UseDeviceLicenseResult {
  /** Whether the selected board's VPP participates in licensing at all. When
   *  false every other member here is inert and the UI shows nothing. */
  isLicensable: boolean
  /** Set when the manifest is broken: declares licensable with no package id. */
  configurationError: string | null
  /** The last landed report, or null before anything has run. */
  report: DeviceLicenseReport | null
  /** True while a call is in flight. */
  isChecking: boolean
  /**
   * Read + verify what the device holds. Local only, never the network.
   *
   * Returns the report as well as storing it, so a caller that must ACT on the
   * outcome (the connect flow, which prompts about demo mode) does not have to
   * read it back out of the store — a read that races the very set it follows.
   * `null` when licensing does not apply to this board.
   */
  check: () => Promise<DeviceLicenseReport | null>
  /** Full flow: read, verify, and recover from the backend when needed. */
  refresh: () => Promise<DeviceLicenseReport | null>
  /**
   * The purchase link for the report currently in the store — what the badge's
   * button uses. Null when no valid link can be built.
   */
  buyUrl: string | null
  /**
   * Open the device-bound purchase page.
   *
   * `deviceId` is a parameter, not read from the store, and that is load-bearing.
   * A caller reached straight out of a licensing call — the demo dialog the connect
   * flow opens — is holding a report the store has only just been told about, and
   * the closure it captured still sees the PREVIOUS value (null, on a first
   * connect). Taking the id explicitly is what stops "Buy Licence" from silently
   * doing nothing on the one path where it matters most.
   */
  buy: (deviceId?: string) => Promise<void>
  /**
   * True while the purchase watch is running — from `buy()` until a licensed
   * report lands, the 10-minute window closes, or `cancelPurchaseWatch`.
   */
  awaitingPurchase: boolean
  /** Stop the purchase watch without waiting for it to conclude. */
  cancelPurchaseWatch: () => void
}

export function useDeviceLicense(boardInfo: BoardInfo | undefined): UseDeviceLicenseResult {
  const device = useDevice()
  const system = useSystem()
  const startCheck = useOpenPLCStore((s) => s.deviceActions.startDeviceLicenseCheck)
  const setReport = useOpenPLCStore((s) => s.deviceActions.setDeviceLicenseReport)
  const setAwaitingPurchase = useOpenPLCStore((s) => s.deviceActions.setAwaitingPurchase)
  const phase = useOpenPLCStore((s) => s.deviceLicense.phase)
  const report = useOpenPLCStore((s) => s.deviceLicense.report)
  const awaitingPurchase = useOpenPLCStore((s) => s.deviceLicense.awaitingPurchase)

  const target = useMemo(() => resolveLicensingTarget(boardInfo), [boardInfo])

  /**
   * Run one licensing call, whichever it is.
   *
   * `startCheck` before and `setReport` after, unconditionally — an early return
   * on a non-licensable board would leave `phase: 'checking'` set forever, and the
   * UI disables its actions on that.
   */
  const run = useCallback(
    async (which: 'check' | 'refresh'): Promise<DeviceLicenseReport | null> => {
      if (!target.licensable) return null

      const call = which === 'check' ? device.readLicense : device.refreshLicense
      if (!call) {
        // A platform that holds no device link (the port declares both optional).
        // Reported rather than ignored: silence here reads as "no license".
        const report: DeviceLicenseReport = {
          outcome: { state: 'check-failed', error: 'This platform cannot check device licenses.' },
        }
        setReport(report)
        return report
      }

      startCheck()
      const request = { packageId: target.packageId }
      try {
        const report = await call(request)
        setReport(report)
        return report
      } catch (error) {
        // The IPC call itself failed. Still a report, and still `check-failed`:
        // the badge must never fall back to "not licensed" because a channel died.
        const report: DeviceLicenseReport = {
          outcome: { state: 'check-failed', error: error instanceof Error ? error.message : String(error) },
        }
        setReport(report)
        return report
      }
    },
    [device.readLicense, device.refreshLicense, setReport, startCheck, target],
  )

  const check = useCallback(() => run('check'), [run])
  const refresh = useCallback(() => run('refresh'), [run])

  const cancelPurchaseWatch = useCallback(() => setAwaitingPurchase(false), [setAwaitingPurchase])

  // End the watch the moment a licensed report lands, whoever produced it —
  // the poll below, a manual "Check again", the connect flow. Watching the
  // REPORT rather than the poll's own return value is what lets all of those
  // paths conclude the purchase.
  useEffect(() => {
    if (awaitingPurchase && report?.outcome.state === 'licensed') {
      setAwaitingPurchase(false)
    }
  }, [awaitingPurchase, report, setAwaitingPurchase])

  // The purchase watch. One `refresh()` per tick: read the device, ask the
  // backend and — on the first tick after the completion webhook lands — write
  // the blob to the device and read it back. `refresh` reports its own
  // failures as `check-failed` reports, so a flaky tick shows in the badge
  // instead of silently killing the watch.
  //
  // Called through a ref: `refresh`'s identity follows the device port and the
  // board target, and an interval keyed on it would be torn down and rebuilt
  // on every such change, resetting the tick budget each time.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!awaitingPurchase) return
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks > PURCHASE_POLL_MAX_TICKS) {
        setAwaitingPurchase(false)
        return
      }
      // A tick that would overlap an in-flight call (slow device, 30s HTTP
      // timeout) skips instead of stacking a second one on the same link.
      if (useOpenPLCStore.getState().deviceLicense.phase === 'checking') return
      void refreshRef.current()
    }, PURCHASE_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [awaitingPurchase, setAwaitingPurchase])

  /**
   * Build the purchase link for a given device id.
   *
   * A purchase must be BOUND to a device, and the id is derived main-side, so
   * there is nothing to bind to before a report has landed — hence null. The
   * builder also refuses an id the `/buy` page would reject, so a malformed one
   * yields no button rather than a dead end.
   */
  const urlFor = useCallback(
    (deviceId: string | undefined): string | null => {
      if (!target.licensable) return null
      return buildLicenseBuyUrl({ baseUrl: system.getEdgeFrontendUrl(), vppId: target.packageId, deviceId })
    },
    [system, target],
  )

  /** The link for whatever is in the store — what the badge's button uses. */
  const buyUrl = useMemo(() => urlFor(report?.deviceId), [report?.deviceId, urlFor])

  const buy = useCallback(
    async (deviceId?: string): Promise<void> => {
      // Prefer the id the CALLER is holding. See the docstring on `buy` above:
      // the dialog opened right after a licensing call has the fresh report, while
      // this hook's closure still sees the previous one.
      const url = urlFor(deviceId ?? report?.deviceId)
      if (!url) return
      await system.openExternalLink(url)
      // The purchase now lives in an external browser tab; start watching for
      // its completion so the licence is activated and written to the device
      // without the user having to come back and click anything.
      setAwaitingPurchase(true)
    },
    [report?.deviceId, setAwaitingPurchase, system, urlFor],
  )

  return {
    isLicensable: target.licensable,
    configurationError:
      !target.licensable && target.reason === 'no-package-id'
        ? 'This board declares a licensed VPP but its package is missing an id. The VPP package needs fixing.'
        : null,
    report,
    isChecking: phase === 'checking',
    check,
    refresh,
    buyUrl,
    buy,
    awaitingPurchase,
    cancelPurchaseWatch,
  }
}
