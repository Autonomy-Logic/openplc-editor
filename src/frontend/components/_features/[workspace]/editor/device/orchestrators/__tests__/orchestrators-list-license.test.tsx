/**
 * Edge Devices screen: the runtime licence badge beside the Connect/Disconnect button of the selected vPLC.
 *
 * Rendered against stub ports and a fresh store; the licence status is set on the store directly, as the
 * licence owner hook would after a connect.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorPort } from '@root/middleware/shared/ports/orchestrator-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import type { TargetCommercialLicenseStatus } from '@root/middleware/shared/utils/licensing/target-commercial-license'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

vi.mock('@root/middleware/shared/utils/target-capabilities', () => ({
  resolveTargetCapabilities: () => ({ isInProcessSimulator: true }),
}))

import { OrchestratorsList } from '../orchestrators-list'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const listOrchestrators = vi.fn()

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

const badge = () => screen.queryByLabelText('Runtime license status')

beforeEach(() => {
  vi.clearAllMocks()
  store = createTestStore()
  store.getState().deviceActions.setDeviceBoard('OpenPLC Simulator')
  listOrchestrators.mockResolvedValue([
    {
      id: 'edge-1',
      agentId: 'agent-1',
      name: 'shop-floor-01',
      description: '',
      devices: [{ id: 'vplc-1', name: 'mixer', status: 'online', active: true }],
    },
  ])
  store.getState().deviceActions.setSelectedDevice({
    orchestratorId: 'edge-1',
    orchestratorAgentId: 'agent-1',
    deviceId: 'vplc-1',
    deviceName: 'mixer',
  })
})

/** Renders the screen with the selected vPLC connected and the given licence status. */
async function renderConnected(status: TargetCommercialLicenseStatus | null) {
  render(<OrchestratorsList />)
  await waitFor(() => expect(screen.getByText('mixer')).toBeTruthy())
  act(() => {
    store.getState().deviceActions.setRuntimeJwtToken('jwt')
    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    store.getState().deviceActions.setRuntimeCommercialLicenseStatus(status)
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy())
}

describe('the runtime licence badge on the selected vPLC', () => {
  it('is absent while the vPLC is not connected', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy())
    act(() => store.getState().deviceActions.setRuntimeCommercialLicenseStatus('unlicensed'))
    expect(badge()).toBeNull()
  })

  it.each([
    ['unlicensed', 'GPLv3'],
    ['licensed', 'Commercial license'],
    ['mit', 'MIT license'],
  ] as const)('shows %s as "%s" next to Disconnect', async (status, label) => {
    await renderConnected(status)
    await waitFor(() => expect(badge()?.textContent?.trim()).toBe(label))
    const row = screen.getByRole('button', { name: 'Disconnect' }).parentElement
    expect(row?.contains(badge())).toBe(true)
  })

  it('is absent while the status is still unknown', async () => {
    await renderConnected(null)
    expect(badge()).toBeNull()
  })
})
