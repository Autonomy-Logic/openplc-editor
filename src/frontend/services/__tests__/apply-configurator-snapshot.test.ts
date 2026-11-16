import { beforeEach, describe, expect, it } from '@jest/globals'
import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'
import type { BoardInfo, IoMappingEntry, VppModuleDefinition } from '@root/middleware/shared/ports/types'
import type { DeviceSetup } from '@root/middleware/shared/vendor-document/protocol'

import { manifestModuleFromCapture } from '../../../__fixtures__/device-editor-datapoints/manifest-module'
import { UR20_2DI_P_TS } from '../../../__fixtures__/device-editor-datapoints/ur20-2di-p-ts'
import { UR20_16DI_16DO } from '../../../__fixtures__/device-editor-datapoints/ur20-16di-16do'
import { applyConfiguratorSnapshot } from '../apply-configurator-snapshot'

const BOARD = 'UC20-M3000'
const TARGET = { configuratorKey: 'configurator', controller: BOARD, bundleVersion: '3.5.22' }

const MODULES: VppModuleDefinition[] = [
  manifestModuleFromCapture(UR20_2DI_P_TS, 0, { id: 'ur20-2di-p-ts', name: 'UR20-2DI-P-TS' }),
  manifestModuleFromCapture(UR20_16DI_16DO, 0, { id: 'ur20-16di-p', name: 'UR20-16DI-P' }),
  manifestModuleFromCapture(UR20_16DI_16DO, 1, { id: 'ur20-16do-p', name: 'UR20-16DO-P' }),
]

const [TS_DEVICE] = UR20_2DI_P_TS.deviceSetup.devices
const [DI_DEVICE, DO_DEVICE] = UR20_16DI_16DO.deviceSetup.devices

function station(...devices: DeviceSetup['devices']): DeviceSetup {
  return { systembus: UR20_16DI_16DO.deviceSetup.systembus, devices }
}

let store: OpenPLCStore

function seedBoard(modules: VppModuleDefinition[]) {
  const board: BoardInfo = {
    compiler: 'openplc-compiler',
    core: 'openplc',
    preview: 'generic.png',
    specs: {},
    vpp: {
      packageId: 'com.weidmuller.ucontrol',
      vendor: 'Weidmuller',
      deviceId: 'uc20-m3000',
      packagePath: '/packages/com.weidmuller.ucontrol',
      screens: {},
      moduleSystem: { enabled: true, maxSlots: 64, modules },
    },
  }
  store.getState().deviceActions.setAvailableOptions({ availableBoards: new Map([[BOARD, board]]) })
  store.getState().deviceActions.setDeviceBoard(BOARD)
}

function vendorScreenData(): Record<string, unknown> {
  return store.getState().deviceDefinitions.configuration.vendorScreenData ?? {}
}

function ioEntries(): IoMappingEntry[] {
  const mapping = vendorScreenData()['io-mapping']
  return mapping && typeof mapping === 'object' && 'entries' in mapping && Array.isArray(mapping.entries)
    ? mapping.entries.filter((entry): entry is IoMappingEntry => !!entry && typeof entry === 'object')
    : []
}

function setAlias(slot: number, channelName: string, alias: string) {
  const entries = ioEntries().map((entry) =>
    entry.slot === slot && entry.channelName === channelName ? { ...entry, alias } : entry,
  )
  store.getState().deviceActions.setVendorScreenData('io-mapping', { entries })
}

function prefixCounts(entries: readonly IoMappingEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    const prefix = entry.iecAddress.slice(0, 3)
    counts[prefix] = (counts[prefix] ?? 0) + 1
  }
  return counts
}

