import type { DeviceLicenseReport, DevicePort } from '@root/middleware/shared/ports/device-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { SystemPort } from '@root/middleware/shared/ports/system-port'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, renderHook } from '@testing-library/react'

jest.mock('@root/middleware/shared/utils/licensing', () => ({
  resolveLicensingTarget: () => ({ licensable: true, packageId: 'com.openplc.industrialshields' }),
}))

import type { OpenPLCStore } from '../../store'
import type { DeviceLicenseInfo } from '../../store/slices/device/types'
import { PURCHASE_WATCH_WINDOW_MS } from '../../store/slices/device/types'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useDeviceLicense } from '../use-device-license'

const DEVICE_ID = '659a3520540f803625ddc34081e893d3'
const UNLICENSED: DeviceLicenseReport = {
  deviceId: DEVICE_ID,
  outcome: { state: 'unlicensed', entitlementChecked: true },
}
const LICENSED: DeviceLicenseReport = { deviceId: DEVICE_ID, outcome: { state: 'licensed', how: 'activated' } }

const mockReadLicense = jest.fn().mockResolvedValue(UNLICENSED)
const mockRefreshLicense = jest.fn().mockResolvedValue(UNLICENSED)
const mockOpenExternalLink = jest.fn().mockResolvedValue({ success: true })

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function buildPorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({ readLicense: mockReadLicense, refreshLicense: mockRefreshLicense }),
    orchestrator: stubPort(),
    system: stubPort<SystemPort>({
      getEdgeFrontendUrl: () => 'https://edge.example.com',
      openExternalLink: mockOpenExternalLink,
    }),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: WEB_CAPABILITIES,
  }
}

const BOARD = { name: 'ESP32 PLC 21' } as unknown as BoardInfo

const POLL_MS = 20_000

let store: OpenPLCStore
let ports: PlatformPorts

function setLicenseState(patch: Partial<DeviceLicenseInfo>) {
  store.setState({ deviceLicense: { ...store.getState().deviceLicense, ...patch } })
}

/** Open the watch window the way the real action does: deadline = now + window. */
function openPurchaseWindow(remainingMs: number = PURCHASE_WATCH_WINDOW_MS) {
  setLicenseState({ awaitingPurchaseUntil: Date.now() + remainingMs })
}

function renderLicense(opts?: { ownsWatch?: boolean }) {
  return renderHook(() => useDeviceLicense(BOARD, opts), { wrapper: createStoreWrapper(store, ports) })
}

/**
 * Mount the one instance that owns the watch (the board screen's), then settle
 * the immediate first tick so each subsequent timer advance starts from a
 * landed report instead of tripping the overlap guard on its own leftovers.
 */
async function mountOwner() {
  const utils = renderLicense({ ownsWatch: true })
  await act(async () => {})
  return utils
}

describe('useDeviceLicense — purchase watch', () => {
  let setAwaitingPurchase: ReturnType<typeof jest.fn>

  beforeEach(() => {
    jest.useFakeTimers()
    store = createTestStore()
    ports = buildPorts()
    setLicenseState({ phase: 'done', report: UNLICENSED, awaitingPurchaseUntil: null })
    const { deviceActions } = store.getState()
    setAwaitingPurchase = jest.fn(deviceActions.setAwaitingPurchase)
    // Immer freezes the action namespace, so spy by swapping in a wrapped copy.
    store.setState({ deviceActions: { ...deviceActions, setAwaitingPurchase } })
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('buy() opens the device-bound page and starts the watch', async () => {
    const { result } = renderLicense()

    await act(() => result.current.buy(DEVICE_ID))

    expect(mockOpenExternalLink).toHaveBeenCalledWith(expect.stringContaining(DEVICE_ID))
    expect(mockOpenExternalLink).toHaveBeenCalledWith(expect.stringContaining('com.openplc.industrialshields'))
    expect(setAwaitingPurchase).toHaveBeenCalledWith(true)
  })

  it('does NOT start a watch when no purchase page could be opened', async () => {
    // No deviceId anywhere → urlFor yields null → nothing opened, nothing to watch.
    setLicenseState({ report: null })
    const { result } = renderLicense()

    await act(() => result.current.buy())

    expect(mockOpenExternalLink).not.toHaveBeenCalled()
    expect(setAwaitingPurchase).not.toHaveBeenCalled()
  })

  it('does NOT start a watch when the platform failed to open the page', async () => {
    // The link call reports failure: no browser opened, so there is no purchase
    // to wait for — and the Buy button must stay offered instead.
    mockOpenExternalLink.mockResolvedValueOnce({ success: false })
    const { result } = renderLicense()

    await act(() => result.current.buy(DEVICE_ID))

    expect(mockOpenExternalLink).toHaveBeenCalledTimes(1)
    expect(setAwaitingPurchase).not.toHaveBeenCalled()
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
    renderLicense()
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
    renderLicense()

    // A manual "Check again" (or the poll) landed the licence.
    act(() => setLicenseState({ report: LICENSED }))

    expect(setAwaitingPurchase).toHaveBeenCalledWith(false)
    expect(store.getState().deviceLicense.awaitingPurchaseUntil).toBeNull()
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
    expect(setAwaitingPurchase).toHaveBeenCalledWith(false)
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
    expect(setAwaitingPurchase).toHaveBeenCalledWith(false)
  })

  it('cancelPurchaseWatch stops the watch on request', () => {
    openPurchaseWindow()
    const { result } = renderLicense()

    act(() => result.current.cancelPurchaseWatch())

    expect(setAwaitingPurchase).toHaveBeenCalledWith(false)
  })
})
