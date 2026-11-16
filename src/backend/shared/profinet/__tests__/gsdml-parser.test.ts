import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'
import { buildGsdmlCatalogLookups } from '@root/middleware/shared/utils/profinet/gsdml-catalog-lookups'

import { parseGsdml } from '../index'
import {
  allSubmodules,
  asInterfaceSubmodule,
  asPortSubmodule,
  byId,
  countCatalogElements,
  countRawElements,
  expectCatalog,
  range,
  readGsdmlFixture,
  slotNumbers,
} from './fixtures/gsdml-fixtures'

/** Parses a fixture and returns its catalog. */
function catalogOf(name: string): GsdmlCatalog {
  return expectCatalog(parseGsdml(readGsdmlFixture(name)))
}

/** The data type and bit length of each IO data item. */
function typesAndLengths(items: readonly { dataType: string; bitLength: number | null }[]): [string, number | null][] {
  return items.map((item) => [item.dataType, item.bitLength])
}

describe('parseGsdml: modular device with several access points', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf('modular-head.gsdml.xml')
  })

  it('accepts the fixture, which starts with a byte order mark', () => {
    expect(readGsdmlFixture('modular-head.gsdml.xml').charCodeAt(0)).toBe(0xfeff)
    expect(parseGsdml(readGsdmlFixture('modular-head.gsdml.xml')).success).toBe(true)
  })

  it('reads DeviceIdentity with normalised ident numbers, the VendorName child and the InfoText', () => {
    expect(catalog.identity).toEqual({
      vendorId: '0xf0a',
      deviceId: '0xb1',
      vendorName: 'Example Devices',
      infoText: 'Example modular device',
    })
  })

  it('takes the schema version from the schema location file name', () => {
    expect(catalog.schemaVersion.toUpperCase()).toBe('V2.45')
  })

  it('gives no notice for a clean file of the supported schema version', () => {
    expect(catalog.notices).toEqual([])
  })

  it('lists every device access point in document order', () => {
    expect(catalog.deviceAccessPoints.map((dap) => dap.id)).toEqual(['Head A', 'Head B', 'Head C'])
  })

  it('reads a device access point: ident number, ModuleInfo texts and RequiredSchemaVersion', () => {
    expect(byId(catalog.deviceAccessPoints, 'Head A')).toMatchObject({
      id: 'Head A',
      identNumber: '0xa10',
      name: 'Head module A',
      infoText: 'Head A information in English',
      orderNumber: 'EX-HD-0001',
      requiredSchemaVersion: 'V2.25',
    })
    expect(byId(catalog.deviceAccessPoints, 'Head C')).toMatchObject({
      identNumber: '0x10a10',
      requiredSchemaVersion: 'V2.45',
    })
  })

  it('reads PhysicalSlots and FixedInSlots of a device access point as slot sets', () => {
    const headA = byId(catalog.deviceAccessPoints, 'Head A')
    const headB = byId(catalog.deviceAccessPoints, 'Head B')
    expect(slotNumbers(headA.physicalSlots)).toEqual(range(0, 33))
    expect(slotNumbers(headA.fixedInSlots)).toEqual([0])
    expect(slotNumbers(headB.physicalSlots)).toEqual(range(0, 65))
  })

  it('reads UseableModules/ModuleItemRef with its allowed, fixed and used slot sets', () => {
    const refs = byId(catalog.deviceAccessPoints, 'Head A').useableModules.map((ref) => ({
      moduleId: ref.moduleId,
      allowed: slotNumbers(ref.allowedInSlots),
      fixed: slotNumbers(ref.fixedInSlots),
      used: slotNumbers(ref.usedInSlots),
    }))
    expect(refs).toEqual([
      { moduleId: 'DI 8', allowed: range(1, 32), fixed: [], used: [] },
      { moduleId: 'DI 8 V2', allowed: range(1, 32), fixed: [], used: [] },
      { moduleId: 'DQ 8', allowed: [1, 3, 5, 6, 7], fixed: [5], used: [5, 6] },
      { moduleId: 'AI 2', allowed: [2, 3, 4, 8], fixed: [], used: [] },
      { moduleId: 'Mixed IO', allowed: range(1, 32), fixed: [], used: [] },
      { moduleId: 'Server', allowed: [33], fixed: [33], used: [33] },
    ])
  })

  it('reads the virtual submodule of a device access point with its parameter record', () => {
    const [sub] = byId(catalog.deviceAccessPoints, 'Head A').virtualSubmodules
    expect(sub).toMatchObject({ kind: 'virtual', id: 'Head A', identNumber: '0x0', name: 'Head module A' })
    expect(sub.io).toEqual({ input: [], output: [], inputBitLength: 0, outputBitLength: 0 })
    expect(sub.parameterRecords).toHaveLength(1)
    expect(sub.parameterRecords[0]).toMatchObject({
      index: 1,
      length: 4,
      transferSequence: null,
      name: 'Head parameter record',
      constants: [{ byteOffset: 0, data: [0, 0, 0, 0] }],
    })
  })

  it('reads SystemDefinedSubmoduleList: the interface and its ports with their subslot numbers', () => {
    const subs = byId(catalog.deviceAccessPoints, 'Head A').systemDefinedSubmodules.map((sub) => ({
      kind: sub.kind,
      id: sub.id,
      identNumber: sub.identNumber,
      subslotNumber: sub.subslotNumber,
    }))
    expect(subs).toEqual([
      { kind: 'interface', id: 'Head A IF', identNumber: '0x8002', subslotNumber: 32768 },
      { kind: 'port', id: 'Head A P1', identNumber: '0x8003', subslotNumber: 32769 },
      { kind: 'port', id: 'Head A P2', identNumber: '0x8003', subslotNumber: 32770 },
    ])
  })

  it('keeps SupportedRT_Classes and SupportedProtocols as their tokens, unknown tokens included', () => {
    const headA = asInterfaceSubmodule(
      byId(byId(catalog.deviceAccessPoints, 'Head A').systemDefinedSubmodules, 'Head A IF'),
    )
    const headB = asInterfaceSubmodule(
      byId(byId(catalog.deviceAccessPoints, 'Head B').systemDefinedSubmodules, 'Head B IF'),
    )
    expect(headA.supportedRtClasses).toEqual(['RT_CLASS_1', 'RT_CLASS_3'])
    expect(headA.supportedProtocols).toEqual(['SNMP', 'LLDP'])
    expect(headB.supportedRtClasses).toEqual(['RT_CLASS_1', 'RT_CLASS_FUTURE'])
    expect(headB.supportedProtocols).toEqual(['SNMP', 'LLDP', 'FUTURE_PROTOCOL'])
  })

  it('reads RecordDataList on interface and port submodules', () => {
    const system = byId(catalog.deviceAccessPoints, 'Head A').systemDefinedSubmodules
    expect(
      byId(system, 'Head A IF').parameterRecords.map((record) => [record.index, record.length, record.name]),
    ).toEqual([[45, 2, 'Interface option record']])
    expect(
      byId(system, 'Head A P1').parameterRecords.map((record) => [record.index, record.length, record.name]),
    ).toEqual([[46, 1, 'Port option record']])
  })

  it('reads UseableSubmodules/SubmoduleItemRef with subslot sets on a device access point', () => {
    const refs = byId(catalog.deviceAccessPoints, 'Head B').useableSubmodules.map((ref) => ({
      submoduleId: ref.submoduleId,
      allowed: slotNumbers(ref.allowedInSubslots),
      fixed: slotNumbers(ref.fixedInSubslots),
      used: slotNumbers(ref.usedInSubslots),
    }))
    expect(refs).toEqual([
      { submoduleId: 'Port A1', allowed: [32769], fixed: [], used: [32769] },
      { submoduleId: 'Port A2', allowed: [32770], fixed: [], used: [] },
    ])
  })

  it('lists every ModuleItem in document order', () => {
    expect(catalog.modules.map((mod) => mod.id)).toEqual([
      'DI 8',
      'DI 8 V2',
      'DQ 8',
      'AI 2',
      'Mixed IO',
      'Multi Sub',
      'Server',
    ])
  })

  it('reads a ModuleItem: ident number and every ModuleInfo field', () => {
    expect(byId(catalog.modules, 'DI 8')).toMatchObject({
      identNumber: '0x4d40',
      name: 'Digital input 8',
      infoText: 'Eight digital inputs',
      orderNumber: 'EX-DI-0008',
      hardwareRelease: '2',
      softwareRelease: 'V1.1',
      requiredSchemaVersion: null,
    })
  })

  it('reads UseableSubmodules/SubmoduleItemRef with subslot sets on a ModuleItem', () => {
    const multi = byId(catalog.modules, 'Multi Sub')
    expect(multi.virtualSubmodules).toEqual([])
    expect(
      multi.useableSubmodules.map((ref) => ({
        submoduleId: ref.submoduleId,
        allowed: slotNumbers(ref.allowedInSubslots),
        fixed: slotNumbers(ref.fixedInSubslots),
        used: slotNumbers(ref.usedInSubslots),
      })),
    ).toEqual([
      { submoduleId: 'Sub A', allowed: [1, 2, 3, 4], fixed: [1], used: [1, 2] },
      { submoduleId: 'Sub B', allowed: [2, 3], fixed: [], used: [] },
    ])
  })

  it('reads IO data items with their ID, text, UseAsBits bits and bit lengths', () => {
    const [sub] = byId(catalog.modules, 'DI 8').virtualSubmodules
    expect(sub).toMatchObject({ kind: 'virtual', id: 'DI 8', identNumber: '0x1', name: 'Digital input 8 submodule' })
    expect(sub.io).toEqual({
      input: [
        {
          id: 'DI 8 inputs',
          dataType: 'Unsigned8',
          bitLength: 8,
          textId: 'Inputs 0 to 7',
          text: 'Input byte',
          useAsBits: true,
          bits: [
            { bitOffset: 0, text: 'Channel 0 state' },
            { bitOffset: 1, text: 'Channel 1 state' },
            { bitOffset: 7, text: 'Channel 7 state' },
          ],
        },
        {
          id: null,
          dataType: 'Unsigned16',
          bitLength: 16,
          textId: 'Counter value',
          text: 'Counter',
          useAsBits: false,
          bits: [],
        },
      ],
      output: [],
      inputBitLength: 24,
      outputBitLength: 0,
    })
  })

  it('gives each fixed-size data type its bit length and sums them per direction', () => {
    const [ai] = byId(catalog.modules, 'AI 2').virtualSubmodules
    expect(typesAndLengths(ai.io.input)).toEqual([
      ['Integer16', 16],
      ['Integer16', 16],
      ['Unsigned8+Unsigned8', 16],
      ['Float32+Unsigned8', 40],
    ])
    expect(typesAndLengths(ai.io.output)).toEqual([['Float32', 32]])
    expect([ai.io.inputBitLength, ai.io.outputBitLength]).toEqual([88, 32])

    const [mixed] = byId(catalog.modules, 'Mixed IO').virtualSubmodules
    expect(typesAndLengths(mixed.io.input)).toEqual([
      ['Integer8', 8],
      ['Unsigned32', 32],
      ['Integer32', 32],
      ['Unsigned64', 64],
      ['Integer64', 64],
      ['Float64', 64],
      ['VisibleString', 80],
      ['OctetString', 24],
    ])
    expect(typesAndLengths(mixed.io.output)).toEqual([
      ['F_MessageTrailer4Byte', 32],
      ['F_MessageTrailer5Byte', 40],
      ['Unsigned8', 8],
    ])
    expect([mixed.io.inputBitLength, mixed.io.outputBitLength]).toEqual([368, 80])
  })

  it('reads a parameter record: decimal Index, Length and TransferSequence, its Name and Const data', () => {
    const [record] = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords
    expect(record).toMatchObject({
      index: 128,
      length: 6,
      transferSequence: 1,
      name: 'Channel parameter record',
      constants: [
        { byteOffset: 0, data: [1, 2] },
        { byteOffset: 4, data: [255, 0] },
      ],
    })
    expect(record.fields).toHaveLength(5)
  })

  it('reads an enum field: Ref ID and TextId, ValueItemTarget assignments and single allowed values', () => {
    const field = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords[0].fields[0]
    expect(field).toEqual({
      id: 'Delay ref',
      textId: 'Input delay',
      text: 'Input delay time',
      byteOffset: 0,
      bitOffset: 0,
      bitLength: 8,
      dataType: 'Unsigned8',
      kind: 'enum',
      defaultValue: '3',
      allowedValues: [
        { min: '1', max: '1' },
        { min: '3', max: '3' },
        { min: '5', max: '5' },
      ],
      enumOptions: [
        { value: '1', text: 'Short delay' },
        { value: '3', text: 'Medium delay' },
        { value: '5', text: 'Long delay' },
      ],
      changeable: true,
      visible: true,
    })
  })

  it('reads a Bit field with its BitOffset and Changeable false', () => {
    const field = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords[0].fields[1]
    expect(field).toEqual({
      id: null,
      textId: 'Wire break diagnosis',
      text: 'Wire break check',
      byteOffset: 1,
      bitOffset: 2,
      bitLength: 1,
      dataType: 'Bit',
      kind: 'bit',
      defaultValue: '1',
      allowedValues: null,
      enumOptions: [],
      changeable: false,
      visible: true,
    })
  })

  it('reads a BitArea field with its BitLength, a range of allowed values and Visible false', () => {
    const field = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords[0].fields[2]
    expect(field).toEqual({
      id: null,
      textId: 'Filter level',
      text: 'Filter level setting',
      byteOffset: 1,
      bitOffset: 4,
      bitLength: 3,
      dataType: 'BitArea',
      kind: 'bitArea',
      defaultValue: '0',
      allowedValues: [{ min: '0', max: '5' }],
      enumOptions: [],
      changeable: true,
      visible: false,
    })
  })

  it('defaults BitOffset to 0 and the BitArea BitLength to 1', () => {
    const field = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords[0].fields[3]
    expect(field).toMatchObject({ byteOffset: 2, bitOffset: 0, bitLength: 1, dataType: 'BitArea', kind: 'bitArea' })
  })

  it('reads a signed integer field with a negative range as written', () => {
    const field = byId(catalog.modules, 'DI 8').virtualSubmodules[0].parameterRecords[0].fields[4]
    expect(field).toMatchObject({
      byteOffset: 4,
      bitLength: 16,
      dataType: 'Integer16',
      kind: 'integer',
      defaultValue: '-5',
      allowedValues: [{ min: '-100', max: '100' }],
    })
  })

  it('lists the SubmoduleList: SubmoduleItem and pluggable PortSubmoduleItem', () => {
    expect(catalog.submodules.map((sub) => [sub.kind, sub.id, sub.identNumber])).toEqual([
      ['submodule', 'Sub A', '0x101'],
      ['submodule', 'Sub B', '0x101'],
      ['port', 'Port A1', '0xc000'],
      ['port', 'Port A2', '0xc000'],
    ])
  })

  it('reads a standard submodule with its texts, IO data and an unsigned field with mixed allowed values', () => {
    const subA = byId(catalog.submodules, 'Sub A')
    expect(subA).toMatchObject({ kind: 'submodule', name: 'Submodule A', infoText: 'Pluggable submodule A' })
    expect(typesAndLengths(subA.io.input)).toEqual([['Unsigned16', 16]])
    expect(subA.parameterRecords).toHaveLength(1)
    expect(subA.parameterRecords[0]).toMatchObject({ index: 200, length: 2, name: 'Submodule parameter record' })
    expect(subA.parameterRecords[0].fields[0]).toMatchObject({
      textId: 'Threshold',
      text: 'Switching threshold',
      bitLength: 16,
      dataType: 'Unsigned16',
      kind: 'unsigned',
      defaultValue: '10',
      allowedValues: [
        { min: '0', max: '0' },
        { min: '5', max: '5' },
        { min: '10', max: '20' },
      ],
      enumOptions: [],
    })
    expect(byId(catalog.submodules, 'Sub B').io).toMatchObject({ inputBitLength: 0, outputBitLength: 16 })
  })

  it('reads a pluggable port subslot number when given and null otherwise, with its record', () => {
    const portA1 = asPortSubmodule(byId(catalog.submodules, 'Port A1'))
    const portA2 = asPortSubmodule(byId(catalog.submodules, 'Port A2'))
    expect(portA1.subslotNumber).toBe(32769)
    expect(portA1.name).toBe('Pluggable port A1')
    expect(portA1.parameterRecords.map((record) => record.index)).toEqual([47])
    expect(portA2.subslotNumber).toBeNull()
  })

  it('reads ChannelDiagList with names and help texts', () => {
    expect(catalog.channelDiagnostics).toEqual([
      { errorType: 256, name: 'Short circuit detected', help: 'Check the channel wiring' },
      { errorType: 257, name: 'Supply voltage missing', help: '' },
    ])
  })

  it('reads UnitDiagTypeList with its Ref fields', () => {
    expect(catalog.unitDiagnosticTypes).toEqual([
      {
        userStructureIdentifier: 21,
        name: 'Unit supply diagnosis',
        fields: [
          {
            id: null,
            textId: 'Missing supply',
            text: 'Slot with missing supply',
            byteOffset: 1,
            bitOffset: 0,
            bitLength: 8,
            dataType: 'Unsigned8',
          },
        ],
      },
      {
        userStructureIdentifier: 22,
        name: 'Unit slot diagnosis',
        fields: [
          {
            id: 'Slot code ref',
            textId: 'Slot code',
            text: 'Slot error code',
            byteOffset: 0,
            bitOffset: 2,
            bitLength: 4,
            dataType: 'BitArea',
          },
        ],
      },
    ])
  })

  it('has no log book entries when the file has no LogBookEntryList', () => {
    expect(catalog.logBookEntries).toEqual([])
  })

  it('exposes every FR20 element of the file, one catalog entry per occurrence', () => {
    expect(countCatalogElements(catalog)).toEqual(countRawElements(readGsdmlFixture('modular-head.gsdml.xml')))
    expect(countCatalogElements(catalog)).toEqual({
      DeviceAccessPointItem: 3,
      ModuleItem: 7,
      SubmoduleItem: 2,
      VirtualSubmoduleItem: 9,
      InterfaceSubmoduleItem: 3,
      PortSubmoduleItem: 5,
      ParameterRecordDataItem: 6,
      ChannelDiagItem: 2,
      UnitDiagTypeItem: 2,
      LogBookEntryItem: 0,
    })
  })

  it('makes every device access point, module and submodule reachable by ident, duplicates included', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    for (const dap of catalog.deviceAccessPoints) expect(lookups.dapsByIdent.get(dap.identNumber)).toContain(dap)
    for (const mod of catalog.modules) expect(lookups.modulesByIdent.get(mod.identNumber)).toContain(mod)
    for (const sub of catalog.submodules) expect(lookups.submodulesByIdent.get(sub.identNumber)).toContain(sub)
    expect(lookups.dapsByIdent.get('0xa10')?.map((dap) => dap.id)).toEqual(['Head A', 'Head B'])
    expect(lookups.modulesByIdent.get('0x4d40')?.map((mod) => mod.id)).toEqual(['DI 8', 'DI 8 V2'])
    expect(lookups.submodulesByIdent.get('0x101')?.map((sub) => sub.id)).toEqual(['Sub A', 'Sub B'])
    expect(lookups.submodulesByIdent.get('0xc000')?.map((sub) => sub.id)).toEqual(['Port A1', 'Port A2'])
  })
})

