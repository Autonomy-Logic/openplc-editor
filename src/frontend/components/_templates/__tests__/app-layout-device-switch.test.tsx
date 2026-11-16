import { act, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@root/frontend/components/_organisms/modals/export-pdf-modal', () => ({ ExportPdfModal: () => null }))
vi.mock('@root/frontend/components/_organisms/modals/project-readme-modal', () => ({
  ProjectReadmeModal: () => null,
}))

import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../../middleware/shared/ports/project-port'
import type { SystemPort } from '../../../../middleware/shared/ports/system-port'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { OpenPLCStore } from '../../../store'
import { createStoreWrapper, createTestStore } from '../../../store/testing'
import { AppLayout } from '../app-layout'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function makePorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort<ProjectPort>({ getRecentProjects: () => Promise.resolve([]) }),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort<SystemPort>({
      getSystemInfo: () =>
        Promise.resolve({ OS: 'darwin', architecture: 'arm', isWindowMaximized: false, prefersDarkMode: true }),
    }),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
  }
}

const PROMPT = 'Switching devices will disconnect you from the runtime.'

let store: OpenPLCStore
let onConfirmCalls: number

async function renderConnectedAndRequestSwitch() {
  store = createTestStore()
  onConfirmCalls = 0
  render(<AppLayout />, { wrapper: createStoreWrapper(store, makePorts()) })
  await act(async () => {
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    store.getState().modalActions.openModal('confirm-device-switch', {
      newBoard: 'ESP32',
      formattedNewBoard: 'ESP32',
      onConfirm: () => {
        onConfirmCalls += 1
      },
    })
    await Promise.resolve()
  })
}

describe('device switch confirmation in the app layout', () => {
  it('is shown when a board change is requested while connected', async () => {
    await renderConnectedAndRequestSwitch()

    expect(screen.queryByText(PROMPT)).not.toBeNull()
  })

  it('cancel keeps the connection and does not apply the board', async () => {
    await renderConnectedAndRequestSwitch()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(onConfirmCalls).toBe(0)
    expect(store.getState().runtimeConnection.connectionStatus).toBe('connected')
    expect(store.getState().modals['confirm-device-switch'].open).toBe(false)
    expect(screen.queryByText(PROMPT)).toBeNull()
  })

  it('confirm disconnects and applies the board', async () => {
    await renderConnectedAndRequestSwitch()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch Device' }))
    })

    expect(onConfirmCalls).toBe(1)
    expect(store.getState().runtimeConnection.connectionStatus).toBe('disconnected')
    expect(store.getState().modals['confirm-device-switch'].open).toBe(false)
  })
})
