import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'

import { GSDML_MAX_NOTICES, GSDML_SUPPORTED_SCHEMA_VERSION, parseGsdml } from '../index'
import {
  byId,
  type CatalogNotice,
  catalogOf,
  newerDapSystemSubmodules,
  newerInterface,
  newerVersionWithInterface,
  noticeKinds,
  noticesOf,
  readGsdmlFixture,
  replaceOnce,
  withConsoleRecorded,
} from './fixtures/gsdml-fixtures'

const BASE = readGsdmlFixture('structural-base.gsdml.xml')
const BASE_SCHEMA_FILE = 'GSDML-DeviceProfile-v2.45.xsd'

/** Whether a notice names `value` anywhere in its fields. */
function names(notice: CatalogNotice, value: string): boolean {
  return JSON.stringify(notice).includes(value)
}

describe('Annex A.3.3: objects whose RequiredSchemaVersion is newer than the supported version', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf(readGsdmlFixture('schema-version-boundaries.gsdml.xml'))
  })

  it('supports schema version V2.45', () => {
    expect(GSDML_SUPPORTED_SCHEMA_VERSION).toBe('V2.45')
  })

  it('keeps objects up to the supported version, comparing versions textually and ignoring the case of V', () => {
    expect(catalog.deviceAccessPoints.map((dap) => dap.id)).toEqual(['VB_DAP'])
    expect(catalog.modules.map((mod) => mod.id)).toEqual(['VB_225', 'VB_23', 'VB_24', 'VB_245_LOWER'])
    expect(catalog.submodules.map((sub) => sub.id)).toEqual(['VB_SUB_OK'])
    expect(byId(catalog.modules, 'VB_24').requiredSchemaVersion).toBe('V2.4')
  })

  it('leaves newer objects out without checking their missing required attributes, one notice each', () => {
    expect(catalog.notices.every((notice) => notice.kind === 'object-skipped')).toBe(true)
    expect(catalog.notices.map((notice) => notice.elementId).sort()).toEqual(
      ['VB_DAP_NEW', 'VB_25', 'VB_2450', 'VB_2451', 'VB_299_LOWER', 'VB_30', 'VB_SUB_NEW', 'VB_PORT_NEW'].sort(),
    )
  })
})

describe('Annex A.3.3: a file newer than the supported schema version', () => {
  let catalog: GsdmlCatalog

  beforeAll(() => {
    catalog = catalogOf(readGsdmlFixture('newer-version.gsdml.xml'))
  })

  it('loads, with one newer-schema-version notice and one object-skipped notice, and nothing for unknown nodes', () => {
    expect(catalog.schemaVersion.toUpperCase()).toBe('V2.99')
    expect(noticeKinds(catalog)).toEqual(['newer-schema-version', 'object-skipped'])
    expect(noticesOf(catalog, 'object-skipped')[0].elementId).toBe('N_FUTURE_MOD')
  })

  it('reads the known structure around unknown elements and attributes', () => {
    expect(catalog.identity).toEqual({
      vendorId: '0xf0d',
      deviceId: '0xe1',
      vendorName: 'Future Vendor',
      infoText: 'Future device',
    })
    const dap = byId(catalog.deviceAccessPoints, 'N_DAP')
    expect(dap.identNumber).toBe('0xd01')
    expect(dap.name).toBe('Future head')
    expect(dap.useableModules.map((ref) => ref.moduleId)).toEqual(['N_MOD'])
    expect(dap.virtualSubmodules[0].io.input.map((item) => [item.dataType, item.bitLength, item.text])).toEqual([
      ['Unsigned16', 16, 'Future input'],
    ])
    expect(catalog.modules.map((mod) => [mod.id, mod.identNumber, mod.name])).toEqual([
      ['N_MOD', '0xd02', 'Future module'],
    ])
  })

  it.each([
    ['v2.5', true],
    ['V2.450', true],
    ['V3.0', true],
    ['V2.46', true],
    ['V2.45', false],
    ['v2.45', false],
    ['V2.4', false],
    ['V2.25', false],
    ['V2.3', false],
  ])('treats a schema location of %s as newer: %s', (version, newer) => {
    const xml = replaceOnce(BASE, BASE_SCHEMA_FILE, `GSDML-DeviceProfile-${version}.xsd`)
    const result = catalogOf(xml)
    expect(noticesOf(result, 'newer-schema-version')).toHaveLength(newer ? 1 : 0)
    expect(result.notices).toHaveLength(newer ? 1 : 0)
  })
})

