import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { ConfiguredEtherCATDevice, ConfiguredEtherCATModule } from '@root/middleware/shared/ports/esi-types'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'

import { EtherCATDeviceEditor } from '../ethercat-device-editor'
import { EtherCATModuleEditor } from '../ethercat-module-editor'

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  const target: T = Object.create(null)
  return new Proxy(target, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => Promise.resolve({ success: false }) : undefined
    },
  })
}

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
  capabilities: EDITOR_CAPABILITIES,
}

const BUS = 'ethercat_bus'
const DEVICE_ID = 'device-1'
const MODULE_ID = 'module-1'

const module_: ConfiguredEtherCATModule = {
  id: MODULE_ID,
  name: 'EL1008',
  slot: 1,
  ident: '#x3f0',
  esiModuleRef: { repositoryItemId: 'item-1', moduleIdent: '#x3f0' },
  channelMappings: [],
}

const device: ConfiguredEtherCATDevice = {
  id: DEVICE_ID,
  name: 'EK1100',
  esiDeviceRef: { repositoryItemId: 'item-1', deviceIndex: 0 },
  vendorId: '#x2',
  productCode: '#x4562c52',
  revisionNo: '#x110000',
  addedFrom: 'repository',
  config: {
    startupChecks: { checkVendorId: true, checkProductCode: true },
    addressing: { ethercatAddress: 0 },
    timeouts: { sdoTimeoutMs: 3000, initToPreOpTimeoutMs: 3000, safeOpToOpTimeoutMs: 10000 },
    watchdog: { smWatchdogEnabled: true, smWatchdogMs: 100, pdiWatchdogEnabled: true, pdiWatchdogMs: 100 },
    distributedClocks: {
      dcEnabled: false,
      dcSyncUnitCycleUs: 1000,
      dcSync0Enabled: false,
      dcSync0CycleUs: 0,
      dcSync0ShiftUs: 0,
      dcSync1Enabled: false,
      dcSync1CycleUs: 0,
      dcSync1ShiftUs: 0,
    },
  },
  channelMappings: [],
  modules: [module_],
  isModularCoupler: true,
}

let store: OpenPLCStore

const seedStore = () => {
  const state = store.getState()
  store.setState({
    project: {
      ...state.project,
      meta: { ...state.project.meta, path: '/projects/ethercat' },
      data: {
        ...state.project.data,
        remoteDevices: [
          {
            name: BUS,
            protocol: 'ethercat',
            ethercatConfig: {
              masterConfig: { networkInterface: 'eth0', cycleTimeUs: 1000 },
              devices: [device],
            },
          },
        ],
      },
    },
  })
}

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const storedConfig = () =>
  store.getState().project.data.remoteDevices?.find((d) => d.name === BUS)?.ethercatConfig?.devices[0]?.config

const openTab = (name: RegExp) => {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

const sdoTimeoutInput = () => screen.getAllByRole('spinbutton')[1]

describe('the EtherCAT slave editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedStore()
  })

  it('should accept a timeout change while no debug session is open', () => {
    render(<EtherCATDeviceEditor busName={BUS} deviceId={DEVICE_ID} />, {
      wrapper: createStoreWrapper(store, ports),
    })
    openTab(/configuration/i)

    fireEvent.change(sdoTimeoutInput(), { target: { value: '4000' } })

    expect(storedConfig()?.timeouts.sdoTimeoutMs).toBe(4000)
  })

  it('should render the configuration fields inside a disabled fieldset while the debugger is open', () => {
    openDebugSession()
    render(<EtherCATDeviceEditor busName={BUS} deviceId={DEVICE_ID} />, {
      wrapper: createStoreWrapper(store, ports),
    })
    openTab(/configuration/i)

    expect(sdoTimeoutInput().closest('fieldset')?.hasAttribute('disabled')).toBe(true)
  })

  it('should keep the stored configuration untouched while the debugger is open', () => {
    openDebugSession()
    render(<EtherCATDeviceEditor busName={BUS} deviceId={DEVICE_ID} />, {
      wrapper: createStoreWrapper(store, ports),
    })
    openTab(/configuration/i)

    fireEvent.change(sdoTimeoutInput(), { target: { value: '4000' } })

    expect(storedConfig()?.timeouts.sdoTimeoutMs).toBe(3000)
  })
})

describe('the EtherCAT module editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    seedStore()
  })

  it('should leave the startup parameters usable while no debug session is open', () => {
    render(<EtherCATModuleEditor busName={BUS} deviceId={DEVICE_ID} moduleId={MODULE_ID} />, {
      wrapper: createStoreWrapper(store, ports),
    })

    expect(screen.getByRole('tab', { name: /startup parameters/i }).closest('fieldset')).toBeNull()
  })

  it('should render the startup parameters inside a disabled fieldset while the debugger is open', () => {
    openDebugSession()
    render(<EtherCATModuleEditor busName={BUS} deviceId={DEVICE_ID} moduleId={MODULE_ID} />, {
      wrapper: createStoreWrapper(store, ports),
    })
    openTab(/startup parameters/i)

    const panel = screen.getByRole('tabpanel', { name: /startup parameters/i })
    const fieldset = panel.querySelector('fieldset')

    expect(fieldset?.hasAttribute('disabled')).toBe(true)
  })
})
