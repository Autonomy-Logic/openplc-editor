import { act, renderHook } from '@testing-library/react'

// `mock*`-prefixed refs are hoisted into the jest.mock factories below.

const DEVICE_ID = '659a3520540f803625ddc34081e893d3'
const UNLICENSED = { deviceId: DEVICE_ID, outcome: { state: 'unlicensed', entitlementChecked: true } }
const LICENSED = { deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'activated' } }

const mockStartLicenseCheck = jest.fn(() => {
  ;(mockState.deviceLicense as { phase: string }).phase = 'checking'
})
/** Write-through, like the real action: the poll's overlap guard reads it back. */
const mockSetLicenseReport = jest.fn((report: unknown) => {
  const lic = mockState.deviceLicense as { phase: string; report: unknown }
  lic.phase = 'done'
  lic.report = report
})
/** Write-through, like the real action: stamps the absolute deadline the poll reads back. */
const mockSetAwaitingPurchase = jest.fn((awaiting: boolean) => {
  ;(mockState.deviceLicense as { awaitingPurchaseUntil: number | null }).awaitingPurchaseUntil = awaiting
    ? Date.now() + PURCHASE_WATCH_WINDOW_MS
    : null
})

const mockState: Record<string, unknown> = {
  deviceLicense: { phase: 'done', report: UNLICENSED, awaitingPurchaseUntil: null },
  deviceActions: {
    startDeviceLicenseCheck: mockStartLicenseCheck,
    setDeviceLicenseReport: mockSetLicenseReport,
    setAwaitingPurchase: mockSetAwaitingPurchase,
  },
}

type Selector<T> = (s: typeof mockState) => T
const mockUseOpenPLCStore = ((selector?: Selector<unknown>) =>
  selector ? selector(mockState) : mockState) as unknown as jest.Mock & { getState: () => typeof mockState }
mockUseOpenPLCStore.getState = () => mockState

const mockReadLicense = jest.fn().mockResolvedValue(UNLICENSED)
const mockRefreshLicense = jest.fn().mockResolvedValue(UNLICENSED)
const mockOpenExternalLink = jest.fn().mockResolvedValue({ success: true })

jest.mock('../../store', () => ({ useOpenPLCStore: mockUseOpenPLCStore }))
jest.mock('@root/middleware/shared/providers/platform-context', () => ({
  useDevice: () => ({ readLicense: mockReadLicense, refreshLicense: mockRefreshLicense }),
  useSystem: () => ({
    getEdgeFrontendUrl: () => 'https://edge.example.com',
    openExternalLink: mockOpenExternalLink,
  }),
}))
jest.mock('@root/middleware/shared/utils/licensing', () => ({
  resolveLicensingTarget: () => ({ licensable: true, packageId: 'com.openplc.industrialshields' }),
}))

import type { BoardInfo } from '@root/middleware/shared/ports/types'

import { PURCHASE_WATCH_WINDOW_MS } from '../../store/slices/device/types'
import { useDeviceLicense } from '../use-device-license'

const BOARD = { name: 'ESP32 PLC 21' } as unknown as BoardInfo

const POLL_MS = 20_000

function setLicenseState(patch: Partial<{ phase: string; report: unknown; awaitingPurchaseUntil: number | null }>) {
  Object.assign(mockState.deviceLicense as object, patch)
}

/** Open the watch window the way the real action does: deadline = now + window. */
function openPurchaseWindow(remainingMs: number = PURCHASE_WATCH_WINDOW_MS) {
  setLicenseState({ awaitingPurchaseUntil: Date.now() + remainingMs })
}

/**
 * Mount the one instance that owns the watch (the board screen's), then settle
 * the immediate first tick so each subsequent timer advance starts from a
 * landed report instead of tripping the overlap guard on its own leftovers.
 */
async function mountOwner() {
  const utils = renderHook(() => useDeviceLicense(BOARD, { ownsWatch: true }))
  await act(async () => {})
  return utils
}