describe('parseGsdml: ExternalText language selection', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf('modular-head.gsdml.xml')
  })

  it('uses PrimaryLanguage before every Language block', () => {
    expect(byId(catalog.deviceAccessPoints, 'Head A').name).toBe('Head module A')
  })

  it('falls back to a Language block whose xml:lang starts with en before an earlier other language', () => {
    expect(byId(catalog.deviceAccessPoints, 'Head A').infoText).toBe('Head A information in English')
  })

  it('falls back to the first other Language block when neither PrimaryLanguage nor English has the text', () => {
    expect(byId(catalog.submodules, 'Port A2').name).toBe('Anschluss A2')
  })
})

describe('parseGsdml: single access point device with octet string data', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf('compact-head.gsdml.xml')
  })

  it('reads DeviceIdentity and the schema version', () => {
    expect(catalog.identity).toEqual({
      vendorId: '0xe21',
      deviceId: '0x7',
      vendorName: 'Compact Example',
      infoText: 'Compact IO head',
    })
    expect(catalog.schemaVersion.toUpperCase()).toBe('V2.35')
    expect(catalog.notices).toEqual([])
  })

  it('reads its only device access point, which has no RequiredSchemaVersion', () => {
    expect(catalog.deviceAccessPoints).toHaveLength(1)
    const [dap] = catalog.deviceAccessPoints
    expect(dap).toMatchObject({
      id: 'Compact DAP',
      identNumber: '0x3',
      name: 'Compact head',
      infoText: 'Compact head with two ports',
      orderNumber: 'CX-0001',
      requiredSchemaVersion: null,
    })
    expect(slotNumbers(dap.physicalSlots)).toEqual(range(0, 32))
    expect(slotNumbers(dap.fixedInSlots)).toEqual([0])
    expect(dap.useableModules.map((ref) => [ref.moduleId, slotNumbers(ref.allowedInSlots)])).toEqual([
      ['CX-8I8O', range(1, 32)],
      ['CX-COM', range(1, 32)],
    ])
    expect(dap.virtualSubmodules.map((sub) => [sub.id, sub.identNumber])).toEqual([['Compact DAP', '0x1']])
  })

  it('reads the fixed interface and ports whatever the attribute order', () => {
    const [dap] = catalog.deviceAccessPoints
    expect(dap.systemDefinedSubmodules.map((sub) => [sub.kind, sub.id, sub.identNumber, sub.subslotNumber])).toEqual([
      ['interface', 'Compact IF', '0x2', 32768],
      ['port', 'Compact P1', '0x3', 32769],
      ['port', 'Compact P2', '0x3', 32770],
    ])
    const iface = asInterfaceSubmodule(dap.systemDefinedSubmodules[0])
    expect(iface.supportedRtClasses).toEqual(['RT_CLASS_1', 'RT_CLASS_3'])
    expect(iface.supportedProtocols).toEqual(['SNMP', 'LLDP'])
  })

  it('sizes OctetString data items from Length in octets', () => {
    const in4 = byId(catalog.submodules, 'CX-IN4')
    const in64 = byId(catalog.submodules, 'CX-IN64')
    const out2 = byId(catalog.submodules, 'CX-OUT2')
    expect(in4.io.input[0]).toEqual({
      id: null,
      dataType: 'OctetString',
      bitLength: 32,
      textId: 'TOK_Input_Data',
      text: 'Input data',
      useAsBits: true,
      bits: [],
    })
    expect(in4.io.inputBitLength).toBe(32)
    expect(in64.io.inputBitLength).toBe(512)
    expect(in64.io.input[0].useAsBits).toBe(false)
    expect(out2.io.outputBitLength).toBe(16)
  })

  it('reads decimal record indexes, Visible false and enum options from the ValueList', () => {
    const [sub] = byId(catalog.modules, 'CX-8I8O').virtualSubmodules
    expect(sub.parameterRecords.map((record) => [record.index, record.length, record.name])).toEqual([
      [0, 4, 'IO byte order'],
      [1, 1, 'Filter record'],
    ])
    expect(sub.parameterRecords[0].fields.map((field) => [field.byteOffset, field.visible, field.changeable])).toEqual([
      [0, false, true],
      [1, false, true],
    ])
    expect(sub.parameterRecords[1].fields[0]).toMatchObject({
      kind: 'enum',
      defaultValue: '1',
      enumOptions: [
        { value: '0', text: 'Filter off' },
        { value: '1', text: 'Filter on' },
      ],
    })
    expect(byId(catalog.submodules, 'CX-IN64').parameterRecords.map((record) => record.index)).toEqual([2])
  })

  it('reads the module UseableSubmodules and the SubmoduleList', () => {
    expect(
      byId(catalog.modules, 'CX-COM').useableSubmodules.map((ref) => [
        ref.submoduleId,
        slotNumbers(ref.allowedInSubslots),
      ]),
    ).toEqual([
      ['CX-IN4', range(2, 32)],
      ['CX-IN64', range(2, 32)],
      ['CX-OUT2', [2]],
    ])
    expect(catalog.submodules.map((sub) => [sub.kind, sub.id, sub.identNumber])).toEqual([
      ['submodule', 'CX-IN4', '0x658800'],
      ['submodule', 'CX-IN64', '0x658c00'],
      ['submodule', 'CX-OUT2', '0x659000'],
    ])
  })

  it('reads ChannelDiagList and every FR20 element present', () => {
    expect(catalog.channelDiagnostics).toEqual([{ errorType: 258, name: 'Overload', help: 'Reduce the load' }])
    expect(countCatalogElements(catalog)).toEqual(countRawElements(readGsdmlFixture('compact-head.gsdml.xml')))
  })

  it('makes every device access point, module and submodule reachable by ident', () => {
    const lookups = buildGsdmlCatalogLookups(catalog)
    for (const dap of catalog.deviceAccessPoints) expect(lookups.dapsByIdent.get(dap.identNumber)).toContain(dap)
    for (const mod of catalog.modules) expect(lookups.modulesByIdent.get(mod.identNumber)).toContain(mod)
    for (const sub of catalog.submodules) expect(lookups.submodulesByIdent.get(sub.identNumber)).toContain(sub)
  })
})

