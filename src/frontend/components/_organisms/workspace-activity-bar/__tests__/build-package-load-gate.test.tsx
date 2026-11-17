import type { OpenPLCStore } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { createTestPackagesPort } from '@root/frontend/store/testing-packages'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { VppTargetLoadState } from '@root/middleware/shared/ports/vpp-target-mechanisms'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

const STILL_LOADING =
  'The package of the selected vPLC is still loading. Wait until it finishes in Device > Edge Devices.'
const DID_NOT_LOAD = 'The package of the selected vPLC did not load. Open Device > Edge Devices and click Try again.'

const PLAIN_BOARD_NAME = 'OpenPLC Runtime'
const VPP_BOARD_NAME = 'Acme SLM-RP4'
const PACKAGE_ID = 'com.acme.backplane'

const PLAIN_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const VPP_BOARD: BoardInfo = {
  ...PLAIN_BOARD,
  vpp: {
    packageId: PACKAGE_ID,
    vendor: 'Acme',
    deviceId: 'slm-rp4',
    packagePath: `/packages/${PACKAGE_ID}`,
    screens: {},
    moduleSystem: null,
  },
}

const DOWNLOADING: VppTargetLoadState = { status: 'downloading', loaded: 4_200_000, total: 11_100_000 }
const CANCELED: VppTargetLoadState = { status: 'error', reason: 'canceled', message: 'Download canceled' }

/** A vPLC created with the package the vendor board comes from. */
const vplc: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-holder',
  deviceName: 'Line A',
  backplaneAccess: true,
  vpp: { packageId: PACKAGE_ID, version: '1.0.0', contentHash: 'sha256:x' },
}

const compileProgram = vi.fn(() => Promise.resolve({ success: true }))

let store: OpenPLCStore

/**
 * Renders the bar for a project on the vendor board, against the vPLC that runs its package. The board is
 * resolved only when the package loaded, as it is after a successful load.
 */
function renderBar(loadState: VppTargetLoadState, options: { vendorBoardResolved: boolean }) {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  const boards = new Map([[PLAIN_BOARD_NAME, PLAIN_BOARD]])
  if (options.vendorBoardResolved) boards.set(VPP_BOARD_NAME, VPP_BOARD)
  deviceActions.setAvailableOptions({ availableBoards: boards })
  deviceActions.setDeviceBoard(VPP_BOARD_NAME)
  deviceActions.setSelectedDevice(vplc)
  deviceActions.setRuntimeConnectionStatus('connected')
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports = createTestPorts({
    capabilities: WEB_CAPABILITIES,
    compiler: { compileProgram },
    packages: createTestPackagesPort(loadState).port,
  })
  render(<DefaultWorkspaceActivityBar />, { wrapper: createStoreWrapper(store, ports) })
}

function chooseBuildOption(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Build options' }))
  const row = screen.getByText(label).closest('button')
  if (!row) throw new Error(`build option "${label}" rendered without a button`)
  fireEvent.click(row)
}

function loggedMessages() {
  return store.getState().logs.map((entry) => entry.message)
}

describe('Build while the vPLC package is not loaded', () => {
  beforeEach(() => {
    compileProgram.mockClear()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('refuses after a failed load, saying the package did not load', async () => {
    renderBar(CANCELED, { vendorBoardResolved: false })

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(loggedMessages()).toContain(DID_NOT_LOAD))
    expect(loggedMessages().some((message) => message.includes('which the selected vPLC does not have'))).toBe(false)
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('refuses while the package loads, saying it is still loading', async () => {
    renderBar(DOWNLOADING, { vendorBoardResolved: false })

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(loggedMessages()).toContain(STILL_LOADING))
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('builds as before once the package loaded', async () => {
    renderBar({ status: 'ready' }, { vendorBoardResolved: true })

    chooseBuildOption('Build and upload')

    await waitFor(() => expect(compileProgram).toHaveBeenCalled())
    expect(loggedMessages()).not.toContain(DID_NOT_LOAD)
    expect(loggedMessages()).not.toContain(STILL_LOADING)
  })
})
