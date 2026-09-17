/**
 * The Ethernet debug link this handler drops for an upload must come back
 * afterwards, INCLUDING when the compile blows up rather than returning
 * `{ success: false }`.
 *
 * The restore used to sit at the end of the `try`, while the teardown that
 * disconnects the link sits BEFORE it. So an IPC failure or an adapter throw
 * from `compileProgram` skipped the restore entirely and left the debugger
 * disconnected for good — with only "Build error: ..." in the console and
 * nothing to say the connection was gone. Moving it into `finally` is the fix,
 * and these pin it.
 *
 * Driven through the flash-request event (`requestDeviceFlash`) rather than the
 * build popover: it is the same `handleBuild` either way, and it keeps the test
 * about the teardown contract instead of about menu markup.
 */
import { act, render, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks. Everything the activity bar reaches for, stubbed down to the few
// behaviours this contract depends on.
// ---------------------------------------------------------------------------

const mockDeviceConnect = jest.fn(async () => undefined)
const mockDeviceDisconnect = jest.fn(async () => undefined)
const mockReleaseSerialPort = jest.fn(async () => false)
const mockCompileProgram = jest.fn()
const mockSetRuntimeIpAddress = jest.fn()

/** 'connected' before the build, so the handler tears the link down. */
let deviceStatus = 'connected'

const storeState = () => ({
  project: { data: { pous: [] }, meta: { path: '/tmp/p', name: 'p', type: 'plc-project' } },
  projectActions: { getCompileReadyProjectData: () => ({ pous: [] }) },
  deviceDefinitions: {
    configuration: {
      deviceBoard: 'Siemens LOGO! 8.2',
      communicationPort: null,
      runtimeIpAddress: '192.168.2.5',
      vendorScreenData: {},
    },
  },
  deviceAvailableOptions: { availableBoards: new Map([['Siemens LOGO! 8.2', { uploadMethod: 'ethernet' }]]) },
  deviceConnection: { status: deviceStatus },
  deviceActions: { setRuntimeIpAddress: mockSetRuntimeIpAddress, setPlcRuntimeStatus: jest.fn() },
  runtimeConnection: { connectionStatus: 'disconnected', plcStatus: 'STOPPED' },
  consoleActions: { addLog: jest.fn(), requestConsoleFollow: jest.fn() },
  workspace: { canEdit: false },
})

jest.mock('../../../../store', () => {
  const useOpenPLCStore = (selector?: (s: unknown) => unknown) => (selector ? selector(storeState()) : storeState())
  useOpenPLCStore.getState = () => storeState()
  return { useOpenPLCStore }
})

jest.mock('../../../../../middleware/shared/providers', () => ({
  useCompiler: () => ({ compileProgram: mockCompileProgram }),
  useRuntime: () => ({}),
  useSimulator: () => ({}),
  useDebugger: () => ({ setPlcState: jest.fn(async () => ({ success: true })) }),
  useDevice: () => ({
    connect: mockDeviceConnect,
    disconnect: mockDeviceDisconnect,
    releaseSerialPort: mockReleaseSerialPort,
  }),
  useProject: () => ({}),
  useCapabilities: () => ({}),
}))

jest.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => ({
    // Ethernet target: no direct-USB upload, so no serial handoff — the
    // Ethernet teardown/restore is the only path in play.
    directUsbUpload: false,
    debuggerTransports: ['tcp'],
  }),
}))

jest.mock('@root/middleware/shared/utils/build-gate/pre-build-plc-gate', () => ({
  evaluatePreBuildPlcGate: () => ({ kind: 'allowed' }),
}))

jest.mock('../../../../../backend/shared/hardware/debug-spec', () => ({
  resolveDeviceLinkCandidates: () => ({ kind: 'candidates', candidates: [{ config: { host: '192.168.2.5' } }] }),
}))

jest.mock('../../../../services/device-link-resolution', () => ({
  buildDeviceResolverContext: () => ({}),
  showDeviceDialog: jest.fn(async () => 1),
}))