describe('parseGsdml: LogBookEntryList', () => {
  it('reads the value and list forms of ErrorCode2 with names and help texts', () => {
    const catalog = catalogOf('logbook.gsdml.xml')
    expect(catalog.logBookEntries).toEqual([
      { status: 2131000, errorCode2: { kind: 'value', name: 'Vendor fault', help: 'Restart the device' } },
      {
        status: 2131001,
        errorCode2: {
          kind: 'list',
          items: [
            { errorCode2: 0, name: 'Code zero', help: '' },
            { errorCode2: 255, name: 'Code maximum', help: 'Replace the module' },
          ],
        },
      },
      { status: 2131002, errorCode2: { kind: 'value', name: 'Fault without help', help: '' } },
    ])
    expect(catalog.notices).toEqual([])
    expect(countCatalogElements(catalog)).toEqual(countRawElements(readGsdmlFixture('logbook.gsdml.xml')))
  })
})

describe('parseGsdml: every submodule kind carries the shared fields', () => {
  it('gives each submodule an id, a normalised ident number, texts, IO data, records and its RequiredSchemaVersion', () => {
    const catalog = catalogOf('modular-head.gsdml.xml')
    for (const sub of allSubmodules(catalog)) {
      expect(sub.identNumber).toMatch(/^0x(0|[1-9a-f][0-9a-f]*)$/)
      expect(typeof sub.name).toBe('string')
      expect(typeof sub.infoText).toBe('string')
      expect(Array.isArray(sub.io.input) && Array.isArray(sub.io.output)).toBe(true)
      expect(Array.isArray(sub.parameterRecords)).toBe(true)
      expect(sub.requiredSchemaVersion).toBeNull()
    }
  })
})