describe('Annex A.3.3: TokenList attributes of an InterfaceSubmoduleItem outside compatibility mode', () => {
  const UNKNOWN_TOKENS = 'SupportedRT_Classes="RT_CLASS_1;RT_CLASS_FUTURE" SupportedProtocols="SNMP;FUTURE_PROTOCOL"'

  it.each([
    ['at the supported version', 'v2.45'],
    ['with no version in its schema location', null],
  ])('keeps every token as written, with no notice for them, in a file %s', (_label, version) => {
    const newer = newerVersionWithInterface(UNKNOWN_TOKENS)
    const xml =
      version === null
        ? replaceOnce(newer, 'GSDML-DeviceProfile-V2.99.xsd', 'DeviceProfile.xsd')
        : newerVersionWithInterface(UNKNOWN_TOKENS, version)
    const catalog = catalogOf(xml)
    expect(newerInterface(catalog).supportedRtClasses).toEqual(['RT_CLASS_1', 'RT_CLASS_FUTURE'])
    expect(newerInterface(catalog).supportedProtocols).toEqual(['SNMP', 'FUTURE_PROTOCOL'])
    expect(noticeKinds(catalog)).toEqual(['object-skipped'])
  })

  it('gives an InterfaceSubmoduleItem skipped for its RequiredSchemaVersion no notice for its unknown tokens', () => {
    const catalog = catalogOf(newerVersionWithInterface(`RequiredSchemaVersion="V2.99" ${UNKNOWN_TOKENS}`))
    expect(newerDapSystemSubmodules(catalog)).toEqual([])
    expect(noticeKinds(catalog)).toEqual(['newer-schema-version', 'object-skipped', 'object-skipped'])
  })
})

