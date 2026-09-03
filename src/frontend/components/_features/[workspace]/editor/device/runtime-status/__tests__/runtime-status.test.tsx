/**
 * Runtime Status screen (RTOP-283).
 *
 * Rendered against a mocked store and runtime port rather than a live device.
 * The web app reaches devices only through the orchestrator agent proxy, so a
 * browser walkthrough of this screen would need an orchestrator, an Edge API
 * and a registered device -- none of which make a useful regression test. What
 * actually needs pinning is the decision logic: when the version-change action
 * is offered, what the header says about a device, and that a device in
 * recovery announces itself. All three are testable here and none of them are
 * visible from a screenshot anyway.
 */

import { render, screen, waitFor } from '@testing-library/react'

const getDeviceInfo = vi.fn()
const getCapabilities = vi.fn()
const bootloaderLogin = vi.fn()
const getStatus = vi.fn()

let storeState: Record<string, unknown> = {}

vi.mock('@root/middleware/shared/providers/platform-context', () => ({
  useRuntime: () => ({
    getDeviceInfo,
    bootloader: {
      getCapabilities,
      login: bootloaderLogin,
      getStatus,
      getRuntimeLogs: vi.fn(),
      startUpdate: vi.fn(),
      getUpdateProgress: vi.fn().mockResolvedValue({ success: false, error: 'none' }),
      restartRuntime: vi.fn(),
      clearSession: vi.fn(),
    },
  }),
}))

// Mocked through the @root alias rather than a relative path: Jest resolves
// a mock path relative to its setup file, not the test, so a relative one
// fails there while working under Vitest. The alias resolves to the same
// module in both, which keeps this file identical across the two apps.
vi.mock('@root/frontend/store', () => ({
  useOpenPLCStore: (selector: (state: unknown) => unknown) => selector(storeState),
}))

// The statistics panels are exercised by their own tests; here they would only
// add noise and a dependency on live timing data.
vi.mock('@root/frontend/components/_molecules/ethercat-stats', () => ({ EtherCATStats: () => null }))
vi.mock('@root/frontend/components/_molecules/plugin-stats-panel', () => ({ PluginStatsPanel: () => null }))
vi.mock('@root/frontend/components/_molecules/scan-cycle-stats', () => ({ ScanCycleStats: () => null }))

import { RuntimeStatusEditor } from '../index'

/** A connected device, built fresh per test so the action spies are clean. */
const connectedState = (overrides: Record<string, unknown> = {}) => ({
  runtimeConnection: {
    connectionStatus: 'connected',
    runtimeVersion: 'v4.2.1',
    ipAddress: '192.168.2.4',
    timingStats: null,
    storedCredentials: { username: 'op', password: 'op' },
    ...overrides,
  },
  deviceActions: {
    setIncludeTimingStatsInPolling: vi.fn(),
    setIncludeEthercatStatsInPolling: vi.fn(),
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  storeState = connectedState()
  getDeviceInfo.mockResolvedValue({ success: false, error: 'not supported' })
  getCapabilities.mockResolvedValue({ success: false, error: 'No bootloader on this device' })
  bootloaderLogin.mockResolvedValue({ success: false, error: 'no' })
  getStatus.mockResolvedValue({ success: false, error: 'no' })
})

describe('Runtime Status', () => {
  it('asks the operator to connect before showing anything', () => {
    storeState = connectedState({ connectionStatus: 'disconnected' })
    render(<RuntimeStatusEditor />)
    expect(screen.getByText(/connect to a runtime/i)).toBeTruthy()
  })

  it('does not offer a version change when the device has no bootloader', async () => {
    // The common case: an orchestrator-managed vPLC or a native install.
    // Nothing on the device could perform a swap, and a button that cannot
    // work is worse than no button.
    render(<RuntimeStatusEditor />)
    await waitFor(() => expect(getCapabilities).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /change runtime version/i })).toBeNull()
  })

  it('offers a version change when a bootloader answers', async () => {
    getCapabilities.mockResolvedValue({
      success: true,
      data: { service: 'openplc-bootloader', state: 'healthy', recovery: false, bootloaderVersion: 'bootloader-v1.0.0' },
    })
    render(<RuntimeStatusEditor />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /change runtime version/i })).toBeTruthy(),
    )
  })

  it('announces a device in recovery, with the reason', async () => {
    // A device whose runtime will not start is exactly when someone needs to
    // know why, and the bootloader's own wording is the most useful thing to
    // show them.
    getCapabilities.mockResolvedValue({
      success: true,
      data: { service: 'openplc-bootloader', state: 'recovery', recovery: true },
    })
    bootloaderLogin.mockResolvedValue({ success: true, data: {} })
    getStatus.mockResolvedValue({
      success: true,
      data: { state: 'recovery', recovery: true, reason: 'runtime exited 3 times within 5m0s' },
    })

    render(<RuntimeStatusEditor />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/runtime exited 3 times/i)).toBeTruthy()
  })

  it('shows what the device reports about itself', async () => {
    getDeviceInfo.mockResolvedValue({
      success: true,
      data: {
        hostname: 'slm-rp4',
        architecture: 'aarch64',
        kernel: '6.12.35-rt10-v8+',
        containerized: true,
        updatePolicy: 'self',
      },
    })
    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('aarch64')).toBeTruthy())
    expect(screen.getByText('6.12.35-rt10-v8+')).toBeTruthy()
    expect(screen.getByText('Container')).toBeTruthy()
    // The policy is rendered in words, never as a bare enum.
    expect(screen.getByText('From this editor')).toBeTruthy()
    expect(screen.queryByText('self')).toBeNull()
  })

  it('explains a managed device instead of leaving the operator hunting', async () => {
    getDeviceInfo.mockResolvedValue({ success: true, data: { updatePolicy: 'managed' } })
    render(<RuntimeStatusEditor />)
    await waitFor(() => expect(screen.getByText('Managed by orchestrator')).toBeTruthy())
  })

  it('asks the poller for the statistics it displays, and stops on unmount', () => {
    // These toggles moved here from the screens that used to show the stats.
    // Without them the screen would render empty panels forever; without the
    // cleanup, a device would be polled for data nobody is looking at.
    const actions = (storeState as { deviceActions: Record<string, ReturnType<typeof vi.fn>> })
      .deviceActions
    const { unmount } = render(<RuntimeStatusEditor />)

    expect(actions.setIncludeTimingStatsInPolling).toHaveBeenCalledWith(true)
    expect(actions.setIncludeEthercatStatsInPolling).toHaveBeenCalledWith(true)

    unmount()
    expect(actions.setIncludeTimingStatsInPolling).toHaveBeenCalledWith(false)
    expect(actions.setIncludeEthercatStatsInPolling).toHaveBeenCalledWith(false)
  })
})
