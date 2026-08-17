import type { ModbusBufferMapping } from '../../../../middleware/shared/ports/types'
import type { AddressMappingRow, AddressMappingSection } from '../address-mapping'
import { calculateModbusAddressMapping, formatBitAddress } from '../address-mapping'

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
