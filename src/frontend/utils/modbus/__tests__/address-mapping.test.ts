import type { ModbusBufferMapping } from '../../../../middleware/shared/ports/types'
import type { AddressMappingRow, AddressMappingSection } from '../address-mapping'
import {
  calculateModbusAddressMapping,
  formatBitAddress,
  formatModiconAddress,
  listSegmentEntries,
  MAX_LISTED_ENTRIES,
} from '../address-mapping'

const rowFor = (section: AddressMappingSection, segment: string): AddressMappingRow => {
  const row = section.rows.find((r) => r.segment === segment)
  if (!row) throw new Error(`no ${segment} row`)
  return row
}

describe('formatBitAddress', () => {
  it('numbers bits 0…7 inside a byte', () => {
    expect(formatBitAddress('%QX', 0)).toBe('%QX0.0')
    expect(formatBitAddress('%QX', 7)).toBe('%QX0.7')
  })

  it('rolls over to the next byte at bit 8', () => {
    expect(formatBitAddress('%QX', 8)).toBe('%QX1.0')
    expect(formatBitAddress('%IX', 16)).toBe('%IX2.0')
    expect(formatBitAddress('%MX', 799)).toBe('%MX99.7')
  })
})

describe('calculateModbusAddressMapping — defaults', () => {
  // These boundaries are the contract with the runtime's Modbus slave plugin
  // (simple_modbus.py DEFAULT_* configs). If they move, the runtime moved too.
  it('lays holding registers out as %QW → %MW → %MD(x2) → %ML(x4)', () => {
    const { holdingRegisters } = calculateModbusAddressMapping()

    expect(rowFor(holdingRegisters, '%QW')).toMatchObject({ modbusStart: 0, modbusEnd: 1023, modbusCount: 1024 })
    expect(rowFor(holdingRegisters, '%MW')).toMatchObject({ modbusStart: 1024, modbusEnd: 2047, modbusCount: 1024 })
    expect(rowFor(holdingRegisters, '%MD')).toMatchObject({
      plcAddressStart: '%MD0',
      plcAddressEnd: '%MD1023',
      modbusStart: 2048,
      modbusEnd: 4095,
      count: 1024,
      modbusCount: 2048,
      regsPerValue: 2,
    })
    expect(rowFor(holdingRegisters, '%ML')).toMatchObject({
      plcAddressStart: '%ML0',
      plcAddressEnd: '%ML1023',
      modbusStart: 4096,
      modbusEnd: 8191,
      count: 1024,
      modbusCount: 4096,
      regsPerValue: 4,
    })
    expect(holdingRegisters.totalAddresses).toBe(8192)
  })

  it('exposes %QX on coils and leaves %MX disabled', () => {
    const { coils } = calculateModbusAddressMapping()

    expect(rowFor(coils, '%QX')).toMatchObject({
      plcAddressStart: '%QX0.0',
      plcAddressEnd: '%QX1023.7',
      modbusStart: 0,
      modbusEnd: 8191,
      disabled: false,
    })
    expect(rowFor(coils, '%MX')).toMatchObject({ count: 0, modbusCount: 0, disabled: true })
    expect(coils.totalAddresses).toBe(8192)
  })

  it('maps discrete inputs to %IX and input registers to %IW', () => {
    const { discreteInputs, inputRegisters } = calculateModbusAddressMapping()

    expect(rowFor(discreteInputs, '%IX')).toMatchObject({
      plcAddressEnd: '%IX1023.7',
      modbusStart: 0,
      modbusEnd: 8191,
      disabled: false,
    })
    expect(rowFor(inputRegisters, '%IW')).toMatchObject({
      plcAddressEnd: '%IW1023',
      modbusStart: 0,
      modbusEnd: 1023,
      disabled: false,
    })
    expect(inputRegisters.totalAddresses).toBe(1024)
  })

  it('titles every section', () => {
    const mapping = calculateModbusAddressMapping()
    expect([
      mapping.holdingRegisters.title,
      mapping.coils.title,
      mapping.discreteInputs.title,
      mapping.inputRegisters.title,
    ]).toEqual(['Holding Registers', 'Coils', 'Discrete Inputs', 'Input Registers'])
  })
})

