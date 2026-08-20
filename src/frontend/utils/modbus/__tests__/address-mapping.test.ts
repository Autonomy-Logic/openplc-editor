import type { ModbusBufferMapping } from '../../../../middleware/shared/ports/types'
import type { AddressMappingRow, AddressMappingSection } from '../address-mapping'
import {
  calculateModbusAddressMapping,
  formatBitAddress,
  formatModiconAddress,
  mappingToCsv,
  matrixRowCount,
  matrixRowLabel,
  offsetForIndex,
  plcAddressForIndex,
  resolveAddressQuery,
  sectionsOf,
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

describe('formatModiconAddress', () => {
  it('adds the block base to the offset and pads to six digits', () => {
    expect(formatModiconAddress(400001, 0)).toBe('400001')
    expect(formatModiconAddress(1, 0)).toBe('000001')
    expect(formatModiconAddress(1, 8191)).toBe('008192')
    expect(formatModiconAddress(100001, 16)).toBe('100017')
    expect(formatModiconAddress(300001, 1023)).toBe('301024')
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
      registersPerValue: 2,
      iecType: 'DWORD',
    })
    expect(rowFor(holdingRegisters, '%ML')).toMatchObject({
      plcAddressStart: '%ML0',
      plcAddressEnd: '%ML1023',
      modbusStart: 4096,
      modbusEnd: 8191,
      count: 1024,
      modbusCount: 4096,
      registersPerValue: 4,
      iecType: 'LWORD',
    })
    expect(holdingRegisters.totalAddresses).toBe(8192)
    expect(holdingRegisters.modiconRange).toEqual({ start: '400001', end: '408192' })
  })

  it('exposes %QX on coils and leaves %MX disabled', () => {
    const { coils } = calculateModbusAddressMapping()

    expect(rowFor(coils, '%QX')).toMatchObject({
      plcAddressStart: '%QX0.0',
      plcAddressEnd: '%QX1023.7',
      modbusStart: 0,
      modbusEnd: 8191,
      iecType: 'BOOL',
      perRow: 8,
      disabled: false,
    })
    expect(rowFor(coils, '%MX')).toMatchObject({ count: 0, modbusCount: 0, disabled: true })
    expect(coils.modiconRange).toEqual({ start: '000001', end: '008192' })
  })

  it('maps discrete inputs to %IX and input registers to %IW', () => {
    const { discreteInputs, inputRegisters } = calculateModbusAddressMapping()

    expect(rowFor(discreteInputs, '%IX')).toMatchObject({ plcAddressEnd: '%IX1023.7', modbusEnd: 8191 })
    expect(discreteInputs.modiconRange).toEqual({ start: '100001', end: '108192' })
    expect(rowFor(inputRegisters, '%IW')).toMatchObject({ plcAddressEnd: '%IW1023', modbusEnd: 1023, perRow: 16 })
    expect(inputRegisters.modiconRange).toEqual({ start: '300001', end: '301024' })
  })

  it('names and orders every section', () => {
    const sections = sectionsOf(calculateModbusAddressMapping())

    expect(sections.map((s) => s.id)).toEqual(['holding', 'coils', 'discrete', 'input'])
    expect(sections.map((s) => s.title)).toEqual(['Holding Registers', 'Coils', 'Discrete Inputs', 'Input Registers'])
    expect(sections.map((s) => s.kind)).toEqual(['register', 'bit', 'bit', 'register'])
  })
})