jest.mock('../../../../services/save-actions', () => ({ executeSaveProject: jest.fn(async () => true) }))
jest.mock('../../../../hooks/useDebugSession', () => ({ useDebugSession: () => ({ debugTreesRef: { current: {} } }) }))
jest.mock('../../../../hooks/useDebugPolling', () => ({ useDebugPolling: () => undefined }))
jest.mock('../../../../hooks/use-simulator-debug-run', () => ({ useSimulatorDebugRun: () => ({ launch: jest.fn() }) }))
jest.mock('@root/middleware/shared/utils/library-debug/compose-library-debug-harness', () => ({
  composeLibraryDebugHarness: () => ({}),
}))

// Child buttons render nothing: this test is about the handler, not the chrome.
jest.mock('../../../_features/[workspace]/build-options', () => ({ BuildOptionsPopover: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/build-library', () => ({
  BuildLibraryButton: () => null,
}))
jest.mock('../../../_molecules/workspace-activity-bar/default/chat', () => ({ ChatButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/debugger', () => ({ DebuggerButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/play', () => ({ PlayButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/search', () => ({ SearchButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/zoom', () => ({ ZoomButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/tooltip-button', () => ({
  TooltipSidebarWrapperButton: ({ children }: { children?: unknown }) => children ?? null,
}))

import { requestDeviceFlash } from '../../../../utils/device-connect-events'
import { DefaultWorkspaceActivityBar } from '../default'

describe('workspace activity bar — Ethernet link restore after a build', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    deviceStatus = 'connected'
  })

  it('reconnects after a build that THROWS, not just one that fails cleanly', async () => {
    // The regression: an adapter/IPC throw skipped the restore entirely.
    mockCompileProgram.mockRejectedValue(new Error('IPC channel closed'))

    render(<DefaultWorkspaceActivityBar zoom={{ onClick: () => undefined }} />)
    const startedAt = Date.now()
    act(() => requestDeviceFlash())

    await waitFor(() => expect(mockDeviceDisconnect).toHaveBeenCalled())
    await waitFor(() => expect(mockDeviceConnect).toHaveBeenCalledTimes(1))

    // And it does not sit through the 6 s reboot settle on the way: that wait is
    // for a device that actually took new firmware, which a throwing build never
    // reached. Restoring the link is the `finally`'s job; waiting is not.
    expect(Date.now() - startedAt).toBeLessThan(3000)
  })

  it('reconnects after a build that returns success: false', async () => {
    mockCompileProgram.mockResolvedValue({ success: false, error: 'compile failed' })

    render(<DefaultWorkspaceActivityBar zoom={{ onClick: () => undefined }} />)
    act(() => requestDeviceFlash())

    await waitFor(() => expect(mockDeviceConnect).toHaveBeenCalledTimes(1))
  })

  it('waits out the reboot settle before reconnecting after a SUCCESSFUL build', async () => {
    // The device rebooted into the new firmware, so the link being restored is a
    // different one -- dialling it immediately would just fail. The settle stays
    // on the success path inside the `try`; only the restore moved to `finally`.
    mockCompileProgram.mockResolvedValue({ success: true })

    render(<DefaultWorkspaceActivityBar zoom={{ onClick: () => undefined }} />)
    const startedAt = Date.now()
    act(() => requestDeviceFlash())

    await waitFor(() => expect(mockDeviceConnect).toHaveBeenCalledTimes(1), { timeout: 15000 })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5500)
  }, 20000)

  it('does not reconnect a link it never dropped', async () => {
    // Nothing was connected before the build, so there is nothing to restore --
    // the restore is guarded on its own flag rather than on "is ethernet".
    deviceStatus = 'disconnected'
    mockCompileProgram.mockRejectedValue(new Error('IPC channel closed'))

    render(<DefaultWorkspaceActivityBar zoom={{ onClick: () => undefined }} />)
    act(() => requestDeviceFlash())

    await waitFor(() => expect(mockCompileProgram).toHaveBeenCalled())
    expect(mockDeviceDisconnect).not.toHaveBeenCalled()
    expect(mockDeviceConnect).not.toHaveBeenCalled()
  })
})
