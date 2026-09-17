import { openPLCStoreBase } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
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

function renderBoard(selectedDevice: SelectedDevice | null) {
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
    capabilities: WEB_CAPABILITIES,
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

  it('offers a VPP board when no vPLC is the target', () => {
    // The editor never selects one, and neither does a LAN runtime on web.
    renderBoard(null)
    expect(boardOption(VPP_BOARD_NAME)?.getAttribute('data-disabled')).toBeNull()
  })
})
