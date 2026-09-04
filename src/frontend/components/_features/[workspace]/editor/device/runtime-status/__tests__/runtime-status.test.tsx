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

/** Typed, so reading the action spies back needs no cast. */
type MockStore = {
  runtimeConnection: Record<string, unknown>
  deviceActions: Record<string, ReturnType<typeof vi.fn>>
}

let storeState: MockStore

const getOrchestratorHostInfo = vi.fn()

vi.mock('@root/middleware/shared/providers/platform-context', () => ({
  // The production source of these facts for an orchestrator-managed device,
  // which has no bootloader container to ask.
  useOrchestrator: () => ({ getOrchestratorHostInfo }),
  useRuntime: () => ({
    bootloader: {
      getCapabilities,
      login: bootloaderLogin,
      getStatus,
      getDeviceInfo,
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
vi.mock('@root/frontend/store', () => {
  const useOpenPLCStore = (selector: (state: unknown) => unknown) => selector(storeState)
  // The screen reads the store directly when comparing the reported runtime
  // version, to avoid putting it in a dependency list.
  useOpenPLCStore.getState = () => storeState
  return { useOpenPLCStore }
})

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
    ipAddress: '192.168.1.112',
    selectedDevice: {
      orchestratorId: 'local',
      orchestratorAgentId: 'local',
      deviceId: 'd1',
      deviceName: '192.168.2.4',
    },
    timingStats: null,
    storedCredentials: { username: 'op', password: 'op' },
    ...overrides,
  },
  deviceActions: {
    setIncludeTimingStatsInPolling: vi.fn(),
    setIncludeEthercatStatsInPolling: vi.fn(),
    // The version dialog renders inside this screen and suspends status
    // polling while a swap runs.
    setRuntimeUpdateInProgress: vi.fn(),
    // Written after an install so the header and the picker agree on what is
    // running.
    setRuntimeVersion: vi.fn(),
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  storeState = connectedState()
  getDeviceInfo.mockResolvedValue({ success: false, error: 'not supported' })
  getOrchestratorHostInfo.mockResolvedValue(null)
  getCapabilities.mockResolvedValue({ success: false, error: 'No bootloader on this device' })
  bootloaderLogin.mockResolvedValue({ success: false, error: 'no' })
  getStatus.mockResolvedValue({ success: false, error: 'no' })
})

/**
 * A device whose bootloader answers and accepts the operator's credentials.
 *
 * Device info comes from the bootloader now, behind its login, so every test
 * that expects a populated header has to get this far first -- which is the
 * point: the bootloader is present whatever runtime version is installed.
 */
const withBootloader = () => {
  getCapabilities.mockResolvedValue({
    success: true,
    data: { service: 'openplc-bootloader', state: 'healthy', recovery: false, bootloaderVersion: 'bootloader-v1.0.0' },
  })
  bootloaderLogin.mockResolvedValue({ success: true, data: {} })
  getStatus.mockResolvedValue({ success: true, data: { state: 'healthy', recovery: false } })
}

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
      data: {
        service: 'openplc-bootloader',
        state: 'healthy',
        recovery: false,
        bootloaderVersion: 'bootloader-v1.0.0',
      },
    })
    render(<RuntimeStatusEditor />)
    await waitFor(() => expect(screen.getByRole('button', { name: /change runtime version/i })).toBeTruthy())
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

  it('shows what the bootloader reports about the machine', async () => {
    withBootloader()
    getDeviceInfo.mockResolvedValue({
      success: true,
      data: {
        hostname: 'slm-rp4',
        architecture: 'aarch64',
        kernel: '6.12.35-rt10-v8+',
        system: 'Debian GNU/Linux 12 (bookworm)',
        cpus: 4,
        memoryBytes: 1935417344,
      },
    })
    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('aarch64')).toBeTruthy())
    expect(screen.getByText('slm-rp4')).toBeTruthy()
    expect(screen.getByText('6.12.35-rt10-v8+')).toBeTruthy()
    expect(screen.getByText('Debian GNU/Linux 12 (bookworm)')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    // Powers of 1024, so a 2 GB board reads as the number on its datasheet.
    expect(screen.getByText('1.8 GB')).toBeTruthy()
  })

  it('populates the header on a device whose runtime predates all of this', async () => {
    // The whole reason these facts come from the bootloader. A released
    // runtime serves no device information at all, and this screen is most
    // useful on exactly those devices -- so nothing here may depend on the
    // runtime version.
    withBootloader()
    getDeviceInfo.mockResolvedValue({ success: true, data: { hostname: 'slm-rp4', kernel: '6.12.35-rt10-v8+' } })
    storeState = connectedState({ runtimeVersion: 'v4.1.0' })

    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('slm-rp4')).toBeTruthy())
    expect(screen.getByText('6.12.35-rt10-v8+')).toBeTruthy()
  })

  it('asks the poller for the statistics it displays, and stops on unmount', () => {
    // These toggles moved here from the screens that used to show the stats.
    // Without them the screen would render empty panels forever; without the
    // cleanup, a device would be polled for data nobody is looking at.
    const actions = storeState.deviceActions
    const { unmount } = render(<RuntimeStatusEditor />)

    expect(actions.setIncludeTimingStatsInPolling).toHaveBeenCalledWith(true)
    expect(actions.setIncludeEthercatStatsInPolling).toHaveBeenCalledWith(true)

    unmount()
    expect(actions.setIncludeTimingStatsInPolling).toHaveBeenCalledWith(false)
    expect(actions.setIncludeEthercatStatsInPolling).toHaveBeenCalledWith(false)
  })
})

