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

const PLAIN_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

const DOWNLOADING: VppTargetLoadState = { status: 'downloading', loaded: 4_200_000, total: 11_100_000 }
const CANCELED: VppTargetLoadState = { status: 'error', reason: 'canceled', message: 'Download canceled' }

/** A vPLC created with the package the project's vendor board comes from. */
const vplc: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-holder',
  deviceName: 'Line A',
  backplaneAccess: true,
  vpp: { packageId: 'com.acme.backplane', version: '1.0.0', contentHash: 'sha256:x' },
}

const compileForDebug = vi.fn(() => Promise.resolve({ success: true }))
const compileProgram = vi.fn(() => Promise.resolve({ success: false, error: 'upload not exercised' }))

let store: OpenPLCStore

/** Renders the bar for a project on the vendor board, which is not resolved because its package did not load. */
function renderBar(loadState: VppTargetLoadState) {
  const { deviceActions, workspaceActions, consoleActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[PLAIN_BOARD_NAME, PLAIN_BOARD]]) })
  deviceActions.setDeviceBoard(VPP_BOARD_NAME)
  deviceActions.setSelectedDevice(vplc)
  deviceActions.setDeviceConnectionStatus('connected')
  workspaceActions.setCanEdit(false)
  consoleActions.clearLogs()

  const ports = createTestPorts({
    capabilities: WEB_CAPABILITIES,
    compiler: { compileForDebug, compileProgram },
    debugger: {
      readProgramMd5: () => Promise.resolve({ success: true, md5: 'local-md5' }),
      connect: () => Promise.resolve({ success: true }),
      verifyMd5: () => Promise.resolve({ success: true, match: false, targetMd5: 'device-md5' }),
      disconnect: () => Promise.resolve({ success: true }),
    },
    packages: createTestPackagesPort(loadState).port,
  })
  render(<DefaultWorkspaceActivityBar />, { wrapper: createStoreWrapper(store, ports) })
}

function startDebugSession() {
  fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))
}

function loggedMessages() {
  return store.getState().logs.map((entry) => entry.message)
}

function uploadOffered(): boolean {
  return store.getState().modalActions.getModalState('debugger-message').open
}

describe('MD5 mismatch upload while the vPLC package is not loaded', () => {
  beforeEach(() => {
    compileForDebug.mockClear()
    compileProgram.mockClear()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('refuses after a failed load, saying the package did not load, and offers no upload', async () => {
    renderBar(CANCELED)

    startDebugSession()

    await waitFor(() => expect(loggedMessages()).toContain(DID_NOT_LOAD))
    expect(loggedMessages().some((message) => message.includes('which the selected vPLC does not have'))).toBe(false)
    expect(uploadOffered()).toBe(false)
    expect(compileProgram).not.toHaveBeenCalled()
  })

  it('refuses while the package loads, saying it is still loading', async () => {
    renderBar(DOWNLOADING)

    startDebugSession()

    await waitFor(() => expect(loggedMessages()).toContain(STILL_LOADING))
    expect(uploadOffered()).toBe(false)
    expect(compileProgram).not.toHaveBeenCalled()
  })
})
