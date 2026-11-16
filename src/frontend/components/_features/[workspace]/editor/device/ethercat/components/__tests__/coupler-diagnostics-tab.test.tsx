import { createDefaultSlaveConfig } from '@root/backend/shared/ethercat/device-config-defaults'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import type {
  DiagnosticsSnapshot,
  EtherCATDiagnosticsPort,
} from '@root/middleware/shared/ports/ethercat-diagnostics-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { render, screen } from '@testing-library/react'

import { CouplerDiagnosticsTab } from '../coupler-diagnostics-tab'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const device: ConfiguredEtherCATDevice = {
  id: 'c',
  position: 2,
  name: 'Coupler',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x230',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings: [],
  isModularCoupler: true,
  modules: [
    {
      id: 'a',
      slot: 1,
      name: 'DI',
      ident: '0x1',
      esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
      channelMappings: [],
    },
    {
      id: 'b',
      slot: 2,
      name: 'DO',
      ident: '0x2',
      esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x2' },
      channelMappings: [],
    },
  ],
}

function renderWith(snapshot: DiagnosticsSnapshot) {
  const pollDiagnostics = jest.fn<
    ReturnType<EtherCATDiagnosticsPort['pollDiagnostics']>,
    Parameters<EtherCATDiagnosticsPort['pollDiagnostics']>
  >(() => Promise.resolve({ success: true, snapshot }))
  const ports: PlatformPorts = {
    compiler: stubPort(),
    runtime: stubPort(),
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
    ethercatDiagnostics: { pollDiagnostics },
    capabilities: WEB_CAPABILITIES,
  }
  render(<CouplerDiagnosticsTab device={device} busName='Bus' />, {
    wrapper: createStoreWrapper(createTestStore(), ports),
  })
  return pollDiagnostics
}

describe('CouplerDiagnosticsTab', () => {
  it('polls the coupler by bus name and position and shows the decoded states', async () => {
    const poll = renderWith({
      coupler: { statusWord: 0x40, pollAt: 0 },
      modules: [
        { slot: 1, statusByte: 0x00 },
        { slot: 2, statusByte: 0x82 },
      ],
    })
    expect(await screen.findByText(/I\/O configuration error/)).toBeTruthy()
    expect(screen.queryByText(/Master configuration error/)).toBeNull()
    expect(screen.getByText('Operational')).toBeTruthy()
    expect(screen.getByText('No module in this slot')).toBeTruthy()
    expect(poll).toHaveBeenCalledWith({ busName: 'Bus', slavePosition: 2 })
  })

  it('says what could not be read instead of decoding it', async () => {
    renderWith({ coupler: { statusWord: null, pollAt: 0 }, modules: [{ slot: 1, statusByte: null }] })
    expect(await screen.findByText('The coupler status could not be read.')).toBeTruthy()
    expect(screen.getByText('Status could not be read')).toBeTruthy()
    expect(screen.getByText('No status reported')).toBeTruthy()
    expect(screen.queryByText(/configuration error/)).toBeNull()
  })
})
