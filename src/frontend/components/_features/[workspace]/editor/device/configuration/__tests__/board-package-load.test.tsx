import type { OpenPLCStore } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { createTestPackagesPort, type TestPackagesPort } from '@root/frontend/store/testing-packages'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { VppTargetLoadState } from '@root/middleware/shared/ports/vpp-target-mechanisms'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { Board } from '../board'

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

let store: OpenPLCStore

/** Renders the board picker for the project's vendor board, with or without that board resolved, and opens it. */
function renderBoard(packages: TestPackagesPort, options: { vendorBoardResolved: boolean }) {
  const { deviceActions } = store.getState()
  const boards = new Map([[PLAIN_BOARD_NAME, PLAIN_BOARD]])
  if (options.vendorBoardResolved) boards.set(VPP_BOARD_NAME, VPP_BOARD)
  deviceActions.setAvailableOptions({ availableBoards: boards })
  deviceActions.setDeviceBoard(VPP_BOARD_NAME)
  deviceActions.setSelectedDevice(vplc)

  const ports = createTestPorts({
    capabilities: WEB_CAPABILITIES,
    device: { getPreviewImage: () => Promise.resolve('') },
    packages: packages.port,
  })
  render(<Board />, { wrapper: createStoreWrapper(store, ports) })
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Device selection' }), { key: 'Enter' })
}

/** The dropdown row whose text includes `name`. */
function optionWith(name: string) {
  return screen
    .getAllByText(name)
    .map((node) => node.closest('[role="option"]'))
    .find((option) => option !== null)
}

describe('Board picker while the vPLC package is not loaded', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('says the package did not load on the unavailable item after a failed load', () => {
    renderBoard(createTestPackagesPort(CANCELED), { vendorBoardResolved: false })

    expect(screen.getAllByText(`Not available: ${DID_NOT_LOAD}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Not available on the selected vPLC/)).toBeNull()
  })

  it('says the package is still loading on the unavailable item while it loads', () => {
    renderBoard(createTestPackagesPort(DOWNLOADING), { vendorBoardResolved: false })

    expect(screen.getAllByText(`Not available: ${STILL_LOADING}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Not available on the selected vPLC/)).toBeNull()
  })

  it('follows the load state when the load fails while the picker is open', () => {
    const packages = createTestPackagesPort(DOWNLOADING)
    renderBoard(packages, { vendorBoardResolved: false })

    act(() => packages.push(CANCELED))

    expect(screen.getAllByText(`Not available: ${DID_NOT_LOAD}`).length).toBeGreaterThan(0)
    expect(screen.queryByText(`Not available: ${STILL_LOADING}`)).toBeNull()
  })

  it('disables a listed vendor board with the reason after a failed load', () => {
    renderBoard(createTestPackagesPort(CANCELED), { vendorBoardResolved: true })

    const row = optionWith(VPP_BOARD_NAME)
    if (!(row instanceof HTMLElement)) throw new Error('the vendor board rendered no row')
    expect(row.getAttribute('data-disabled')).not.toBeNull()
    expect(within(row).getByText(DID_NOT_LOAD)).toBeTruthy()
  })

  it('leaves an ordinary board alone after a failed load', () => {
    renderBoard(createTestPackagesPort(CANCELED), { vendorBoardResolved: true })

    expect(optionWith(PLAIN_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
  })
})
