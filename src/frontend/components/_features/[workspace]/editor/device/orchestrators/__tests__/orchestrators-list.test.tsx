import { openPLCStoreBase } from '@root/frontend/store'
import type { OrchestratorInfo } from '@root/middleware/shared/ports/orchestrator-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort } from '@root/middleware/shared/ports/runtime-port'
import { PlatformProvider } from '@root/middleware/shared/providers'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { OrchestratorsList } from '../orchestrators-list'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const ORCHESTRATOR: OrchestratorInfo = {
  id: 'orch-1',
  name: 'Factory floor',
  agentId: 'agent-1',
  description: null,
  devices: [
    { id: 'dev-holder', name: 'Line A', status: 'online', active: true, backplaneAccess: true },
    { id: 'dev-plain', name: 'Line B', status: 'online', active: true, backplaneAccess: false },
    { id: 'dev-legacy', name: 'Line C', status: 'online', active: true },
    { id: 'dev-down', name: 'Line D', status: 'offline', active: false },
  ],
}

function renderPicker() {
  const ports: PlatformPorts = {
    compiler: stubPort(),
    runtime: stubPort<RuntimePort>({ getUsersInfo: () => Promise.resolve({ hasUsers: true }) }),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: { listOrchestrators: () => Promise.resolve([ORCHESTRATOR]) },
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
      <OrchestratorsList />
    </PlatformProvider>,
  )
}

/** Expand the orchestrator, then click the row carrying `deviceName`. */
async function selectDevice(deviceName: string) {
  fireEvent.click(await screen.findByText('Factory floor'))
  fireEvent.click(await screen.findByText(deviceName))
}

async function connect() {
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(openPLCStoreBase.getState().runtimeConnection.selectedDevice).not.toBeNull())
  return openPLCStoreBase.getState().runtimeConnection.selectedDevice
}

describe('OrchestratorsList', () => {
  beforeEach(() => {
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
  })

  afterEach(() => {
    cleanup()
    openPLCStoreBase.getState().deviceActions.clearRuntimeConnection()
  })

  it('carries backplaneAccess=true into the selected device', async () => {
    renderPicker()
    await selectDevice('Line A')
    expect(await connect()).toMatchObject({ deviceId: 'dev-holder', backplaneAccess: true })
  })

  it('carries backplaneAccess=false into the selected device', async () => {
    renderPicker()
    await selectDevice('Line B')
    expect(await connect()).toMatchObject({ deviceId: 'dev-plain', backplaneAccess: false })
  })

  it('stores no backplaneAccess at all when the host did not report it', async () => {
    // A host predating the field must not be recorded as one that answered no.
    renderPicker()
    await selectDevice('Line C')
    const selected = await connect()
    expect(selected?.deviceId).toBe('dev-legacy')
    expect(selected && 'backplaneAccess' in selected).toBe(false)
  })

  it('marks only the device that holds the backplane', async () => {
    renderPicker()
    fireEvent.click(await screen.findByText('Factory floor'))
    const badges = await screen.findAllByText('Backplane I/O')
    expect(badges).toHaveLength(1)
    expect(badges[0].closest('div')?.textContent).toContain('Line A')
  })

  it('still refuses to select an inactive device', async () => {
    renderPicker()
    await selectDevice('Line D')
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })
})
