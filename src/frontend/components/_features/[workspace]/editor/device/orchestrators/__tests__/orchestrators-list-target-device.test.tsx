/**
 * Edge Devices screen: the vPLC choice is a project property. Picking one
 * records it in the project's device configuration, picking the simulator
 * clears it, and a selection made elsewhere (restored on project open) shows
 * here as selected without connecting.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorPort } from '@root/middleware/shared/ports/orchestrator-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { OrchestratorsList } from '../orchestrators-list'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const edgeDevice = {
  id: 'edge-1',
  agentId: 'agent-1',
  name: 'shop-floor-01',
  description: '',
  devices: [
    { id: 'vplc-1', name: 'mixer', status: 'online', active: true },
    { id: 'vplc-2', name: 'conveyor', status: 'online', active: true },
  ],
}

const listOrchestrators = jest.fn(() => Promise.resolve([edgeDevice]))

const ports: PlatformPorts = {
  compiler: stubPort(),
  runtime: stubPort<RuntimePort>({
    getUsersInfo: () => Promise.resolve({ hasUsers: false, error: 'not connected' }),
    setDeviceContext: () => undefined,
    clearCredentials: () => Promise.resolve({ success: true }),
  }),
  debugger: stubPort(),
  simulator: stubPort(),
  project: stubPort(),
  device: stubPort(),
  orchestrator: stubPort<OrchestratorPort>({ listOrchestrators }),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: WEB_CAPABILITIES,
}

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store, ports) })

beforeEach(() => {
  store = createTestStore()
})

describe('the vPLC choice is recorded on the project', () => {
  it('picking a vPLC records it in the device configuration', async () => {
    render(<OrchestratorsList />)
    await userEvent.click(await screen.findByText('shop-floor-01'))
    await userEvent.click(await screen.findByText('conveyor'))

    expect(store.getState().deviceDefinitions.configuration.targetDevice).toEqual({
      orchestratorId: 'edge-1',
      deviceId: 'vplc-2',
      deviceName: 'conveyor',
    })
    expect(store.getState().deviceUpdated.updated).toBe(true)
  })

  it('picking the simulator clears it', async () => {
    store
      .getState()
      .deviceActions.setTargetDevice({ orchestratorId: 'edge-1', deviceId: 'vplc-1', deviceName: 'mixer' })
    render(<OrchestratorsList />)
    await screen.findByText('shop-floor-01')

    await userEvent.click(screen.getByText('OpenPLC Simulator'))

    expect(store.getState().deviceDefinitions.configuration.targetDevice).toBeUndefined()
  })
})

describe('a selection made outside this screen', () => {
  it('shows as selected, expanded and ready to connect, without connecting', async () => {
    store.getState().deviceActions.setSelectedDevice({
      orchestratorId: 'edge-1',
      orchestratorAgentId: 'agent-1',
      deviceId: 'vplc-1',
      deviceName: 'mixer',
    })
    render(<OrchestratorsList />)

    // Expanded without a click: the row is only rendered under an expanded Edge Device.
    await waitFor(() => expect(screen.getByText('mixer')).toBeTruthy())
    expect(document.getElementById('connection-actions')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
    expect(store.getState().runtimeConnection.connectionStatus).toBe('disconnected')
  })
})
