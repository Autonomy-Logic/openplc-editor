import { openPLCStoreBase } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

// `NoInfer` pins T to the port the result is assigned to: ts-jest type-checks
// this file, so an inferred literal would not satisfy the port interface.
function stubPort<T extends object>(overrides: Partial<NoInfer<T>> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const PLAIN_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const VPP_BOARD: BoardInfo = {
  ...PLAIN_BOARD,
  vpp: {
    packageId: 'com.acme.backplane',
    vendor: 'Acme',
    deviceId: 'slm-rp4',
    packagePath: '/packages/com.acme.backplane',
    screens: {},
    moduleSystem: null,
  },
}

const REFUSAL =
  'This vPLC has no access to the local backplane I/O. Create a vPLC with that option, or select the one that has it.'

const VPP_BOARD_NAME = 'Acme SLM-RP4'
const PLAIN_BOARD_NAME = 'OpenPLC Runtime'

const holder: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-holder',
  deviceName: 'Line A',
  backplaneAccess: true,
}

const compileProgram = vi.fn(() => Promise.resolve({ success: true }))

function renderBar(board: string, selectedDevice: SelectedDevice | null) {
  const { deviceActions, workspaceActions, consoleActions } = openPLCStoreBase.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      [PLAIN_BOARD_NAME, PLAIN_BOARD],
      [VPP_BOARD_NAME, VPP_BOARD],
    ]),
  })
  deviceActions.setDeviceBoard(board)
  deviceActions.setSelectedDevice(selectedDevice)
  // The upload rows are offered for a network target only while it is connected.
  deviceActions.setRuntimeConnectionStatus('connected')
  // A viewer skips the pre-build save, which is the only other port this bar
  // would reach before the gate; nothing here is testing the save.
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports: PlatformPorts = {
    compiler: stubPort({ compileProgram }),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: WEB_CAPABILITIES,
  }
  render(
    <PlatformProvider ports={ports}>
      <DefaultWorkspaceActivityBar />
    </PlatformProvider>,
  )
}

/** Open the build menu and pick one of its rows. */
function chooseBuildOption(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
  const row = screen.getByText(label).closest('button')
  if (!row) throw new Error(`build option "${label}" rendered without a button`)
  fireEvent.click(row)
}

function loggedMessages() {
  return openPLCStoreBase.getState().logs.map((entry) => entry.message)
}

describe('Build — backplane gate', () => {
  beforeEach(() => {
    compileProgram.mockClear()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
  })

  afterEach(() => {
    cleanup()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
    openPLCStoreBase.getState().workspaceActions.setCanEdit(true)
  })

  it('refuses to deploy a vendor-package board to a vPLC without backplane access', async () => {
    renderBar(VPP_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    chooseBuildOption('Build and upload')

    // The refusal has to land before the compile, because the compile is what
    // uploads: nothing may reach the runtime on a refused deploy.
    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('refuses a compile-only build of the same board just as flatly', async () => {
    renderBar(VPP_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    chooseBuildOption('Build only')

    await waitFor(() => expect(loggedMessages()).toContain(REFUSAL))
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('deploys the same board to the vPLC that holds the backplane', async () => {
    renderBar(VPP_BOARD_NAME, holder)

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('deploys when the host reported no flag at all', async () => {
    // A host predating the field must not have its silence read as a refusal.
    renderBar(VPP_BOARD_NAME, {
      orchestratorId: 'orch-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'dev-old',
      deviceName: 'Line C',
    })

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('deploys an ordinary board to a vPLC without backplane access', async () => {
    // The gate is about vendor packages; no built-in target drives the backplane.
    renderBar(PLAIN_BOARD_NAME, { ...holder, deviceId: 'dev-plain', backplaneAccess: false })

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })

  it('deploys when no vPLC is the target', async () => {
    // The editor never selects one, and neither does a LAN runtime on web.
    renderBar(VPP_BOARD_NAME, null)

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(REFUSAL)
  })
})
