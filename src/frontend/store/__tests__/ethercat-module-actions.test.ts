import { beforeEach, describe, expect, it } from '@jest/globals'

import type { ConfiguredEtherCATModule, ESIModule } from '../../../middleware/shared/ports/esi-types'
import { buildModuleForSlot } from '../../../middleware/shared/utils/ethercat'
import { createDefaultSlaveConfig } from '../../../backend/shared/ethercat/device-config-defaults'
import type { OpenPLCStore } from '../index'
import { createTestStore } from '../testing'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

const di: ESIModule = {
  ident: '0x00091F84',
  name: 'UR20-4DI-P',
  moduleClass: 'Di',
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
}

const increments = { slotIndexIncrement: 16, slotPdoIncrement: 1 }

const seed = () => {
  const used = new Set<string>()
  const modules: ConfiguredEtherCATModule[] = [1, 2, 3].map((slot) => ({
    ...buildModuleForSlot({
      id: `m${slot}`,
      slot,
      esiModule: di,
      increments,
      repositoryItemId: 'r',
      usedAddresses: used,
    }),
    name: `DI_${slot}`,
  }))
  modules[2] = {
    ...modules[2],
    channelMappings: modules[2].channelMappings.map((m) => ({ ...m, alias: 'Door_Open' })),
  }
  const state = store.getState()
  state.remoteDeviceActions.create({ name: 'Bus', protocol: 'ethercat' })
  const { project } = store.getState()
  state.projectActions.setProject({
    ...project,
    data: {
      ...project.data,
      remoteDevices: (project.data.remoteDevices ?? []).map((d) =>
        d.name === 'Bus'
          ? {
              ...d,
              ethercatConfig: {
                devices: [
                  {
                    id: 'c',
                    name: 'Coupler',
                    esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
                    vendorId: '0x230',
                    productCode: '0x1',
                    revisionNo: '0x1',
                    addedFrom: 'repository' as const,
                    config: createDefaultSlaveConfig(),
                    channelMappings: [],
                    isModularCoupler: true,
                    slotsSpec: {
                      slots: [{ minInstances: 0, maxInstances: 64 }],
                      ...increments,
                      downloadModuleIdentList: true,
                    },
                    modules,
                  },
                ],
              },
            }
          : d,
      ),
    },
  })
}

const couplerModules = () =>
  store.getState().project.data.remoteDevices?.find((d) => d.name === 'Bus')?.ethercatConfig?.devices[0]?.modules ?? []

describe('ethercatDeviceActions.deleteModule', () => {
  it('closes the gap: later modules move up a slot with their indices, ids and aliases', () => {
    seed()
    expect(store.getState().ethercatDeviceActions.deleteModule('Bus', 'c', 'm2').ok).toBe(true)
    expect(couplerModules().map((m) => [m.id, m.slot, m.txPdos?.[0]?.index, m.channelMappings[0]?.alias])).toEqual([
      ['m1', 1, '0x1A00', ''],
      ['m3', 2, '0x1A01', 'Door_Open'],
    ])
  })

  it("closes the module's open tab, which is named after its coupler", () => {
    seed()
    const tab = {
      name: 'Coupler/DI_2',
      path: '/devices/remote/Bus/devices/c/modules/m2',
      elementType: { type: 'ethercat-module' as const, busName: 'Bus', deviceId: 'c', moduleId: 'm2' },
    }
    store.getState().tabsActions.updateTabs(tab)
    expect(store.getState().tabs.some((t) => t.name === 'Coupler/DI_2')).toBe(true)
    store.getState().ethercatDeviceActions.deleteModule('Bus', 'c', 'm2')
    expect(store.getState().tabs.some((t) => t.name === 'Coupler/DI_2')).toBe(false)
  })
})

describe('remoteDeviceActions.duplicate on a modular coupler', () => {
  it('gives the copied modules new ids and no alias or address', () => {
    seed()
    expect(store.getState().remoteDeviceActions.duplicate('Bus', 'Bus_copy').ok).toBe(true)
    const copy = store.getState().project.data.remoteDevices?.find((d) => d.name === 'Bus_copy')
    const modules = copy?.ethercatConfig?.devices[0]?.modules ?? []
    expect(modules).toHaveLength(3)
    expect(modules.some((m) => ['m1', 'm2', 'm3'].includes(m.id))).toBe(false)
    expect(modules.flatMap((m) => m.channelMappings.map((c) => [c.alias, c.iecLocation]))).toEqual([
      [undefined, ''],
      [undefined, ''],
      [undefined, ''],
    ])
    expect(couplerModules()[2]?.channelMappings[0]?.alias).toBe('Door_Open')
  })
})
