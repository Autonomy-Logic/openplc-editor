import type { ConfiguredEtherCATModule, ESIModule, ESISlotsSpec } from '@root/middleware/shared/ports/esi-types'

import { buildModuleForSlot } from '../module-build'
import { checkStation, moveModuleToSlot, removeModuleAndCompact, shiftModule } from '../module-station'

const increments = { slotIndexIncrement: 16, slotPdoIncrement: 1 }

const di: ESIModule = {
  ident: '0x00091F84',
  name: 'UR20-4DI-P',
  moduleClass: 'Di',
  modulePdoGroup: 1,
  rxPdo: [],
  txPdo: [
    {
      index: '0x1A00',
      name: 'Input',
      fixed: true,
      mandatory: true,
      dependOnSlot: true,
      entries: [
        { index: '0x6000', subIndex: '0x01', bitLen: 1, name: 'DI1', dataType: 'BOOL', dependOnSlot: true },
        { index: '0x0000', subIndex: '0x00', bitLen: 7, name: 'Padding', dataType: 'BIT' },
      ],
    },
  ],
  initCmds: [
    { transition: 'PS', index: '0x8000', subIndex: 3, data: '0x41', dependOnSlot: true },
    { transition: 'PS', index: '0xF810', subIndex: 1, data: '0x01' },
  ],
}

const at = (id: string, slot: number, used = new Set<string>()): ConfiguredEtherCATModule =>
  buildModuleForSlot({ id, slot, esiModule: di, increments, repositoryItemId: 'r', usedAddresses: used })

describe('moveModuleToSlot', () => {
  test('slot-dependent indices and channel ids move; addresses, aliases and fixed indices stay', () => {
    const before = at('a', 1)
    const aliased = {
      ...before,
      channelMappings: before.channelMappings.map((m) => ({ ...m, alias: 'start_button' })),
    }
    const moved = moveModuleToSlot(aliased, 3, increments)
    expect(moved.slot).toBe(3)
    expect(moved.txPdos?.[0]?.index).toBe('0x1A02')
    expect(moved.txPdos?.[0]?.entries.map((e) => e.index)).toEqual(['0x6020', '0x0000'])
    expect(moved.sdoConfigurations?.map((e) => e.index)).toEqual(['0x8020', '0xF810'])
    expect(moved.channelInfo?.[0]).toMatchObject({ channelId: '0x1A02-0x6020-0x01', pdoIndex: '0x1A02' })
    expect(moved.channelMappings).toEqual([
      {
        channelId: '0x1A02-0x6020-0x01',
        iecLocation: before.channelMappings[0]?.iecLocation,
        alias: 'start_button',
      },
    ])
  })

  test('moving to the same slot returns the module unchanged', () => {
    const m = at('a', 2)
    expect(moveModuleToSlot(m, 2, increments)).toBe(m)
  })
})

describe('removeModuleAndCompact and shiftModule', () => {
  const station = () => {
    const used = new Set<string>()
    return [at('a', 1, used), at('b', 2, used), at('c', 3, used)]
  }

  test('removing a module moves the following ones up, keeping their ids', () => {
    const next = removeModuleAndCompact(station(), 'b', increments)
    expect(next.map((m) => [m.id, m.slot, m.txPdos?.[0]?.index])).toEqual([
      ['a', 1, '0x1A00'],
      ['c', 2, '0x1A01'],
    ])
  })

  test('removing an unknown id changes nothing', () => {
    expect(removeModuleAndCompact(station(), 'x', increments).map((m) => m.slot)).toEqual([1, 2, 3])
  })

  test('moving down swaps with the neighbour; moving into an empty slot just moves', () => {
    const swapped = shiftModule(station(), 'a', 1, increments)
    expect(swapped.map((m) => [m.id, m.slot])).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 3],
    ])
    const intoGap = shiftModule(station(), 'c', 1, increments)
    expect(intoGap.find((m) => m.id === 'c')?.slot).toBe(4)
  })

  test('slot 1 cannot move up and an unknown id is ignored', () => {
    expect(shiftModule(station(), 'a', -1, increments).map((m) => m.slot)).toEqual([1, 2, 3])
    expect(shiftModule(station(), 'x', 1, increments).map((m) => m.slot)).toEqual([1, 2, 3])
  })
})

describe('checkStation', () => {
  const spec: ESISlotsSpec = {
    slots: [
      { name: 'head', minInstances: 1, maxInstances: 1, moduleClasses: ['Head'] },
      { name: 'io', minInstances: 0, maxInstances: 2, moduleClasses: ['Di'] },
    ],
    slotIndexIncrement: 16,
    slotPdoIncrement: 1,
    downloadModuleIdentList: true,
  }
  const mod = (slot: number, moduleClass: string) => ({ slot, name: `M${slot}`, ident: '0x1', moduleClass })

  test('a valid station has no issues', () => {
    expect(checkStation(spec, [mod(1, 'Head'), mod(2, 'Di'), mod(3, 'Di')])).toEqual([])
  })

  test('a module in a slot whose definition refuses it is a placement issue on that module', () => {
    expect(checkStation(spec, [mod(1, 'Di')]).map((i) => [i.kind, i.module?.slot, i.text])).toEqual([
      ['placement', 1, "slot definition 1 ('head') does not accept module 0x1 (class 'Di')"],
    ])
  })

  test('an empty station below MinInstances is a min-instances issue only', () => {
    expect(checkStation(spec, [])).toEqual([
      {
        kind: 'min-instances',
        text: "slot definition 1 ('head') requires at least 1 module(s); the project has 0",
      },
    ])
  })

  test('more modules than the definitions allow is a placement issue on the extra one', () => {
    const issues = checkStation(spec, [mod(1, 'Head'), mod(2, 'Di'), mod(3, 'Di'), mod(4, 'Di')])
    expect(issues).toEqual([
      {
        kind: 'placement',
        module: mod(4, 'Di'),
        text: 'no slot definition of the coupler accepts it at this position',
      },
    ])
  })

  test('without <Slots> there is nothing to check unless modules are present', () => {
    expect(checkStation(undefined, [])).toEqual([])
    expect(checkStation(undefined, [mod(1, 'Di')])[0]?.text).toMatch(/declares no <Slots>/)
  })
})
