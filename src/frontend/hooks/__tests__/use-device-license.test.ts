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
const mockSetAwaitingPurchase = jest.fn((awaiting: boolean) => {
  ;(mockState.deviceLicense as { awaitingPurchase: boolean }).awaitingPurchase = awaiting
})

const mockState: Record<string, unknown> = {
  deviceLicense: { phase: 'done', report: UNLICENSED, awaitingPurchase: false },
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

import { useDeviceLicense } from '../use-device-license'

const BOARD = { name: 'ESP32 PLC 21' } as unknown as BoardInfo

const POLL_MS = 20_000
const MAX_TICKS = 30

function setLicenseState(patch: Partial<{ phase: string; report: unknown; awaitingPurchase: boolean }>) {
  Object.assign(mockState.deviceLicense as object, patch)
}

describe('useDeviceLicense — purchase watch', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setLicenseState({ phase: 'done', report: UNLICENSED, awaitingPurchase: false })
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

  it('refreshes on every tick while the watch runs — the write happens inside refresh', async () => {
    setLicenseState({ awaitingPurchase: true })
    renderHook(() => useDeviceLicense(BOARD))

    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    expect(mockRefreshLicense).toHaveBeenCalledTimes(1)

    // The tick landed an unlicensed report (webhook not done): keep going.
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    expect(mockRefreshLicense).toHaveBeenCalledTimes(2)
  })

  it('skips a tick that would overlap a call still in flight', async () => {
    setLicenseState({ awaitingPurchase: true, phase: 'checking' })
    renderHook(() => useDeviceLicense(BOARD))

    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })

    expect(mockRefreshLicense).not.toHaveBeenCalled()
  })

  it('ends the watch when a licensed report lands, whoever produced it', () => {
    setLicenseState({ awaitingPurchase: true })
    const { rerender } = renderHook(() => useDeviceLicense(BOARD))

    // A manual "Check again" (or the poll) landed the licence.
    setLicenseState({ report: LICENSED })
    rerender()

    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('gives up after the tick budget instead of polling a forgotten tab forever', async () => {
    setLicenseState({ awaitingPurchase: true })
    renderHook(() => useDeviceLicense(BOARD))

    for (let i = 0; i < MAX_TICKS + 3; i++) {
      // eslint-disable-next-line no-await-in-loop -- each tick must settle before the next
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS)
      })
    }

    // 30 refreshes, then the budget closes the watch; the extra ticks refresh nothing.
    expect(mockRefreshLicense).toHaveBeenCalledTimes(MAX_TICKS)
    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('cancelPurchaseWatch stops the watch on request', () => {
    setLicenseState({ awaitingPurchase: true })
    const { result } = renderHook(() => useDeviceLicense(BOARD))

    act(() => result.current.cancelPurchaseWatch())

    expect(mockSetAwaitingPurchase).toHaveBeenCalledWith(false)
  })
})