describe('applyConfiguratorSnapshot', () => {
  beforeEach(() => {
    store = createTestStore()
    seedBoard(MODULES)
  })

  it('stores the archive untouched, the device setup, the manifest module per slot and the mapping', () => {
    const archive = '1f8b0800\u0000ÿ' + 'ab'.repeat(5_000)
    applyConfiguratorSnapshot(store, TARGET, { archive, deviceSetup: UR20_16DI_16DO.deviceSetup })

    expect(vendorScreenData().configurator).toEqual({ archive, controller: BOARD, bundleVersion: '3.5.22' })
    expect(vendorScreenData()['device-setup']).toEqual({
      modules: [
        { guid: DI_DEVICE.guid, instanceName: 'UR20_16DI_P_1', typeId: '00049fc2', slot: 1 },
        { guid: DO_DEVICE.guid, instanceName: 'UR20_16DO_P_1', typeId: '0103afd0', slot: 2 },
      ],
    })
    expect(vendorScreenData()['module-configuration']).toEqual({ slots: ['ur20-16di-p', 'ur20-16do-p'] })
    const entries = ioEntries()
    expect(prefixCounts(entries)).toEqual({ '%IX': 16, '%QX': 16 })
    expect(new Set(entries.map((entry) => entry.iecAddress)).size).toBe(32)
  })

  it('maps a UR20-2DI-P-TS from the manifest to 45 channels: 30 %IB and 15 %IW', () => {
    applyConfiguratorSnapshot(store, TARGET, { archive: 'a', deviceSetup: UR20_2DI_P_TS.deviceSetup })

    const entries = ioEntries()
    expect(entries).toHaveLength(45)
    expect(prefixCounts(entries)).toEqual({ '%IB': 30, '%IW': 15 })
    expect(entries.slice(0, 3)).toEqual([
      expect.objectContaining({
        slot: 1,
        moduleId: 'ur20-2di-p-ts',
        channelName: 'input_image_1',
        dataType: 'USINT',
        iecAddress: '%IB0',
      }),
      expect.objectContaining({ channelName: 'running_number_1', dataType: 'USINT', iecAddress: '%IB1' }),
      expect.objectContaining({ channelName: 'timestamp_1', dataType: 'UINT', iecAddress: '%IW0' }),
    ])
  })

  it('matches modules by the exact type id string', () => {
    seedBoard([
      { ...MODULES[1], typeId: '49fc2' },
      { ...MODULES[2], typeId: '0103AFD0' },
      { ...MODULES[0], id: 'ur20-4di-like', typeId: '1000000' },
    ])
    const systemBusLookalike = { guid: 'g-bus', name: 'Lookalike_1', typeId: '01000000' }
    applyConfiguratorSnapshot(store, TARGET, {
      archive: 'a',
      deviceSetup: station(DI_DEVICE, DO_DEVICE, systemBusLookalike),
    })

    expect(vendorScreenData()['module-configuration']).toEqual({ slots: [null, null, null] })
    expect(ioEntries()).toEqual([])
  })

  it('keeps a module whose type id is not in the manifest in the device setup, with no channels', () => {
    const unknown = { guid: 'g-unknown', name: 'UR20_8AI_1', typeId: 'deadbeef' }
    applyConfiguratorSnapshot(store, TARGET, { archive: 'a', deviceSetup: station(unknown, DI_DEVICE) })

    expect(vendorScreenData()['device-setup']).toMatchObject({
      modules: [
        { guid: 'g-unknown', typeId: 'deadbeef', slot: 1 },
        { guid: DI_DEVICE.guid, slot: 2 },
      ],
    })
    expect(vendorScreenData()['module-configuration']).toEqual({ slots: [null, 'ur20-16di-p'] })
    expect(new Set(ioEntries().map((entry) => entry.slot))).toEqual(new Set([2]))
    expect(ioEntries()).toHaveLength(16)
  })

  it('writes archive, device setup, module slots and mapping in one store update', () => {
    let updates = 0
    const unsubscribe = store.subscribe(() => {
      updates += 1
    })
    store.getState().deviceActions.setConfiguratorSnapshot('configurator', {
      configurator: { archive: 'a', controller: 'c', bundleVersion: 'v' },
      deviceSetup: { modules: [] },
      moduleConfiguration: { slots: [] },
      ioMapping: { entries: [] },
    })
    unsubscribe()

    expect(updates).toBe(1)
  })

  it('keeps an alias while the same module stays on the same slot', () => {
    applyConfiguratorSnapshot(store, TARGET, { archive: 'one', deviceSetup: station(DI_DEVICE) })
    setAlias(1, 'DI_3', 'Pump_Run')

    const applied = applyConfiguratorSnapshot(store, TARGET, {
      archive: 'two',
      deviceSetup: station(DI_DEVICE, TS_DEVICE),
    })

    expect(applied.dropped).toEqual([])
    expect(ioEntries().find((entry) => entry.slot === 1 && entry.channelName === 'DI_3')?.alias).toBe('Pump_Run')
  })

  it('drops and reports an alias when another module takes its slot', () => {
    applyConfiguratorSnapshot(store, TARGET, { archive: 'one', deviceSetup: station(DI_DEVICE) })
    setAlias(1, 'DI_0', 'Start_Button')

    const applied = applyConfiguratorSnapshot(store, TARGET, {
      archive: 'two',
      deviceSetup: station(DO_DEVICE, DI_DEVICE),
    })

    expect(applied.dropped).toEqual([{ alias: 'Start_Button', slot: 1, channelName: 'DI_0' }])
    expect(ioEntries().some((entry) => entry.alias === 'Start_Button')).toBe(false)
  })

  it('does not merge the aliases of two modules of the same type', () => {
    const second = { ...DI_DEVICE, guid: 'g-second', name: 'UR20_16DI_P_2' }
    applyConfiguratorSnapshot(store, TARGET, { archive: 'one', deviceSetup: station(DI_DEVICE, second) })
    setAlias(1, 'DI_0', 'Left_Door')

    applyConfiguratorSnapshot(store, TARGET, { archive: 'two', deviceSetup: station(DI_DEVICE, second) })

    const aliased = ioEntries().filter((entry) => entry.alias === 'Left_Door')
    expect(aliased).toEqual([expect.objectContaining({ slot: 1, channelName: 'DI_0' })])
  })
})
