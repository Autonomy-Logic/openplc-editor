import type { ESIModule } from '@root/middleware/shared/ports/esi-types'

import { initCmdToSdoEntry, textToHexBytes } from '../init-cmd-sdo'
import { buildModuleForSlot, hexAdd } from '../module-build'

const ur20_4di: ESIModule = {
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
      smIndex: 3,
      dependOnSlot: true,
      entries: [
        { index: '0x6000', subIndex: '0x1', bitLen: 1, name: 'DI1', dataType: 'BOOL', dependOnSlot: true },
        { index: '0x0000', subIndex: '0x00', bitLen: 7, name: 'Padding', dataType: 'BIT' },
        { index: '0x6000', subIndex: '0x5', bitLen: 8, name: 'Module state', dataType: 'USINT', dependOnSlot: true },
      ],
    },
  ],
  initCmds: [
    { transition: 'PS', index: '0x8000', subIndex: 3, data: '0x555232302D3444492D50', dependOnSlot: true },
    { transition: 'PS', index: '0xF810', subIndex: 1, data: '0x00100100' },
  ],
}

describe('hexAdd', () => {
  test('keeps prefix and zero padding', () => {
    expect(hexAdd('0x6000', 0x20)).toBe('0x6020')
    expect(hexAdd('0x0001', 1)).toBe('0x0002')
    expect(hexAdd('0x1A00', 0)).toBe('0x1A00')
  })
})

describe('initCmdToSdoEntry', () => {
  test('<Data> becomes a 0x byte string of its own length', () => {
    const e = initCmdToSdoEntry({ transition: 'PS', index: '0x8000', subIndex: 10, data: '0x841F0900' }, 'x')
    expect(e).toMatchObject({ valueBytes: '0x841F0900', bitLength: 32, dataType: 'OCTET_STRING', value: '' })
  })

  test('<DataAscii> becomes the encoded bytes', () => {
    expect(textToHexBytes('UR20')).toBe('0x55523230')
  })

  test('a numeric <Value> keeps the width of its declared type', () => {
    const e = initCmdToSdoEntry({ transition: 'PS', index: '0x6060', subIndex: 0, value: 8, dataType: 'SINT' }, 'x')
    expect(e).toMatchObject({ value: '8', bitLength: 8, dataType: 'SINT' })
    expect(e?.valueBytes).toBeUndefined()
  })
})

describe('buildModuleForSlot', () => {
  const build = (slot: number) =>
    buildModuleForSlot({
      id: `m${slot}`,
      slot,
      esiModule: ur20_4di,
      increments: { slotIndexIncrement: 16, slotPdoIncrement: 1 },
      repositoryItemId: 'repo',
      usedAddresses: new Set(['%IX0.0']),
    })

  test('slot 1 uses the base indices', () => {
    const m = build(1)
    expect(m.txPdos?.[0]?.index).toBe('0x1A00')
    expect(m.sdoConfigurations?.map((s) => s.index)).toEqual(['0x8000', '0xF810'])
  })

  test('slot 3 shifts only slot-dependent indices: padding and coupler objects stay put', () => {
    const m = build(3)
    expect(m.txPdos?.[0]?.index).toBe('0x1A02')
    expect(m.txPdos?.[0]?.entries.map((e) => e.index)).toEqual(['0x6020', '0x0000', '0x6020'])
    expect(m.sdoConfigurations?.map((s) => [s.index, s.valueBytes])).toEqual([
      ['0x8020', '0x555232302D3444492D50'],
      ['0xF810', '0x00100100'],
    ])
  })

  test('channels skip padding and get addresses clear of those already used', () => {
    const m = build(1)
    expect(m.channelInfo?.map((c) => c.name)).toEqual(['DI1', 'Module state'])
    expect(m.channelMappings.map((c) => c.iecLocation)).not.toContain('%IX0.0')
  })
})
