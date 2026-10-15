import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESIDevice,
  ESIModule,
  ESIRepositoryItemLight,
  ESISlotsSpec,
} from '@root/middleware/shared/ports/esi-types'
import type { EtherCATScanPort, ScanResponse } from '@root/middleware/shared/ports/ethercat-scan-port'
import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { buildModuleForSlot, findModuleByIdent } from '@root/middleware/shared/utils/ethercat'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createDefaultSlaveConfig } from '@root/backend/shared/ethercat/device-config-defaults'
import { ModulesTab } from '../modules-tab'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

const increments = { slotIndexIncrement: 16, slotPdoIncrement: 1 }

const moduleOf = (ident: string, name: string, moduleClass: string): ESIModule => ({
  ident,
  name,
  moduleClass,
  rxPdo: [],
  txPdo: [
    {
      index: '0x1A00',
      name: 'Input',
      fixed: true,
      mandatory: true,
      dependOnSlot: true,
      entries: [{ index: '0x6000', subIndex: '0x01', bitLen: 1, name: 'DI1', dataType: 'BOOL', dependOnSlot: true }],
    },
  ],
  initCmds: [],
})

const DI = moduleOf('0x00091F84', 'UR20-4DI-P', 'Di')
const AI = moduleOf('0x040115C4', 'UR20-4AI-UI-16', 'Ai')

const repository: ESIRepositoryItemLight[] = [
  {
    id: 'ur20-io',
    filename: 'Weidmueller_UR20_IO.xml',
    vendor: { id: '0x230', name: 'Weidmueller' },
    devices: [],
    modules: [
      { ident: DI.ident, name: DI.name, moduleClass: 'Di' },
      { ident: AI.ident, name: AI.name, moduleClass: 'Ai' },
    ],
    loadedAt: '2026-01-01T00:00:00.000Z',
  },
]

const spec = (over: Partial<ESISlotsSpec> = {}): ESISlotsSpec => ({
  slots: [{ minInstances: 0, maxInstances: 2, moduleClasses: ['Di'] }],
  ...increments,
  downloadModuleIdentList: true,
  ...over,
})

const couplerEsi = (slots: ESISlotsSpec): ESIDevice => ({
  type: { productCode: '0x1', revisionNo: '0x1', name: 'UR20-FBC-EC' },
  name: 'UR20-FBC-EC',
  fmmu: [],
  syncManagers: [],
  rxPdo: [],
  txPdo: [],
  slots,
  isModularCoupler: true,
})

const coupler = (modules: ConfiguredEtherCATModule[] = []): ConfiguredEtherCATDevice => ({
  id: 'c',
  position: 1,
  name: 'Coupler',
  esiDeviceRef: { repositoryItemId: 'ur20-fbc', deviceIndex: 0 },
  vendorId: '0x00000230',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings: [],
  isModularCoupler: true,
  modules,
})

const placed = (id: string, slot: number, esiModule = DI): ConfiguredEtherCATModule =>
  buildModuleForSlot({ id, slot, esiModule, increments, repositoryItemId: 'ur20-io', usedAddresses: new Set() })

function setup(options: {
  modules?: ConfiguredEtherCATModule[]
  slots?: ESISlotsSpec
  scan?: ScanResponse['modules']
  deviceLoad?: Promise<{ success: true; device: ESIDevice }>
  networkInterface?: string
}) {
  const slots = options.slots ?? spec()
  const esi = stubPort<EsiPort>({
    loadDeviceFull: () => options.deviceLoad ?? Promise.resolve({ success: true, device: couplerEsi(slots) }),
    loadModuleFull: (_id: string, ident: string) => {
      const found = findModuleByIdent([DI, AI], ident)
      return Promise.resolve(found ? { success: true, module: found } : { success: false, error: 'none' })
    },
  })
  const scanModules = jest.fn<ReturnType<EtherCATScanPort['scanModules']>, Parameters<EtherCATScanPort['scanModules']>>(
    () => Promise.resolve({ success: true, scan: { slavePosition: 1, modules: options.scan ?? [] } }),
  )
  const ethercatScan = stubPort<EtherCATScanPort>({ scanModules })
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
    esi,
    ethercatScan,
    capabilities: WEB_CAPABILITIES,
  }
  const onUpdateModules = jest.fn<void, [ConfiguredEtherCATModule[]]>()
  const store = createTestStore()
  if (options.networkInterface !== undefined) {
    store.getState().remoteDeviceActions.create({ name: 'Bus', protocol: 'ethercat' })
    const { project } = store.getState()
    store.getState().projectActions.setProject({
      ...project,
      data: {
        ...project.data,
        remoteDevices: (project.data.remoteDevices ?? []).map((d) =>
          d.name === 'Bus'
            ? {
                ...d,
                ethercatConfig: {
                  ...d.ethercatConfig,
                  devices: d.ethercatConfig?.devices ?? [],
                  masterConfig: {
                    enabled: true,
                    networkInterface: options.networkInterface ?? '',
                    cycleTimeUs: 1000,
                  },
                },
              }
            : d,
        ),
      },
    })
  }
  render(
    <ModulesTab
      device={coupler(options.modules)}
      busName='Bus'
      repository={repository}
      onUpdateModules={onUpdateModules}
      externalUsedAddresses={new Set()}
    />,
    { wrapper: createStoreWrapper(store, ports) },
  )
  return { onUpdateModules, scanModules }
}