describe('calculateModbusAddressMapping — partial configuration', () => {
  it('falls back to the defaults field by field', () => {
    // A server created but never edited has no bufferMapping at all; an older
    // project can carry one that only names the segment its author touched.
    const partial: ModbusBufferMapping = { coils: { qxBits: 16 } }
    const { coils, holdingRegisters } = calculateModbusAddressMapping(partial)

    expect(rowFor(coils, '%QX')).toMatchObject({ modbusEnd: 15, plcAddressEnd: '%QX1.7' })
    expect(rowFor(coils, '%MX').count).toBe(0)
    expect(rowFor(holdingRegisters, '%QW').count).toBe(1024)
  })

  it('reads an empty object exactly like no configuration', () => {
    expect(calculateModbusAddressMapping({})).toEqual(calculateModbusAddressMapping(undefined))
    expect(
      calculateModbusAddressMapping({
        holdingRegisters: {},
        coils: {},
        discreteInputs: {},
        inputRegisters: {},
      }),
    ).toEqual(calculateModbusAddressMapping())
  })
})

describe('calculateModbusAddressMapping — resized segments', () => {
  it('shifts every later segment when %QW shrinks', () => {
    const { holdingRegisters } = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 4, mwCount: 8, mdCount: 2, mlCount: 1 },
    })

    expect(rowFor(holdingRegisters, '%QW')).toMatchObject({ modbusStart: 0, modbusEnd: 3, plcAddressEnd: '%QW3' })
    expect(rowFor(holdingRegisters, '%MW')).toMatchObject({ modbusStart: 4, modbusEnd: 11, plcAddressEnd: '%MW7' })
    // 2 registers per %MD value: 2 values occupy 12…15.
    expect(rowFor(holdingRegisters, '%MD')).toMatchObject({
      modbusStart: 12,
      modbusEnd: 15,
      modbusCount: 4,
      plcAddressEnd: '%MD1',
    })
    // 4 registers per %ML value: 1 value occupies 16…19.
    expect(rowFor(holdingRegisters, '%ML')).toMatchObject({
      modbusStart: 16,
      modbusEnd: 19,
      modbusCount: 4,
      plcAddressEnd: '%ML0',
    })
    expect(holdingRegisters.totalAddresses).toBe(20)
  })

  it('places %MX immediately after %QX when it is switched on', () => {
    const { coils } = calculateModbusAddressMapping({ coils: { qxBits: 800, mxBits: 8 } })

    expect(rowFor(coils, '%QX')).toMatchObject({ modbusEnd: 799, plcAddressEnd: '%QX99.7' })
    expect(rowFor(coils, '%MX')).toMatchObject({
      modbusStart: 800,
      modbusEnd: 807,
      plcAddressEnd: '%MX0.7',
      disabled: false,
    })
    expect(coils.totalAddresses).toBe(808)
  })
})

describe('calculateModbusAddressMapping — disabled segments', () => {
  it('reports a zero-sized segment as disabled rather than dropping it', () => {
    const mapping = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 0, mwCount: 0, mdCount: 0, mlCount: 0 },
      coils: { qxBits: 0, mxBits: 0 },
      discreteInputs: { ixBits: 0 },
      inputRegisters: { iwCount: 0 },
    })

    const everyRow = [
      ...mapping.holdingRegisters.rows,
      ...mapping.coils.rows,
      ...mapping.discreteInputs.rows,
      ...mapping.inputRegisters.rows,
    ]
    expect(everyRow).toHaveLength(8)
    expect(everyRow.every((row) => row.disabled)).toBe(true)
    expect(everyRow.every((row) => row.modbusCount === 0)).toBe(true)
    // Nothing is addressable, so no row may claim a negative or stray range.
    expect(everyRow.every((row) => row.modbusStart === 0 && row.modbusEnd === 0)).toBe(true)
    expect(mapping.holdingRegisters.totalAddresses).toBe(0)
    expect(mapping.coils.totalAddresses).toBe(0)
  })

  it('keeps the following segments addressable when only one is switched off', () => {
    const { holdingRegisters } = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 0, mwCount: 4, mdCount: 0, mlCount: 2 },
    })

    expect(rowFor(holdingRegisters, '%QW')).toMatchObject({ modbusStart: 0, modbusEnd: 0, disabled: true })
    expect(rowFor(holdingRegisters, '%MW')).toMatchObject({ modbusStart: 0, modbusEnd: 3, disabled: false })
    // %MD is off, so it collapses onto the boundary %ML then starts from.
    expect(rowFor(holdingRegisters, '%MD')).toMatchObject({ modbusStart: 4, modbusEnd: 4, disabled: true })
    expect(rowFor(holdingRegisters, '%ML')).toMatchObject({ modbusStart: 4, modbusEnd: 11, disabled: false })
    expect(holdingRegisters.totalAddresses).toBe(12)
  })
})

