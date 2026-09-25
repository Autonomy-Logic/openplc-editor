/**
 * A partner session opened with `autoSaveOnBuild: false` must build and debug
 * WITHOUT the pre-build save (DOPE-675). On that session every save is delivered
 * to the partner's callback, so a save the user never asked for is a callback
 * the partner never asked for.
 *
 * Each case runs the same handler twice, flag on and flag off. The "on" run is
 * what makes the "off" run mean anything: it proves the handler reached the
 * save gate, so a missing save is the gate working and not an early return.
 *
 * Driven through the real handlers: the flash-request event for the PLC build
 * (the same `handleBuild` the build popover calls), and the Debugger / Build
 * Library buttons for the rest.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockExecuteSaveProject = jest.fn(async (..._args: unknown[]) => ({ success: true }))
const mockCompileProgram = jest.fn(async () => ({ success: false, error: 'stop here' }))
const mockCompileLibrary = jest.fn(async () => ({ success: false, error: 'stop here' }))

let projectType: 'plc-project' | 'plc-library' = 'plc-project'
let workspace = { canEdit: true, autoSaveOnBuild: true, isDebuggerVisible: false }

const storeState = () => ({
  project: { data: { pous: [] }, meta: { path: '/tmp/p', name: 'p', type: projectType } },
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
  deviceConnection: { status: 'disconnected' },
  deviceActions: { setRuntimeIpAddress: jest.fn(), setPlcRuntimeStatus: jest.fn() },
  runtimeConnection: { connectionStatus: 'disconnected', plcStatus: 'STOPPED' },
  consoleActions: { addLog: jest.fn(), requestConsoleFollow: jest.fn() },
  workspaceActions: { setDebugHarness: jest.fn() },
  workspace,
})

jest.mock('../../../../store', () => {
  const useOpenPLCStore = (selector?: (s: unknown) => unknown) => (selector ? selector(storeState()) : storeState())
  useOpenPLCStore.getState = () => storeState()
  return { useOpenPLCStore }
})

jest.mock('../../../../../middleware/shared/providers', () => ({
  useCompiler: () => ({ compileProgram: mockCompileProgram, compileLibrary: mockCompileLibrary }),
  useRuntime: () => ({}),
  useSimulator: () => ({}),
  useDebugger: () => ({ setPlcState: jest.fn(async () => ({ success: true })) }),
  useDevice: () => ({ connect: jest.fn(), disconnect: jest.fn(), releaseSerialPort: jest.fn(async () => false) }),
  useProject: () => ({}),
  useCapabilities: () => ({}),
}))

jest.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => ({ directUsbUpload: false, debuggerTransports: ['tcp'] }),
}))
jest.mock('@root/middleware/shared/utils/build-gate/pre-build-plc-gate', () => ({
  evaluatePreBuildPlcGate: () => ({ kind: 'allowed' }),
}))
jest.mock('../../../../../backend/shared/hardware/debug-spec', () => ({
  resolveDeviceLinkCandidates: () => ({ kind: 'candidates', candidates: [] }),
}))
jest.mock('../../../../services/device-link-resolution', () => ({
  buildDeviceResolverContext: () => ({}),
  showDeviceDialog: jest.fn(async () => 1),
}))
jest.mock('../../../../services/save-actions', () => ({
  executeSaveProject: (...args: unknown[]) => mockExecuteSaveProject(...args),
}))
jest.mock('../../../../hooks/use-device-connect', () => ({ useDeviceConnect: () => ({ connect: jest.fn() }) }))
jest.mock('../../../../hooks/use-runtime-connect', () => ({
  useRuntimeConnect: () => ({ connect: jest.fn(), toggle: jest.fn() }),
}))
jest.mock('../../../../hooks/useDebugSession', () => ({ useDebugSession: () => ({ debugTreesRef: { current: {} } }) }))
jest.mock('../../../../hooks/useDebugPolling', () => ({ useDebugPolling: () => undefined }))
jest.mock('../../../../hooks/use-simulator-debug-run', () => ({ useSimulatorDebugRun: () => ({ launch: jest.fn() }) }))
// An empty harness makes Debug Library stop right after the save gate.
jest.mock('@root/middleware/shared/utils/library-debug/compose-library-debug-harness', () => ({
  composeLibraryDebugHarness: () => ({ skipped: [], blocks: [] }),
}))

// The buttons under test render as plain buttons wired to their handler; the
// rest of the chrome renders nothing.
jest.mock('../../../_molecules/workspace-activity-bar/default/debugger', () => ({
  DebuggerButton: ({ onClick }: { onClick: () => void }) => (
    <button type='button' data-testid='debugger' onClick={onClick} />
  ),
}))
jest.mock('../../../_molecules/workspace-activity-bar/default/build-library', () => ({
  BuildLibraryButton: ({ onClick }: { onClick: () => void }) => (
    <button type='button' data-testid='build-library' onClick={onClick} />
  ),
}))
jest.mock('../../../_features/[workspace]/build-options', () => ({ BuildOptionsPopover: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/chat', () => ({ ChatButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/play', () => ({ PlayButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/search', () => ({ SearchButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/default/zoom', () => ({ ZoomButton: () => null }))
jest.mock('../../../_molecules/workspace-activity-bar/tooltip-button', () => ({
  TooltipSidebarWrapperButton: ({ children }: { children?: unknown }) => children ?? null,
}))

import { requestDeviceFlash } from '../../../../utils/device-connect-events'
import { DefaultWorkspaceActivityBar } from '../default'

const renderBar = () => render(<DefaultWorkspaceActivityBar zoom={{ onClick: () => undefined }} />)

describe('workspace activity bar: autoSaveOnBuild', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    projectType = 'plc-project'
    workspace = { canEdit: true, autoSaveOnBuild: true, isDebuggerVisible: false }
  })

  describe('Build', () => {
    it('saves before compiling when the flag is on', async () => {
      renderBar()
      act(() => requestDeviceFlash())

      await waitFor(() => expect(mockCompileProgram).toHaveBeenCalled())
      expect(mockExecuteSaveProject).toHaveBeenCalledTimes(1)
    })

    it('compiles without saving when the flag is off', async () => {
      workspace.autoSaveOnBuild = false
      renderBar()
      act(() => requestDeviceFlash())

      await waitFor(() => expect(mockCompileProgram).toHaveBeenCalled())
      expect(mockExecuteSaveProject).not.toHaveBeenCalled()
    })
  })

  describe('Debugger', () => {
    it('saves before starting when the flag is on', async () => {
      renderBar()
      fireEvent.click(screen.getByTestId('debugger'))

      await waitFor(() => expect(mockExecuteSaveProject).toHaveBeenCalledTimes(1))
    })

    it('does not save when the flag is off', async () => {
      workspace.autoSaveOnBuild = false
      renderBar()
      fireEvent.click(screen.getByTestId('debugger'))

      // Give the handler the same chance to reach the save that the "on" case had.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(mockExecuteSaveProject).not.toHaveBeenCalled()
    })
  })

  describe('Build Library', () => {
    beforeEach(() => {
      projectType = 'plc-library'
    })

    it('saves before compiling when the flag is on', async () => {
      renderBar()
      fireEvent.click(screen.getByTestId('build-library'))

      await waitFor(() => expect(mockCompileLibrary).toHaveBeenCalled())
      expect(mockExecuteSaveProject).toHaveBeenCalledTimes(1)
    })

    it('compiles without saving when the flag is off', async () => {
      workspace.autoSaveOnBuild = false
      renderBar()
      fireEvent.click(screen.getByTestId('build-library'))

      await waitFor(() => expect(mockCompileLibrary).toHaveBeenCalled())
      expect(mockExecuteSaveProject).not.toHaveBeenCalled()
    })
  })

  describe('Debug Library', () => {
    beforeEach(() => {
      projectType = 'plc-library'
    })

    // On a library project the only Debugger button is Debug Library.
    const clickDebugLibrary = () => fireEvent.click(screen.getByTestId('debugger'))

    it('saves before building the harness when the flag is on', async () => {
      renderBar()
      clickDebugLibrary()

      await waitFor(() => expect(mockExecuteSaveProject).toHaveBeenCalledTimes(1))
    })

    it('does not save when the flag is off', async () => {
      workspace.autoSaveOnBuild = false
      renderBar()
      clickDebugLibrary()

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(mockExecuteSaveProject).not.toHaveBeenCalled()
    })
  })
})