const button = (label: string) => screen.getByRole('button', { name: label })

describe('ModulesTab', () => {
  it('keeps Add disabled until the coupler ESI has loaded', async () => {
    let resolve: (v: { success: true; device: ESIDevice }) => void = () => undefined
    const deviceLoad = new Promise<{ success: true; device: ESIDevice }>((r) => {
      resolve = r
    })
    setup({ deviceLoad })
    expect(button('Add Module')).toHaveProperty('disabled', true)
    resolve({ success: true, device: couplerEsi(spec()) })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
  })

  it('adds a scanned module in its 1-based slot with a fresh id; an unknown ident is reported', async () => {
    const { onUpdateModules } = setup({
      scan: [
        { slot: 1, ident: '0x00091f84' },
        { slot: 2, ident: '0x12345678' },
      ],
    })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(button('Scan'))
    await screen.findByText('No XML')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select module at slot 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select module at slot 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Selected/ }))
    await waitFor(() => expect(onUpdateModules).toHaveBeenCalled())
    const added = onUpdateModules.mock.calls[0]?.[0] ?? []
    expect(added.map((m) => [m.slot, m.name, m.txPdos?.[0]?.index])).toEqual([[1, 'UR20-4DI-P', '0x1A00']])
    expect(added[0]?.id).not.toMatch(/^slot-/)
    expect(await screen.findByText('Missing ESI XML for some modules')).toBeTruthy()
  })

  it('marks a scanned module the coupler does not accept and refuses to place it', async () => {
    const { onUpdateModules } = setup({ scan: [{ slot: 1, ident: AI.ident }] })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(button('Scan'))
    expect(await screen.findByText('Not supported')).toBeTruthy()
    expect(screen.getByText('UR20-4AI-UI-16')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select module at slot 1' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Selected/ }))
    await waitFor(() => expect(onUpdateModules).toHaveBeenCalled())
    expect(onUpdateModules.mock.calls[0]?.[0]).toEqual([])
  })

  it('refuses a scanned module beyond MaxInstances and keeps the ones that fit', async () => {
    const { onUpdateModules } = setup({
      slots: spec({ slots: [{ minInstances: 0, maxInstances: 1, moduleClasses: ['Di'] }] }),
      scan: [
        { slot: 1, ident: DI.ident },
        { slot: 2, ident: DI.ident },
      ],
    })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(button('Scan'))
    await screen.findByRole('checkbox', { name: 'Select module at slot 2' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select module at slot 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select module at slot 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Add Selected/ }))
    await waitFor(() => expect(onUpdateModules).toHaveBeenCalled())
    expect(onUpdateModules.mock.calls[0]?.[0].map((m) => m.slot)).toEqual([1])
  })

  it('removing a module moves the following ones up a slot', async () => {
    const { onUpdateModules } = setup({ modules: [placed('a', 1), placed('b', 2)] })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getAllByText('UR20-4DI-P')[0])
    fireEvent.click(button('Remove Module'))
    expect(onUpdateModules.mock.calls[0]?.[0].map((m) => [m.id, m.slot, m.txPdos?.[0]?.index])).toEqual([
      ['b', 1, '0x1A00'],
    ])
  })

  it('moving a module down swaps it with the next one', async () => {
    const { onUpdateModules } = setup({ modules: [placed('a', 1), placed('b', 2)] })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(screen.getAllByText('UR20-4DI-P')[0])
    expect(button('Move Module Up')).toHaveProperty('disabled', true)
    fireEvent.click(button('Move Module Down'))
    expect(onUpdateModules.mock.calls[0]?.[0].map((m) => [m.id, m.slot])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
  })

  it('scans with the bus network interface so a bus not uploaded yet can be scanned', async () => {
    const { scanModules } = setup({ scan: [], networkInterface: 'eth1' })
    await waitFor(() => expect(button('Add Module')).toHaveProperty('disabled', false))
    fireEvent.click(button('Scan'))
    await waitFor(() => expect(scanModules).toHaveBeenCalled())
    expect(scanModules.mock.calls[0]?.[0]).toEqual({ busName: 'Bus', slavePosition: 1, networkInterface: 'eth1' })
  })
})
