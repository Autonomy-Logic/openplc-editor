import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import { buildAddressPool } from '@root/middleware/shared/utils/iec-address'
import { RUNTIME_V4_CAPABILITIES } from '@root/middleware/shared/utils/target-capabilities'

import { type AllocatableModule, allocateModuleSlots, type ModuleSlotsInput } from '../allocate-module-slots'

const emptyPool = buildAddressPool({}, RUNTIME_V4_CAPABILITIES)

const DI2: AllocatableModule = {
  id: 'di2',
  name: 'DI 2',
  addressMapping: {
    channels: [
      { name: 'DI1', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
      { name: 'DI2', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
    ],
  },
}
const BYTES: AllocatableModule = {
  id: 'bytes',
  name: 'Bytes',
  addressMapping: {
    channels: [
      { name: 'image', type: 'analogInput', dataType: 'USINT', addressPrefix: '%IB' },
      { name: 'stamp', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' },
    ],
  },
}
const PER_PIN: AllocatableModule = {
  id: 'per-pin',
  name: 'Per pin',
  addressMapping: {
    perChannelChoices: [
      {
        fieldId: 'i1_mode',
        default: 'bool',
        modes: {
          bool: { name: 'I1', type: 'digitalInput', dataType: 'BOOL', addressPrefix: '%IX' },
          analog: { name: 'I1', type: 'analogInput', dataType: 'UINT', addressPrefix: '%IW' },
        },
      },
    ],
  },
}
const MODULES = [DI2, BYTES, PER_PIN]

function allocate(overrides: Partial<ModuleSlotsInput>) {
  return allocateModuleSlots({
    slots: [],
    slotsConfig: {},
    modules: MODULES,
    pool: emptyPool,
    previous: [],
    ...overrides,
  })
}

function entry(slot: number, moduleId: string, channelName: string, alias: string): IoMappingEntry {
  return {
    slot,
    moduleId,
    moduleName: moduleId,
    channelName,
    channelType: 'digitalInput',
    dataType: 'BOOL',
    iecAddress: '%IX0.0',
    alias,
  }
}

describe('allocateModuleSlots', () => {
  it('gives every channel of every occupied slot its own address, in slot order', () => {
    const { entries } = allocate({ slots: ['di2', null, 'bytes', 'di2'] })

    expect(entries.map((e) => [e.slot, e.channelName, e.iecAddress])).toEqual([
      [1, 'DI1', '%IX0.0'],
      [1, 'DI2', '%IX0.1'],
      [3, 'image', '%IB0'],
      [3, 'stamp', '%IW0'],
      [4, 'DI1', '%IX0.2'],
      [4, 'DI2', '%IX0.3'],
    ])
    expect(entries[2]).toMatchObject({ moduleId: 'bytes', moduleName: 'Bytes', dataType: 'USINT', alias: '' })
  })

  it('skips an empty slot and a module id the manifest does not declare', () => {
    expect(allocate({ slots: [null, 'not-in-manifest'] }).entries).toEqual([])
  })

  it('skips a module whose addressMapping is not an object', () => {
    const broken: AllocatableModule = { id: 'broken', name: 'Broken', addressMapping: 'channels' }
    expect(allocate({ slots: ['broken'], modules: [broken] }).entries).toEqual([])
  })

  it('resolves per-channel modes from the slot config', () => {
    const { entries } = allocate({ slots: ['per-pin'], slotsConfig: { '1': { i1_mode: 'analog' } } })
    expect(entries).toEqual([
      expect.objectContaining({ channelName: 'I1', iecAddress: '%IW0', modeFieldId: 'i1_mode', modeValue: 'analog' }),
    ])
  })

  it('keeps an alias while the slot holds the same module', () => {
    const { entries, dropped } = allocate({
      slots: ['di2', 'bytes'],
      previous: [entry(1, 'di2', 'DI2', 'Door')],
    })

    expect(entries.find((e) => e.slot === 1 && e.channelName === 'DI2')?.alias).toBe('Door')
    expect(dropped).toEqual([])
  })

  it('drops and reports an alias when another module takes the slot', () => {
    const { entries, dropped } = allocate({
      slots: ['bytes'],
      previous: [entry(1, 'di2', 'DI1', 'Door')],
    })

    expect(entries.every((e) => e.alias === '')).toBe(true)
    expect(dropped).toEqual([{ alias: 'Door', slot: 1, channelName: 'DI1' }])
  })

  it('drops and reports an alias whose slot was emptied', () => {
    const { dropped } = allocate({ slots: [null, 'di2'], previous: [entry(1, 'di2', 'DI1', 'Door')] })
    expect(dropped).toEqual([{ alias: 'Door', slot: 1, channelName: 'DI1' }])
  })

  it('never moves an alias to the same channel of another module of the same type', () => {
    const { entries } = allocate({ slots: ['di2', 'di2'], previous: [entry(1, 'di2', 'DI1', 'Left')] })
    expect(entries.filter((e) => e.alias === 'Left').map((e) => e.slot)).toEqual([1])
  })

  it('keeps the alias of an entry stored without a module id', () => {
    const legacy = { ...entry(1, '', 'DI1', 'Old') }
    const { entries, dropped } = allocate({ slots: ['di2'], previous: [legacy] })

    expect(entries[0].alias).toBe('Old')
    expect(dropped).toEqual([])
  })

  it('allocates around addresses the pool already holds', () => {
    const pool = buildAddressPool(
      { pinMapping: { pins: [{ address: '%IX0.0' }] } },
      { ...RUNTIME_V4_CAPABILITIES, pinMapping: true },
    )
    const { entries } = allocate({ slots: ['di2'], pool })
    expect(entries.map((e) => e.iecAddress)).toEqual(['%IX0.1', '%IX0.2'])
  })
})
