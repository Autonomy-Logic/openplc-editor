import { openPLCStoreBase } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Board } from '../board'

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

function renderBoard(
  selectedDevice: SelectedDevice | null,
  capabilities: PlatformPorts['capabilities'] = WEB_CAPABILITIES,
) {
  const { deviceActions } = openPLCStoreBase.getState()
  deviceActions.setAvailableOptions({
    availableBoards: new Map([
      ['OpenPLC Runtime', PLAIN_BOARD],
      [VPP_BOARD_NAME, VPP_BOARD],
    ]),
  })
  deviceActions.setSelectedDevice(selectedDevice)

  const ports: PlatformPorts = {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort({ getPreviewImage: () => Promise.resolve('') }),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities,
  }
  render(
    <PlatformProvider ports={ports}>
      <Board />
    </PlatformProvider>,
  )
  // Radix Select opens on Enter — a keydown keeps the test deterministic across
  // both repos' runners, whose jsdom PointerEvent support differs.
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Device selection' }), { key: 'Enter' })
}

/** The dropdown row for a board, whatever markup wraps its label. */
function boardOption(name: string) {
  return screen.getByText(name).closest('[role="option"]')
}

const holder: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-holder',
  deviceName: 'Line A',
  backplaneAccess: true,
}

describe('Board device list', () => {
  beforeEach(() => {
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
  })

  afterEach(() => {
    cleanup()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
  })

  it('offers a VPP board on the vPLC that holds the backplane', () => {
    renderBoard(holder)
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('disables a VPP board with the reason on a vPLC without backplane access', () => {
    renderBoard({ ...holder, deviceId: 'dev-plain', backplaneAccess: false })
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('leaves an ordinary board alone on a vPLC without backplane access', () => {
    // The gate is about vendor packages; no built-in target touches the backplane.
    renderBoard({ ...holder, deviceId: 'dev-plain', backplaneAccess: false })
    expect(boardOption('OpenPLC Runtime')?.getAttribute('data-disabled')).toBeNull()
  })

  it('offers a VPP board when the host reported no flag at all', () => {
    // A host predating the field must not have its silence read as a refusal.
    renderBoard({ orchestratorId: 'orch-1', orchestratorAgentId: 'agent-1', deviceId: 'dev-old', deviceName: 'Line C' })
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  // A vendor board comes from the package its vPLC was created with, so with
  // no vPLC selected there is nothing it could be built for.
  it('disables a VPP board with the reason when no vPLC is the target', () => {
    renderBoard(null)
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByText(/Select a vPLC before building/)).toBeTruthy()
  })

  it('leaves an ordinary board alone when no vPLC is the target', () => {
    renderBoard(null)
    expect(boardOption('OpenPLC Runtime')?.getAttribute('data-disabled')).toBeNull()
  })

  it('offers a VPP board on the vPLC that runs its package', () => {
    renderBoard({ ...holder, vpp: { packageId: 'com.acme.backplane', version: '1.0.0', contentHash: 'sha256:x' } })
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
  })

  it('disables a VPP board from another package and names the one the vPLC runs', () => {
    renderBoard({ ...holder, vpp: { packageId: 'com.other.board', version: '1.0.0', contentHash: 'sha256:x' } })
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getByText(/This vPLC runs com\.other\.board/)).toBeTruthy()
  })

  // A board the project names but the vPLC does not have must stay visible:
  // dropping it silently from the picker reads as lost work.
  it('keeps a board the vPLC does not have visible, marked unavailable', () => {
    const { deviceActions } = openPLCStoreBase.getState()
    deviceActions.setDeviceBoard('Vanished SLM-RP4')
    renderBoard({ ...holder, vpp: { packageId: 'com.acme.backplane', version: '1.0.0', contentHash: 'sha256:x' } })

    // Two nodes carry the name: the trigger, which is the point (it still reads
    // as the selection), and the disabled row in the list.
    const row = screen
      .getAllByText('Vanished SLM-RP4')
      .map((node) => node.closest('[role="option"]'))
      .find((option) => option !== null)
    expect(row).toBeTruthy()
    expect(row?.getAttribute('data-disabled')).not.toBeNull()
    expect(screen.getAllByText(/Not available on the selected vPLC/).length).toBeGreaterThan(0)
  })

  /**
   * The desktop's own regression. Vendor packages are installed locally here
   * and no vPLC is ever selected, so every board a package provides has to
   * stay offered — the whole vPLC-scoped rule is inert on this platform, and
   * a mistake in it would silently empty the desktop's board list.
   */
  describe('desktop', () => {
    it('offers every VPP board with no vPLC selected', () => {
      renderBoard(null, EDITOR_CAPABILITIES)
      expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
      expect(boardOption('OpenPLC Runtime')?.getAttribute('data-disabled')).toBeNull()
      expect(screen.queryByText(REFUSAL)).toBeNull()
      expect(screen.queryByText(/Select a vPLC before building/)).toBeNull()
    })

    it('says nothing about a board the project names that is not installed', () => {
      openPLCStoreBase.getState().deviceActions.setDeviceBoard('Vanished SLM-RP4')
      renderBoard(null, EDITOR_CAPABILITIES)
      expect(screen.queryByText(/Not available on the selected vPLC/)).toBeNull()
    })
  })

})