describe('calculateModbusAddressMapping — partial configuration', () => {
  it('falls back to the defaults field by field', () => {
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

describe('calculateModbusAddressMapping — resized and disabled segments', () => {
  it('shifts every later segment when %QW shrinks', () => {
    const { holdingRegisters } = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 4, mwCount: 8, mdCount: 2, mlCount: 1 },
    })

    expect(rowFor(holdingRegisters, '%QW')).toMatchObject({ modbusStart: 0, modbusEnd: 3, plcAddressEnd: '%QW3' })
    expect(rowFor(holdingRegisters, '%MW')).toMatchObject({ modbusStart: 4, modbusEnd: 11, plcAddressEnd: '%MW7' })
    // 2 registers per %MD value: 2 values occupy 12…15, and the IEC index ends
    // at 1 rather than 3 — the one place the two columns diverge.
    expect(rowFor(holdingRegisters, '%MD')).toMatchObject({
      modbusStart: 12,
      modbusEnd: 15,
      modbusCount: 4,
      plcAddressEnd: '%MD1',
    })
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
    expect(rowFor(coils, '%MX')).toMatchObject({ modbusStart: 800, modbusEnd: 807, plcAddressEnd: '%MX0.7' })
    expect(coils.totalAddresses).toBe(808)
  })

  it('reports a zero-sized segment as disabled rather than dropping it', () => {
    const mapping = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 0, mwCount: 0, mdCount: 0, mlCount: 0 },
      coils: { qxBits: 0, mxBits: 0 },
      discreteInputs: { ixBits: 0 },
      inputRegisters: { iwCount: 0 },
    })

    const everyRow = sectionsOf(mapping).flatMap((section) => section.rows)
    expect(everyRow).toHaveLength(8)
    expect(everyRow.every((row) => row.disabled && row.modbusCount === 0)).toBe(true)
    // Nothing is addressable, so no row may claim a negative or stray range.
    expect(everyRow.every((row) => row.modbusStart === 0 && row.modbusEnd === 0)).toBe(true)
    // With no addresses there is no range to name.
    expect(sectionsOf(mapping).every((section) => section.modiconRange === null)).toBe(true)
  })

  it('keeps the following segments addressable when only one is switched off', () => {
    const { holdingRegisters } = calculateModbusAddressMapping({
      holdingRegisters: { qwCount: 0, mwCount: 4, mdCount: 0, mlCount: 2 },
    })

    expect(rowFor(holdingRegisters, '%MW')).toMatchObject({ modbusStart: 0, modbusEnd: 3, disabled: false })
    // %MD is off, so it collapses onto the boundary %ML then starts from.
    expect(rowFor(holdingRegisters, '%MD')).toMatchObject({ modbusStart: 4, modbusEnd: 4, disabled: true })
    expect(rowFor(holdingRegisters, '%ML')).toMatchObject({ modbusStart: 4, modbusEnd: 11, disabled: false })
  })
})

describe('matrix helpers', () => {
  const mapping = calculateModbusAddressMapping({
    holdingRegisters: { qwCount: 40, mwCount: 0, mdCount: 3, mlCount: 0 },
    coils: { qxBits: 20, mxBits: 0 },
  })
  const qw = rowFor(mapping.holdingRegisters, '%QW')
  const md = rowFor(mapping.holdingRegisters, '%MD')
  const qx = rowFor(mapping.coils, '%QX')

  it('folds registers sixteen to a row and bits eight to a row', () => {
    expect(qw.perRow).toBe(16)
    expect(qx.perRow).toBe(8)
    expect(matrixRowCount(qw)).toBe(3)
    expect(matrixRowCount(qx)).toBe(3)
    expect(matrixRowCount(md)).toBe(1)
  })

  it('labels a register row by its first index and a bit row by its byte', () => {
    expect(matrixRowLabel(qw, 0)).toBe('%QW0')
    expect(matrixRowLabel(qw, 2)).toBe('%QW32')
    expect(matrixRowLabel(qx, 0)).toBe('%QX0')
    expect(matrixRowLabel(qx, 2)).toBe('%QX2')
  })

  it('walks offsets by the stride of the segment', () => {
    expect(offsetForIndex(qw, 5)).toBe(5)
    // %MD starts right after %QW's 40 registers and takes two per value.
    expect(offsetForIndex(md, 0)).toBe(40)
    expect(offsetForIndex(md, 2)).toBe(44)
    expect(offsetForIndex(qx, 9)).toBe(9)
  })

  it('names the value at an index', () => {
    expect(plcAddressForIndex(qw, 17)).toBe('%QW17')
    expect(plcAddressForIndex(md, 2)).toBe('%MD2')
    expect(plcAddressForIndex(qx, 9)).toBe('%QX1.1')
  })
})

