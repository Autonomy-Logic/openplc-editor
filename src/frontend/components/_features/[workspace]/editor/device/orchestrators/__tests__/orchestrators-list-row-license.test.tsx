/**
 * Edge Devices screen: the licence badge on each vPLC row, read from the vPLC's public licence endpoint
 * through `OrchestratorPort.getRuntimeLicenseStatus`.
 *
 * Rendered against stub ports and a fresh store.
 */

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { OrchestratorPort, PublicRuntimeLicenseStatus } from '@root/middleware/shared/ports/orchestrator-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { act, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
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
const getRuntimeLicenseStatus = vi.fn()

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
  orchestrator: stubPort<OrchestratorPort>({
    listOrchestrators,
    getRuntimeLicenseStatus: (agentId, deviceId) =>
      getRuntimeLicenseStatus(agentId, deviceId) as Promise<PublicRuntimeLicenseStatus>,
  }),
  system: stubPort(),
  window: stubPort(),
  accelerator: stubPort(),
  theme: stubPort(),
  versionControl: stubPort(),
  navigation: stubPort(),
  library: stubPort(),
  capabilities: WEB_CAPABILITIES,
}

const STATUS_BY_DEVICE: Record<string, PublicRuntimeLicenseStatus> = {
  'vplc-commercial': 'commercial',
  'vplc-gpl': 'gpl',
  'vplc-mit': 'mit',
  'vplc-unknown': 'unknown',
  'vplc-stopped': 'commercial',
}

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store, ports) })

/** Text of the licence badge in the row that shows `name`, or null when the row has none. */
const rowBadge = (name: string) => {
  const row = screen.getByText(name).parentElement
  if (!row) return null
  return within(row).queryByTitle('Runtime license')?.textContent?.trim() ?? null
}

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
      devices: [
        { id: 'vplc-commercial', name: 'mixer', status: 'online', active: true },
        { id: 'vplc-gpl', name: 'filler', status: 'online', active: true },
        { id: 'vplc-mit', name: 'capper', status: 'online', active: true },
        { id: 'vplc-unknown', name: 'labeler', status: 'online', active: true },
        { id: 'vplc-stopped', name: 'palletizer', status: 'offline', active: false },
      ],
    },
  ])
  getRuntimeLicenseStatus.mockImplementation((_agentId: string, deviceId: string) =>
    Promise.resolve(STATUS_BY_DEVICE[deviceId] ?? 'unknown'),
  )
  store.getState().deviceActions.setSelectedDevice({
    orchestratorId: 'edge-1',
    orchestratorAgentId: 'agent-1',
    deviceId: 'vplc-commercial',
    deviceName: 'mixer',
  })
})

describe('the licence badge on each vPLC row', () => {
  it('shows Commercial, GPLv3 and MIT as each vPLC reports it, and nothing while unknown', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(rowBadge('mixer')).toBe('Commercial'))
    await waitFor(() => expect(rowBadge('filler')).toBe('GPLv3'))
    await waitFor(() => expect(rowBadge('capper')).toBe('MIT'))
    expect(rowBadge('labeler')).toBeNull()
    expect(getRuntimeLicenseStatus).toHaveBeenCalledWith('agent-1', 'vplc-gpl')
  })

  it('does not ask a vPLC that is not running', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(rowBadge('mixer')).toBe('Commercial'))
    expect(getRuntimeLicenseStatus).not.toHaveBeenCalledWith('agent-1', 'vplc-stopped')
    expect(rowBadge('palletizer')).toBeNull()
  })

  it('hides the badge of a vPLC that stopped since it was read', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(rowBadge('filler')).toBe('GPLv3'))
    listOrchestrators.mockResolvedValue([
      {
        id: 'edge-1',
        agentId: 'agent-1',
        name: 'shop-floor-01',
        description: '',
        devices: [
          { id: 'vplc-commercial', name: 'mixer', status: 'online', active: true },
          { id: 'vplc-gpl', name: 'filler', status: 'offline', active: false },
        ],
      },
    ])
    await act(async () => screen.getByRole('button', { name: 'Refresh Edge Devices' }).click())
    await waitFor(() => expect(screen.getByText('filler').parentElement?.className).toContain('cursor-not-allowed'))
    expect(rowBadge('filler')).toBeNull()
    expect(rowBadge('mixer')).toBe('Commercial')
  })

  it('reads the rows again once the connected runtime licence check settles', async () => {
    render(<OrchestratorsList />)
    await waitFor(() => expect(rowBadge('mixer')).toBe('Commercial'))
    getRuntimeLicenseStatus.mockImplementation((_agentId: string, deviceId: string) =>
      Promise.resolve(deviceId === 'vplc-commercial' ? 'gpl' : (STATUS_BY_DEVICE[deviceId] ?? 'unknown')),
    )
    act(() => store.getState().deviceActions.setRuntimeCommercialLicenseStatus('unlicensed'))
    await waitFor(() => expect(rowBadge('mixer')).toBe('GPLv3'))
  })
})