describe('Runtime Status header honesty', () => {
  it('leaves a field blank rather than inventing a value', async () => {
    // A bootloader that could not reach the daemon still answers, with less in
    // it. The header must show what is missing as missing.
    withBootloader()
    getDeviceInfo.mockResolvedValue({ success: true, data: { hostname: 'slm-rp4' } })

    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('slm-rp4')).toBeTruthy())
    // The fields it was not told about stay empty. The old runtime-sourced
    // header filled them in from defaults, which is how it came to state
    // "Native" about a container.
    expect(screen.queryByText('aarch64')).toBeNull()
    expect(screen.queryByText('Container')).toBeNull()
    expect(screen.queryByText('From this editor')).toBeNull()
  })
})

describe('Which device the header names', () => {
  it('names the connected device, not the address saved in the project', async () => {
    // runtimeConnection.ipAddress is the project's configured runtime IP. On a
    // device reached through an orchestrator it has no relationship to the
    // device on screen, and a project carrying an old address labelled the
    // header with a machine elsewhere on the network.
    withBootloader()
    getDeviceInfo.mockResolvedValue({ success: true, data: { hostname: 'slm-rp4' } })

    render(<RuntimeStatusEditor />)

    // The subtitle names both, so match the whole line rather than a fragment
    // that also appears in the Host field below it.
    await waitFor(() => expect(screen.getByText('slm-rp4 · 192.168.2.4')).toBeTruthy())
    expect(screen.queryByText(/192\.168\.1\.112/)).toBeNull()
  })

  it('falls back to the dialled address when there is no orchestrator', async () => {
    // The desktop editor connects straight to an IP and has no device record,
    // so that address is the only identity available before the bootloader
    // answers.
    storeState = connectedState({ selectedDevice: null, ipAddress: '192.168.2.4' })
    render(<RuntimeStatusEditor />)
    await waitFor(() => expect(screen.getByText(/192\.168\.2\.4/)).toBeTruthy())
  })
})

describe('A device with no bootloader', () => {
  it('falls back to what the orchestrator agent knows about the host', async () => {
    // The production case. Devices under an orchestrator are vPLC containers
    // with no bootloader beside them, so nothing answers on 8445 and the
    // header used to sit completely blank. The agent already collects these
    // facts for its own consumption reporting and Edge exposes them.
    getCapabilities.mockResolvedValue({ success: false, error: 'No bootloader on this device' })
    getOrchestratorHostInfo.mockResolvedValue({
      os: 'Debian GNU/Linux 12 (bookworm)',
      // Needs an Edge carrying EDGE-631; before that the agent sent this and
      // Edge did not declare it, so it could not be read.
      kernel: '6.12.35-rt10-v8+',
      cpu: '4',
      memory: '1846',
      agentVersion: '1.6.0',
      name: 'shop-floor-01',
    })

    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('Debian GNU/Linux 12 (bookworm)')).toBeTruthy())
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('1.8 GB')).toBeTruthy()
    // Named as the agent, not as a bootloader that is not there.
    expect(screen.getByText('Orchestrator agent')).toBeTruthy()
    expect(screen.getByText('1.6.0')).toBeTruthy()
    expect(screen.getByText('6.12.35-rt10-v8+')).toBeTruthy()
    // And still no version action: nothing on this device can perform a swap.
    expect(screen.queryByRole('button', { name: /change runtime version/i })).toBeNull()
  })

  it('treats a blank CPU or memory value as not reported', async () => {
    // Number('') and Number('   ') are both 0, not NaN, so an agent that
    // reports an empty count would otherwise have rendered "0 CPU cores" --
    // a claim about the machine rather than an absence of one.
    getCapabilities.mockResolvedValue({ success: false, error: 'No bootloader on this device' })
    getOrchestratorHostInfo.mockResolvedValue({
      os: 'Debian GNU/Linux 12 (bookworm)',
      cpu: '',
      memory: '   ',
      name: 'shop-floor-01',
    })

    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(screen.getByText('Debian GNU/Linux 12 (bookworm)')).toBeTruthy())
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('0.0 GB')).toBeNull()
    expect(screen.queryByText('0 MB')).toBeNull()
  })

  it('shows an empty header rather than failing when the agent says nothing', async () => {
    getCapabilities.mockResolvedValue({ success: false, error: 'No bootloader on this device' })
    getOrchestratorHostInfo.mockResolvedValue(null)

    render(<RuntimeStatusEditor />)

    await waitFor(() => expect(getOrchestratorHostInfo).toHaveBeenCalled())
    expect(screen.getByText('Runtime Status')).toBeTruthy()
  })
})