describe('resolveAddressQuery', () => {
  const mapping = calculateModbusAddressMapping()

  it('treats an empty query as no search rather than a failed one', () => {
    expect(resolveAddressQuery('', mapping)).toEqual({ hits: [], error: null })
    expect(resolveAddressQuery('   ', mapping)).toEqual({ hits: [], error: null })
  })

  it('resolves a register address', () => {
    expect(resolveAddressQuery('%MW12', mapping)).toEqual({
      hits: [{ sectionId: 'holding', segment: '%MW', offset: 1036, matrixRow: 0 }],
      error: null,
    })
  })

  it('resolves a bit address, and reads a missing bit as bit 0', () => {
    expect(resolveAddressQuery('%QX37.4', mapping).hits).toEqual([
      { sectionId: 'coils', segment: '%QX', offset: 300, matrixRow: 37 },
    ])
    // The helper text only shows the dotted form, but the plain one is the
    // shape a user types first.
    expect(resolveAddressQuery('%QX33', mapping).hits).toEqual([
      { sectionId: 'coils', segment: '%QX', offset: 264, matrixRow: 33 },
    ])
  })

  it('walks the stride of a multi-register segment', () => {
    expect(resolveAddressQuery('%MD5', mapping).hits[0]).toEqual({
      sectionId: 'holding',
      segment: '%MD',
      offset: 2058,
      matrixRow: 0,
    })
  })

  it('is case and whitespace insensitive, and the % is optional', () => {
    expect(resolveAddressQuery('  mw12 ', mapping).hits).toEqual(resolveAddressQuery('%MW12', mapping).hits)
  })

  it('rejects a bit index outside a byte', () => {
    expect(resolveAddressQuery('%QX0.8', mapping)).toEqual({ hits: [], error: 'Bit index must be 0-7' })
  })

  it('rejects a bit on a register segment', () => {
    expect(resolveAddressQuery('%MW12.3', mapping)).toEqual({ hits: [], error: '%MW is not a bit address' })
  })

  it('says when an address is past the configured size', () => {
    expect(resolveAddressQuery('%ML9999', mapping)).toEqual({
      hits: [],
      error: '%ML is outside the configured range',
    })
    // %MX is off by default, so every %MX address is out of range.
    expect(resolveAddressQuery('%MX0.0', mapping).error).toBe('%MX is outside the configured range')
  })

  it('reads a bare byte.bit as a coil', () => {
    expect(resolveAddressQuery('12.3', mapping).hits).toEqual([
      { sectionId: 'coils', segment: '%QX', offset: 99, matrixRow: 12 },
    ])
  })

  it('reads six digits as modicon and anything shorter as a raw offset', () => {
    // 000301 is coil offset 300 — the base is 1, not 0.
    expect(resolveAddressQuery('000301', mapping).hits).toEqual([
      { sectionId: 'coils', segment: '%QX', offset: 300, matrixRow: 37 },
    ])
    expect(resolveAddressQuery('400001', mapping).hits).toEqual([
      { sectionId: 'holding', segment: '%QW', offset: 0, matrixRow: 0 },
    ])
  })

  it('finds a raw offset in every block that has one', () => {
    // Each block numbers from zero, so offset 300 is four different addresses.
    const { hits } = resolveAddressQuery('300', mapping)
    expect(hits.map((hit) => `${hit.sectionId}:${hit.segment}`)).toEqual([
      'holding:%QW',
      'coils:%QX',
      'discrete:%IX',
      'input:%IW',
    ])
  })

  it('reports a value no block holds', () => {
    expect(resolveAddressQuery('999999', mapping)).toEqual({ hits: [], error: 'No address matches that value' })
    expect(resolveAddressQuery('99999', mapping).error).toBe('No address matches that value')
  })

  it('reports an unparseable query', () => {
    expect(resolveAddressQuery('%ZZ1', mapping)).toEqual({ hits: [], error: 'Unrecognized address format' })
    expect(resolveAddressQuery('nonsense', mapping).error).toBe('Unrecognized address format')
  })
})

describe('mappingToCsv', () => {
  it('emits one line per IEC value, in both conventions', () => {
    const csv = mappingToCsv(
      calculateModbusAddressMapping({
        holdingRegisters: { qwCount: 0, mwCount: 0, mdCount: 2, mlCount: 0 },
        coils: { qxBits: 2, mxBits: 0 },
        discreteInputs: { ixBits: 0 },
        inputRegisters: { iwCount: 1 },
      }),
    )

    expect(csv).toBe(
      [
        'block,segment,plc_address,modbus_offset,modicon_address,registers,iec_type',
        'Holding Registers,%MD,%MD0,0,400001,2,DWORD',
        'Holding Registers,%MD,%MD1,2,400003,2,DWORD',
        'Coils,%QX,%QX0.0,0,000001,1,BOOL',
        'Coils,%QX,%QX0.1,1,000002,1,BOOL',
        'Input Registers,%IW,%IW0,0,300001,1,WORD',
        '',
      ].join('\n'),
    )
  })

  it('covers every address of a default configuration', () => {
    const csv = mappingToCsv(calculateModbusAddressMapping())
    // 1024 %QW + 1024 %MW + 1024 %MD + 1024 %ML + 8192 %QX + 8192 %IX + 1024 %IW
    expect(csv.trimEnd().split('\n')).toHaveLength(1 + 21504)
  })
})