describe('formatModiconAddress', () => {
  it('prints the 1-based five-digit form of a 0-based offset', () => {
    expect(formatModiconAddress('4', 0)).toBe('400001')
    expect(formatModiconAddress('0', 7)).toBe('000008')
    expect(formatModiconAddress('1', 16)).toBe('100017')
    expect(formatModiconAddress('3', 8191)).toBe('308192')
  })
})

describe('modiconRange', () => {
  it('spans the whole block, one base up from the offsets', () => {
    // 4 %MW + 1 %MD (2 regs) + 2 %ML (8 regs) = 14 registers.
    const mapping = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 0, mwCount: 4, mdCount: 1, mlCount: 2 },
    })

    expect(mapping.holdingRegisters.totalAddresses).toBe(14)
    expect(mapping.holdingRegisters.modiconRange).toEqual({ start: '400001', end: '400014' })
  })

  it('uses the block digit of each table', () => {
    const mapping = calculateModbusAddressMapping()

    expect(mapping.coils.modiconRange).toEqual({ start: '000001', end: '008192' })
    expect(mapping.discreteInputs.modiconRange).toEqual({ start: '100001', end: '108192' })
    expect(mapping.inputRegisters.modiconRange).toEqual({ start: '300001', end: '301024' })
  })

  it('is null for a block that holds nothing', () => {
    const mapping = calculateModbusAddressMapping({
      coils: { qxBits: 0, mxBits: 0 },
      discreteInputs: { ixBits: 0 },
    })

    expect(mapping.coils.modiconRange).toBeNull()
    expect(mapping.discreteInputs.modiconRange).toBeNull()
  })
})

describe('listSegmentEntries', () => {
  // %QW off, so %MW starts at 0: %MW 0…3, %MD 4…7 (2 regs each), %ML 8…11.
  const resized = calculateModbusAddressMapping({
    holdingRegisters: { qwCount: 0, mwCount: 4, mdCount: 2, mlCount: 1 },
  })

  it('gives one entry per IEC value, a register wide', () => {
    const { entries, omitted } = listSegmentEntries(rowFor(resized.holdingRegisters, '%MW'))

    expect(entries).toEqual([
      { plcAddress: '%MW0', offset: 0, bits: 16 },
      { plcAddress: '%MW1', offset: 1, bits: 16 },
      { plcAddress: '%MW2', offset: 2, bits: 16 },
      { plcAddress: '%MW3', offset: 3, bits: 16 },
    ])
    expect(omitted).toBeNull()
  })

  it('strides two registers per %MD value and four per %ML', () => {
    // This stride is the reason the list exists: consecutive %MD values do not
    // sit on consecutive offsets.
    expect(listSegmentEntries(rowFor(resized.holdingRegisters, '%MD')).entries).toEqual([
      { plcAddress: '%MD0', offset: 4, bits: 32 },
      { plcAddress: '%MD1', offset: 6, bits: 32 },
    ])
    expect(listSegmentEntries(rowFor(resized.holdingRegisters, '%ML')).entries).toEqual([
      { plcAddress: '%ML0', offset: 8, bits: 64 },
    ])
  })

  it('numbers a bit segment byte.bit, one bit per entry', () => {
    const { coils } = calculateModbusAddressMapping({ coils: { qxBits: 8, mxBits: 8 } })
    const { entries } = listSegmentEntries(rowFor(coils, '%MX'))

    expect(entries).toHaveLength(8)
    expect(entries[0]).toEqual({ plcAddress: '%MX0.0', offset: 8, bits: 1 })
    expect(entries[7]).toEqual({ plcAddress: '%MX0.7', offset: 15, bits: 1 })
  })

  it('lists nothing for a disabled segment', () => {
    expect(listSegmentEntries(rowFor(resized.holdingRegisters, '%QW'))).toEqual({ entries: [], omitted: null })
  })

  it('caps a large segment and says what it left out', () => {
    const { coils } = calculateModbusAddressMapping()
    const { entries, omitted } = listSegmentEntries(rowFor(coils, '%QX'))

    expect(entries).toHaveLength(MAX_LISTED_ENTRIES)
    expect(omitted).toEqual({ count: 8192 - MAX_LISTED_ENTRIES, fromOffset: MAX_LISTED_ENTRIES, toOffset: 8191 })
  })

  it('reports the omitted range in offsets, so the stride is respected', () => {
    // %MD occupies 4…7; listing only the first value leaves 6…7 unlisted.
    const { omitted } = listSegmentEntries(rowFor(resized.holdingRegisters, '%MD'), 1)

    expect(omitted).toEqual({ count: 1, fromOffset: 6, toOffset: 7 })
  })
})
