/**
 * What the debugger offers when no session exists: a runtime is named with its
 * configured address, a device picked in Orchestrators by its name only, and a
 * desktop runtime with no address is told to set one instead of being offered
 * a connect that cannot try anything.
 */
import type { OpenPLCStore } from '@root/frontend/store'
import type { SelectedDevice } from '@root/frontend/store/slices/device/types'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import {
  EDITOR_CAPABILITIES,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DefaultWorkspaceActivityBar } from '../default'

function stubPort<T extends object>(overrides: Partial<NoInfer<T>> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const RUNTIME_BOARD_NAME = 'OpenPLC Runtime v4'
const RUNTIME_BOARD: BoardInfo = { compiler: 'openplc-compiler', core: 'openplc', preview: 'generic.png', specs: {} }

const device: SelectedDevice = {
  orchestratorId: 'orch-1',
  orchestratorAgentId: 'agent-1',
  deviceId: 'dev-1',
  deviceName: 'Line A',
}

const getUsersInfo = jest.fn(() => Promise.resolve({ hasUsers: true }))

let store: OpenPLCStore

function renderBar(options: { ip: string; selected: SelectedDevice | null; capabilities: PlatformCapabilities }) {
  const { deviceActions, workspaceActions } = store.getState()
  deviceActions.setAvailableOptions({ availableBoards: new Map([[RUNTIME_BOARD_NAME, RUNTIME_BOARD]]) })
  deviceActions.setDeviceBoard(RUNTIME_BOARD_NAME)
  deviceActions.setRuntimeIpAddress(options.ip)
  deviceActions.setSelectedDevice(options.selected)
  workspaceActions.setCanEdit(false)

  const ports: PlatformPorts = {
    compiler: stubPort(),
    runtime: stubPort({ getUsersInfo }),
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
    capabilities: options.capabilities,
  }
  render(<DefaultWorkspaceActivityBar />, { wrapper: createStoreWrapper(store, ports) })
  fireEvent.click(screen.getByRole('button', { name: 'Debugger' }))
}

/** The open debugger dialog's title and message, or null while none is open. */
function openDialog(): { title: string; message: string } | null {
  const { open, data } = store.getState().modalActions.getModalState('debugger-message')
  if (!open || typeof data !== 'object' || data === null) return null
  const title = 'title' in data && typeof data.title === 'string' ? data.title : ''
  const message = 'message' in data && typeof data.message === 'string' ? data.message : ''
  return { title, message }
}

describe('debugger connect offer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    store = createTestStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('asks for an IP address instead of offering a connect when a desktop runtime has none', async () => {
    renderBar({ ip: '', selected: null, capabilities: EDITOR_CAPABILITIES })

    await waitFor(() => expect(openDialog()?.title).toBe('No IP Address'))
    expect(openDialog()?.message).toContain("Set the runtime's IP address")
    expect(getUsersInfo).not.toHaveBeenCalled()
  })

  it('names a desktop runtime with its configured address', async () => {
    renderBar({ ip: '192.168.1.188', selected: null, capabilities: EDITOR_CAPABILITIES })

    await waitFor(() => expect(openDialog()?.title).toBe('Not Connected'))
    expect(openDialog()?.message).toContain('connect to OpenPLC Runtime v4 at 192.168.1.188 now?')
  })

  it('names a device picked in Orchestrators by its name only', async () => {
    renderBar({ ip: '', selected: device, capabilities: WEB_CAPABILITIES })

    await waitFor(() => expect(openDialog()?.title).toBe('Not Connected'))
    expect(openDialog()?.message).toContain('connect to "Line A" now?')
  })
})