describe('useDeviceLicense — purchase watch', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setLicenseState({ phase: 'done', report: UNLICENSED, awaitingPurchaseUntil: null })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('buy() opens the device-bound page and starts the watch', async () => {
    const { result } = renderHook(() => useDeviceLicense(BOARD))

    await act(() => result.current.buy(DEVICE_ID))

    expect(mockOpenExternalLink).toHaveBeenCalledWith(expect.stringContaining(DEVICE_ID))
    expect(mockOpenExternalLink).toHaveBeenCalledWith(expect.stringContaining('com.openplc.industrialshields'))
    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(true)
  })

  it('does NOT start a watch when no purchase page could be opened', async () => {
    // No deviceId anywhere → urlFor yields null → nothing opened, nothing to watch.
    setLicenseState({ report: null })
    const { result } = renderHook(() => useDeviceLicense(BOARD))

    await act(() => result.current.buy())

    expect(mockOpenExternalLink).not.toHaveBeenCalled()
    expect(mockSetAwaitingPurchase).not.toHaveBeenCalled()
  })

  it('does NOT start a watch when the platform failed to open the page', async () => {
    // The link call reports failure: no browser opened, so there is no purchase
    // to wait for — and the Buy button must stay offered instead.
    mockOpenExternalLink.mockResolvedValueOnce({ success: false })
    const { result } = renderHook(() => useDeviceLicense(BOARD))

    await act(() => result.current.buy(DEVICE_ID))

    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
    expect(mockSetAwaitingPurchase).not.toHaveBeenCalled()
  })

  it('checks immediately when the watch opens — a checkout that already completed must not wait 20s', async () => {
    openPurchaseWindow()
    await mountOwner()

    expect(mockRefreshLicense).toHaveBeenCalledTimes(1)
  })

  it('keeps refreshing on the poll cadence — the write happens inside refresh', async () => {
    openPurchaseWindow()
    await mountOwner()

    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    // The immediate tick plus the first interval tick. Each landed an
    // unlicensed report (webhook not done yet): keep going.
    expect(mockRefreshLicense).toHaveBeenCalledTimes(2)

    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    expect(mockRefreshLicense).toHaveBeenCalledTimes(3)
  })

  it('skips any tick that would overlap a call still in flight, including the first', async () => {
    openPurchaseWindow()
    setLicenseState({ phase: 'checking' })
    await mountOwner()

    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })

    expect(mockRefreshLicense).not.toHaveBeenCalled()
  })

  it('never polls from an instance that does not own the watch', async () => {
    // The hook is mounted twice per screen (the board screen's own instance and
    // the one inside useDeviceConnect). Only the owner runs the interval —
    // otherwise every tick would fire once per instance on the same link.
    openPurchaseWindow()
    renderHook(() => useDeviceLicense(BOARD))
    await act(async () => {})

    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop -- each tick must settle before the next
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS)
      })
    }

    expect(mockRefreshLicense).not.toHaveBeenCalled()
  })

  it('ends the watch when a licensed report lands, whoever produced it', () => {
    openPurchaseWindow()
    const { rerender } = renderHook(() => useDeviceLicense(BOARD))

    // A manual "Check again" (or the poll) landed the licence.
    setLicenseState({ report: LICENSED })
    rerender()

    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('gives up when the 10-minute window closes instead of polling a forgotten tab forever', async () => {
    openPurchaseWindow()
    await mountOwner()

    const windowTicks = PURCHASE_WATCH_WINDOW_MS / POLL_MS
    for (let i = 0; i < windowTicks + 3; i++) {
      // eslint-disable-next-line no-await-in-loop -- each tick must settle before the next
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS)
      })
    }

    // The immediate tick plus every interval tick strictly inside the window
    // refreshed; the tick AT the deadline closed the watch instead, and the
    // extra ticks refreshed nothing.
    expect(mockRefreshLicense).toHaveBeenCalledTimes(windowTicks)
    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('resumes the SAME window after a remount — the deadline is absolute, not a per-mount budget', async () => {
    // The deadline lives in the store. Unmount the owner, let the wall clock
    // pass the deadline, remount: the first tick must close the watch rather
    // than grant a fresh ten minutes to a stale checkout.
    openPurchaseWindow(30_000)
    const first = await mountOwner()
    expect(mockRefreshLicense).toHaveBeenCalledTimes(1)
    first.unmount()

    jest.setSystemTime(Date.now() + 40_000)
    await mountOwner()

    expect(mockRefreshLicense).toHaveBeenCalledTimes(1)
    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('cancelPurchaseWatch stops the watch on request', () => {
    openPurchaseWindow()
    const { result } = renderHook(() => useDeviceLicense(BOARD))

    act(() => result.current.cancelPurchaseWatch())

    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })
})
