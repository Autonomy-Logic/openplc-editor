import { parseGsdml } from '../index'
import {
  asInterfaceSubmodule,
  asPortSubmodule,
  byId,
  expectCatalog,
  expectError,
  readGsdmlFixture,
  replaceOnce,
} from './fixtures/gsdml-fixtures'

const BASE = readGsdmlFixture('structural-base.gsdml.xml')
const MALFORMED_PREFIX = 'GSDML XML is malformed: '

/** Whether `text` names `name` as a whole word, so `Ref` does not match inside `ModuleItemRef`. */
function namesWord(text: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${name}($|[^A-Za-z0-9_])`).test(text)
}

/** A structural failure: the element and attribute the reason names, the element ID, and the edit of the base file. */
type AttributeCase = [element: string, attribute: string, elementId: string | null, search: string, replacement: string]

const MISSING_REQUIRED_ATTRIBUTE: AttributeCase[] = [
  ['DeviceIdentity', 'VendorID', null, ' VendorID="0x0F0B"', ''],
  ['DeviceIdentity', 'DeviceID', null, ' DeviceID="0x00C1"', ''],
  ['DeviceAccessPointItem', 'ID', null, '<DeviceAccessPointItem ID="B_DAP"', '<DeviceAccessPointItem'],
  ['DeviceAccessPointItem', 'ModuleIdentNumber', 'B_DAP', ' ModuleIdentNumber="0x00000B01"', ''],
  ['DeviceAccessPointItem', 'PhysicalSlots', 'B_DAP', ' PhysicalSlots="0..4"', ''],
  ['DeviceAccessPointItem', 'FixedInSlots', 'B_DAP', ' FixedInSlots="0"', ''],
  ['ModuleItem', 'ID', null, '<ModuleItem ID="B_MOD"', '<ModuleItem'],
  ['ModuleItem', 'ModuleIdentNumber', 'B_MOD', ' ModuleIdentNumber="0x00000B02"', ''],
  ['SubmoduleItem', 'ID', null, '<SubmoduleItem ID="B_SUB"', '<SubmoduleItem'],
  ['SubmoduleItem', 'SubmoduleIdentNumber', 'B_SUB', ' SubmoduleIdentNumber="0x00000B03"', ''],
  ['VirtualSubmoduleItem', 'ID', null, '<VirtualSubmoduleItem ID="B_VSUB"', '<VirtualSubmoduleItem'],
  ['VirtualSubmoduleItem', 'SubmoduleIdentNumber', 'B_VSUB', ' SubmoduleIdentNumber="0x00000001"', ''],
  ['InterfaceSubmoduleItem', 'ID', null, '<InterfaceSubmoduleItem ID="B_IF"', '<InterfaceSubmoduleItem'],
  ['InterfaceSubmoduleItem', 'SubmoduleIdentNumber', 'B_IF', ' SubmoduleIdentNumber="0x00008000"', ''],
  ['PortSubmoduleItem', 'ID', null, '<PortSubmoduleItem ID="B_PORT"', '<PortSubmoduleItem'],
  ['PortSubmoduleItem', 'SubmoduleIdentNumber', 'B_PORT', ' SubmoduleIdentNumber="0x00008001"', ''],
  ['PortSubmoduleItem', 'SubslotNumber', 'B_PORT', ' SubslotNumber="32769"', ''],
  ['PortSubmoduleItem', 'ID', null, '<PortSubmoduleItem ID="B_PLUG_PORT"', '<PortSubmoduleItem'],
  ['PortSubmoduleItem', 'SubmoduleIdentNumber', 'B_PLUG_PORT', ' SubmoduleIdentNumber="0x00000B04"', ''],
  ['ModuleItemRef', 'ModuleItemTarget', null, ' ModuleItemTarget="B_MOD"', ''],
  ['SubmoduleItemRef', 'SubmoduleItemTarget', null, ' SubmoduleItemTarget="B_SUB"', ''],
  ['DataItem', 'DataType', null, '<DataItem DataType="Unsigned8"', '<DataItem'],
  ['DataItem', 'Length', null, 'DataType="VisibleString" Length="4"', 'DataType="VisibleString"'],
  ['DataItem', 'Length', null, 'DataType="VisibleString" Length="4"', 'DataType="OctetString"'],
  ['BitDataItem', 'BitOffset', null, ' BitOffset="3"', ''],
  ['ParameterRecordDataItem', 'Index', null, ' Index="1"', ''],
  ['ParameterRecordDataItem', 'Length', null, ' Length="2" TransferSequence', ' TransferSequence'],
  ['Ref', 'ByteOffset', null, ' ByteOffset="1" DefaultValue="1"', ' DefaultValue="1"'],
  ['Ref', 'DataType', null, ' DataType="Unsigned8" ByteOffset="1"', ' ByteOffset="1"'],
  ['Ref', 'DefaultValue', null, ' DefaultValue="1"', ''],
  ['Const', 'Data', null, ' Data="0x00,0x01"', ''],
  ['Ref', 'ByteOffset', null, ' ByteOffset="2" DataType="Unsigned16"', ' DataType="Unsigned16"'],
  ['Ref', 'DataType', null, ' DataType="Unsigned16" TextId="T_UnitField"', ' TextId="T_UnitField"'],
  ['ValueItem', 'ID', null, '<ValueItem ID="B_VALUES"', '<ValueItem'],
  ['Assign', 'Content', null, ' Content="1"', ''],
  ['Text', 'TextId', null, '<Text TextId="T_Device" Value="Base device" />', '<Text Value="Base device" />'],
  ['Text', 'Value', null, '<Text TextId="T_Device" Value="Base device" />', '<Text TextId="T_Device" />'],
  ['ChannelDiagItem', 'ErrorType', null, ' ErrorType="300"', ''],
  ['UnitDiagTypeItem', 'UserStructureIdentifier', null, ' UserStructureIdentifier="7"', ''],
  ['LogBookEntryItem', 'Status', null, ' Status="2131100"', ''],
  ['ErrorCode2Item', 'ErrorCode2', null, ' ErrorCode2="9"', ''],
]

const UNPARSEABLE_REQUIRED_ATTRIBUTE: AttributeCase[] = [
  ['DeviceIdentity', 'VendorID', null, 'VendorID="0x0F0B"', 'VendorID="0xZZ"'],
  [
    'DeviceAccessPointItem',
    'ModuleIdentNumber',
    'B_DAP',
    'ModuleIdentNumber="0x00000B01"',
    'ModuleIdentNumber="0xGG01"',
  ],
  ['DeviceAccessPointItem', 'PhysicalSlots', 'B_DAP', 'PhysicalSlots="0..4"', 'PhysicalSlots="0..four"'],
  ['DeviceAccessPointItem', 'FixedInSlots', 'B_DAP', 'FixedInSlots="0"', 'FixedInSlots="first"'],
  ['SubmoduleItem', 'SubmoduleIdentNumber', 'B_SUB', 'SubmoduleIdentNumber="0x00000B03"', 'SubmoduleIdentNumber="sub"'],
  ['PortSubmoduleItem', 'SubslotNumber', 'B_PORT', 'SubslotNumber="32769"', 'SubslotNumber="port"'],
  ['DataItem', 'Length', null, 'DataType="VisibleString" Length="4"', 'DataType="VisibleString" Length="four"'],
  ['BitDataItem', 'BitOffset', null, 'BitOffset="3"', 'BitOffset="x3"'],
  ['ParameterRecordDataItem', 'Index', null, ' Index="1"', ' Index="one"'],
  ['ParameterRecordDataItem', 'Length', null, 'Length="2" TransferSequence', 'Length="two" TransferSequence'],
  ['Ref', 'ByteOffset', null, 'ByteOffset="1" DefaultValue', 'ByteOffset="b1" DefaultValue'],
  ['Const', 'Data', null, 'Data="0x00,0x01"', 'Data="0xZZ,0x01"'],
  ['ChannelDiagItem', 'ErrorType', null, 'ErrorType="300"', 'ErrorType="three hundred"'],
  [
    'UnitDiagTypeItem',
    'UserStructureIdentifier',
    null,
    'UserStructureIdentifier="7"',
    'UserStructureIdentifier="seven"',
  ],
  ['LogBookEntryItem', 'Status', null, 'Status="2131100"', 'Status="bad"'],
  ['ErrorCode2Item', 'ErrorCode2', null, 'ErrorCode2="9"', 'ErrorCode2="nine"'],
]

describe('parseGsdml: input', () => {
  it('parses the structural base file, the starting point of every edit below', () => {
    expect(parseGsdml(BASE).success).toBe(true)
  })

  it('accepts a leading U+FEFF and reads the same catalog as without it', () => {
    expect(parseGsdml(`\uFEFF${BASE}`)).toEqual(parseGsdml(BASE))
  })

  it('rejects empty input', () => {
    expect(parseGsdml('')).toEqual({ success: false, error: 'GSDML input is empty.' })
  })

  it.each(['null', '42', '{}', '["<ISO15745Profile/>"]', 'true'])('rejects the non-string input %s', (json) => {
    const input: string = JSON.parse(json)
    expect(parseGsdml(input)).toEqual({ success: false, error: 'GSDML input is empty.' })
  })
})

describe('parseGsdml: structural failures', () => {
  it.each(['malformed-unclosed', 'malformed-mismatched', 'malformed-attribute'])(
    'rejects XML that is not well-formed (%s) with the malformed reason',
    (name) => {
      const error = expectError(parseGsdml(readGsdmlFixture('structural', `${name}.gsdml.xml`)))
      expect(error.startsWith(MALFORMED_PREFIX)).toBe(true)
      expect(error.length).toBeGreaterThan(MALFORMED_PREFIX.length)
    },
  )

  it('rejects a root element other than ISO15745Profile, naming ISO15745Profile', () => {
    expect(expectError(parseGsdml(readGsdmlFixture('structural', 'wrong-root.gsdml.xml')))).toContain('ISO15745Profile')
  })

  it('rejects a root with neither the GSDML namespace nor a schema location hint', () => {
    const error = expectError(parseGsdml(readGsdmlFixture('structural', 'no-namespace.gsdml.xml')))
    expect(error).toContain('ISO15745Profile')
    expect(error).toMatch(/xmlns|schemaLocation|namespace/i)
  })

  it.each([
    ['no-profile-body', 'ProfileBody'],
    ['no-device-identity', 'DeviceIdentity'],
    ['no-application-process', 'ApplicationProcess'],
  ])('rejects a file with %s, naming %s', (name, element) => {
    expect(namesWord(expectError(parseGsdml(readGsdmlFixture('structural', `${name}.gsdml.xml`))), element)).toBe(true)
  })

  it.each(MISSING_REQUIRED_ATTRIBUTE)(
    'rejects a %s without its required %s, naming the element, the attribute and the ID %s',
    (element, attribute, elementId, search, replacement) => {
      const error = expectError(parseGsdml(replaceOnce(BASE, search, replacement)))
      expect(namesWord(error, element)).toBe(true)
      expect(namesWord(error, attribute)).toBe(true)
      if (elementId !== null) expect(error).toContain(elementId)
    },
  )

  it.each(UNPARSEABLE_REQUIRED_ATTRIBUTE)(
    'rejects a %s whose %s does not parse as its type, naming the element, the attribute and the ID %s',
    (element, attribute, elementId, search, replacement) => {
      const error = expectError(parseGsdml(replaceOnce(BASE, search, replacement)))
      expect(namesWord(error, element)).toBe(true)
      expect(namesWord(error, attribute)).toBe(true)
      if (elementId !== null) expect(error).toContain(elementId)
    },
  )
})

describe('parseGsdml: a structurally valid file is never rejected for any other reason', () => {
  it('accepts an InterfaceSubmoduleItem without its token-list attributes, with empty token lists', () => {
    const xml = replaceOnce(BASE, ' SupportedRT_Classes="RT_CLASS_1" SupportedProtocols="SNMP;LLDP"', '')
    const catalog = expectCatalog(parseGsdml(xml))
    const iface = asInterfaceSubmodule(byId(catalog.deviceAccessPoints[0].systemDefinedSubmodules, 'B_IF'))
    expect(iface.supportedRtClasses).toEqual([])
    expect(iface.supportedProtocols).toEqual([])
  })

  it('accepts a data item and a parameter field without TextId', () => {
    let xml = replaceOnce(BASE, 'UseAsBits="true" TextId="T_In">', 'UseAsBits="true">')
    xml = replaceOnce(xml, ' DefaultValue="1" TextId="T_Field"', ' DefaultValue="1"')
    const sub = expectCatalog(parseGsdml(xml)).deviceAccessPoints[0].virtualSubmodules[0]
    expect(sub.io.input[0]).toMatchObject({ textId: '', text: '' })
    expect(sub.parameterRecords[0].fields[0]).toMatchObject({ textId: '', text: '' })
  })

  it('accepts a ParameterRecordDataItem without TransferSequence, which reads as null', () => {
    const xml = replaceOnce(BASE, ' TransferSequence="1"', '')
    const record = expectCatalog(parseGsdml(xml)).deviceAccessPoints[0].virtualSubmodules[0].parameterRecords[0]
    expect(record.transferSequence).toBeNull()
  })

  it('accepts a ModuleItem without ModuleInfo', () => {
    const xml = replaceOnce(BASE, '<ModuleInfo>\n            <Name TextId="T_Mod" />\n          </ModuleInfo>', '')
    expect(byId(expectCatalog(parseGsdml(xml)).modules, 'B_MOD').name).toBe('')
  })

  it('accepts a pluggable PortSubmoduleItem without SubslotNumber, which reads as null', () => {
    const catalog = expectCatalog(parseGsdml(BASE))
    expect(asPortSubmodule(byId(catalog.submodules, 'B_PLUG_PORT')).subslotNumber).toBeNull()
  })

  it('accepts a file without ExternalTextList', () => {
    const xml = BASE.replace(/<ExternalTextList>[\s\S]*<\/ExternalTextList>/, '')
    expect(xml).not.toContain('ExternalTextList')
    expect(parseGsdml(xml).success).toBe(true)
  })

  it('ignores unknown elements and attributes of a supported-version file without any notice', () => {
    let xml = replaceOnce(BASE, '<DeviceAccessPointItem ID="B_DAP"', '<DeviceAccessPointItem FutureFlag="1" ID="B_DAP"')
    xml = replaceOnce(
      xml,
      '<ValueList>',
      '<FutureList><FutureItem ID="F1" Size="9"><FutureChild /></FutureItem></FutureList><ValueList>',
    )
    xml = replaceOnce(xml, '<Const ByteOffset="0"', '<FutureRecordPart Mode="x" /><Const ByteOffset="0"')
    const catalog = expectCatalog(parseGsdml(xml))
    expect(catalog.notices).toEqual([])
    expect(catalog).toEqual(expectCatalog(parseGsdml(BASE)))
  })

  it('accepts a 0x prefix on a decimal attribute', () => {
    const xml = replaceOnce(BASE, ' Index="1"', ' Index="0x10"')
    expect(expectCatalog(parseGsdml(xml)).deviceAccessPoints[0].virtualSubmodules[0].parameterRecords[0].index).toBe(16)
  })

  it('reads the schema version as empty when the schema location names no version', () => {
    const xml = replaceOnce(BASE, 'GSDML-DeviceProfile-v2.45.xsd', 'GSDML-DeviceProfile.xsd')
    expect(expectCatalog(parseGsdml(xml)).schemaVersion).toBe('')
  })
})

describe('parseGsdml: never throws', () => {
  it('returns a result for 50,000 levels of nesting, a failure carrying the malformed reason if any', () => {
    const depth = 50_000
    const xml = replaceOnce(
      BASE,
      '<ValueList>',
      `${'<FutureNest>'.repeat(depth)}${'</FutureNest>'.repeat(depth)}<ValueList>`,
    )
    let result: ReturnType<typeof parseGsdml> | undefined
    expect(() => {
      result = parseGsdml(xml)
    }).not.toThrow()
    expect(result).toBeDefined()
    if (result !== undefined && !result.success) expect(result.error.startsWith(MALFORMED_PREFIX)).toBe(true)
  })

  it.each([
    '<',
    '<<<>>>',
    '\u0000\u0001\u0002',
    'not xml at all',
    '<ISO15745Profile',
    '<?xml version="1.0"?>',
    '</ISO15745Profile>',
  ])('returns a failure for the garbage input %j', (input) => {
    let result: ReturnType<typeof parseGsdml> | undefined
    expect(() => {
      result = parseGsdml(input)
    }).not.toThrow()
    expect(result?.success).toBe(false)
  })
})