describe('notices', () => {
  it('gives an unresolved TextId an empty text and one unresolved-text notice per distinct id', () => {
    let xml = replaceOnce(BASE, '<Text TextId="T_Mod" Value="Base module" />', '')
    xml = replaceOnce(xml, '<Text TextId="T_Chan" Value="Base channel error" />', '')
    xml = replaceOnce(xml, '<Name TextId="T_Sub" />', '<Name TextId="T_Mod" />')
    const catalog = catalogOf(xml)
    expect(byId(catalog.modules, 'B_MOD').name).toBe('')
    expect(byId(catalog.submodules, 'B_SUB').name).toBe('')
    expect(catalog.channelDiagnostics[0].name).toBe('')
    const unresolved = noticesOf(catalog, 'unresolved-text')
    expect(unresolved).toHaveLength(2)
    expect(unresolved.filter((notice) => names(notice, 'T_Mod'))).toHaveLength(1)
    expect(unresolved.filter((notice) => names(notice, 'T_Chan'))).toHaveLength(1)
    expect(catalog.notices).toHaveLength(2)
  })

  it.each([
    ['ModuleItemRef', 'ModuleItemTarget="B_MOD"', 'ModuleItemTarget="B_NO_MODULE"', 'B_NO_MODULE'],
    ['SubmoduleItemRef', 'SubmoduleItemTarget="B_SUB"', 'SubmoduleItemTarget="B_NO_SUBMODULE"', 'B_NO_SUBMODULE'],
    ['ValueItemTarget', 'ValueItemTarget="B_VALUES"', 'ValueItemTarget="B_NO_VALUES"', 'B_NO_VALUES'],
  ])('gives a %s naming no element one dangling-reference notice', (_label, search, replacement, missing) => {
    const catalog = catalogOf(replaceOnce(BASE, search, replacement))
    expect(catalog.notices).toHaveLength(1)
    expect(catalog.notices[0].kind).toBe('dangling-reference')
    expect(names(catalog.notices[0], missing)).toBe(true)
  })

  it('leaves the enum options of a field with a dangling ValueItemTarget empty', () => {
    const catalog = catalogOf(replaceOnce(BASE, 'ValueItemTarget="B_VALUES"', 'ValueItemTarget="B_NO_VALUES"'))
    const field = catalog.deviceAccessPoints[0].virtualSubmodules[0].parameterRecords[0].fields[0]
    expect(field.enumOptions).toEqual([])
  })

  it('gives a data item of unknown type a null bit length, a null direction sum and an unknown-data-type notice', () => {
    const catalog = catalogOf(
      replaceOnce(BASE, 'DataType="VisibleString" Length="4"', 'DataType="FutureType42" Length="4"'),
    )
    const { io } = catalog.deviceAccessPoints[0].virtualSubmodules[0]
    expect(io.input.map((item) => [item.dataType, item.bitLength])).toEqual([
      ['Unsigned8', 8],
      ['FutureType42', null],
    ])
    expect(io.inputBitLength).toBeNull()
    expect(io.outputBitLength).toBe(0)
    expect(catalog.notices).toHaveLength(1)
    expect(catalog.notices[0].kind).toBe('unknown-data-type')
    expect(names(catalog.notices[0], 'FutureType42')).toBe(true)
  })

  it('gives a parameter field of unknown type a null bit length, kind other and an unknown-data-type notice', () => {
    const catalog = catalogOf(
      replaceOnce(BASE, '<Ref ValueItemTarget="B_VALUES" DataType="Unsigned8"', '<Ref DataType="FutureType43"'),
    )
    const field = catalog.deviceAccessPoints[0].virtualSubmodules[0].parameterRecords[0].fields[0]
    expect(field).toMatchObject({ dataType: 'FutureType43', bitLength: null, kind: 'other' })
    expect(catalog.notices).toHaveLength(1)
    expect(catalog.notices[0].kind).toBe('unknown-data-type')
    expect(names(catalog.notices[0], 'FutureType43')).toBe(true)
  })

  it('gives a no-device-access-point notice, not a rejection, when the only DAP is newer than supported', () => {
    const catalog = catalogOf(
      replaceOnce(
        BASE,
        '<DeviceAccessPointItem ID="B_DAP"',
        '<DeviceAccessPointItem RequiredSchemaVersion="V2.99" ID="B_DAP"',
      ),
    )
    expect(catalog.deviceAccessPoints).toEqual([])
    expect(noticeKinds(catalog)).toEqual(['no-device-access-point', 'object-skipped'])
    expect(noticesOf(catalog, 'object-skipped')[0].elementId).toBe('B_DAP')
  })

  it('gives a no-device-access-point notice, not a rejection, when the DeviceAccessPointList is empty', () => {
    const xml = BASE.replace(/<DeviceAccessPointItem[\s\S]*<\/DeviceAccessPointItem>/, '')
    expect(xml).not.toContain('<DeviceAccessPointItem')
    const catalog = catalogOf(xml)
    expect(catalog.deviceAccessPoints).toEqual([])
    expect(noticeKinds(catalog)).toEqual(['no-device-access-point'])
  })

  it('caps the notices at GSDML_MAX_NOTICES and adds one notices-truncated notice with the dropped count', () => {
    expect(Number.isInteger(GSDML_MAX_NOTICES)).toBe(true)
    expect(GSDML_MAX_NOTICES).toBeGreaterThanOrEqual(1000)
    const dropped = 1234
    const items = Array.from(
      { length: GSDML_MAX_NOTICES + dropped },
      (_, i) => `<ChannelDiagItem ErrorType="${1000 + i}"><Name TextId="T_Missing_${i}" /></ChannelDiagItem>`,
    ).join('')
    const catalog = catalogOf(replaceOnce(BASE, '<ChannelDiagList>', `<ChannelDiagList>${items}`))
    expect(catalog.channelDiagnostics).toHaveLength(GSDML_MAX_NOTICES + dropped + 1)
    expect(catalog.notices).toHaveLength(GSDML_MAX_NOTICES + 1)
    const truncated = noticesOf(catalog, 'notices-truncated')
    expect(truncated).toHaveLength(1)
    expect(names(truncated[0], String(dropped))).toBe(true)
    expect(noticesOf(catalog, 'unresolved-text')).toHaveLength(GSDML_MAX_NOTICES)
  })

  it('writes nothing to the console while parsing, notices included', () => {
    const inputs = [
      readGsdmlFixture('modular-head.gsdml.xml'),
      readGsdmlFixture('newer-version.gsdml.xml'),
      readGsdmlFixture('schema-version-boundaries.gsdml.xml'),
      replaceOnce(BASE, 'ModuleItemTarget="B_MOD"', 'ModuleItemTarget="B_NO_MODULE"'),
      readGsdmlFixture('structural', 'malformed-unclosed.gsdml.xml'),
    ]
    const { calls } = withConsoleRecorded(() => inputs.map((xml) => parseGsdml(xml)))
    expect(calls).toEqual([])
  })
})
