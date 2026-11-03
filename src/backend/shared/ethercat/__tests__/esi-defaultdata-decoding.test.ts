import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  ConfiguredEtherCATDevice,
  ESICoEObject,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import { decodeXmlBytes } from '@root/middleware/shared/utils/ethercat/esi-zip-import'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { parseESIDeviceFull, parseESILight, parseESIModuleFull } from '../esi-parser-main'
import { generateEtherdogConfigs } from '../generate-ethercat-config'
import { extractDefaultSdoConfigurations } from '../sdo-config-defaults'

const esi = (dataTypes: string, objects: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<EtherCATInfo>
  <Vendor><Id>#x00000100</Id><Name>TestVendor</Name></Vendor>
  <Descriptions>
    <Devices>
      <Device Physics="YY">
        <Type ProductCode="#x0001" RevisionNo="#x0001">TestSlave</Type>
        <Name>Test Slave</Name>
        <Profile>
          <Dictionary>
            <DataTypes>${dataTypes}</DataTypes>
            <Objects>${objects}</Objects>
          </Dictionary>
        </Profile>
      </Device>
    </Devices>
  </Descriptions>
</EtherCATInfo>`

const roSubIndexZero = `<SubItem><SubIdx>0</SubIdx><Name>Max sub-index</Name><Type>USINT</Type><BitSize>8</BitSize><BitOffs>0</BitOffs><Flags><Access>ro</Access></Flags></SubItem>`

const rwSubItem = (subIdx: number, name: string, type: string, bitSize: string, bitOffs: number): string =>
  `<SubItem><SubIdx>${subIdx}</SubIdx><Name>${name}</Name><Type>${type}</Type>${bitSize === '' ? '' : `<BitSize>${bitSize}</BitSize>`}<BitOffs>${bitOffs}</BitOffs><Flags><Access>rw</Access></Flags></SubItem>`

const singleObject = (index: string, name: string, type: string, bitSize: string, defaultData: string): string =>
  `<Object><Index>#x${index}</Index><Name>${name}</Name><Type>${type}</Type>${bitSize === '' ? '' : `<BitSize>${bitSize}</BitSize>`}<Flags><Access>rw</Access></Flags><Info><DefaultData>${defaultData}</DefaultData></Info></Object>`

const infoSubItem = (name: string, defaultData: string): string =>
  `<SubItem><Name>${name}</Name><Info><DefaultData>${defaultData}</DefaultData></Info></SubItem>`

const entriesOf = (xml: string): SDOConfigurationEntry[] => {
  const parsed = parseESIDeviceFull(xml, 0)
  if (!parsed.success || !parsed.device) throw new Error(parsed.error ?? 'parse failed')
  return extractDefaultSdoConfigurations(parsed.device.coeObjects ?? [])
}

type RuntimeSdoRow = { index: string; subindex: number; value: number | string }

const startupSdosOf = (entries: SDOConfigurationEntry[]): RuntimeSdoRow[] => {
  const device: ConfiguredEtherCATDevice = {
    id: 's',
    position: 1,
    name: 's',
    esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
    vendorId: '0x100',
    productCode: '0x1',
    revisionNo: '0x1',
    addedFrom: 'repository',
    config: createDefaultSlaveConfig(),
    channelMappings: [],
    sdoConfigurations: entries,
  }
  const bus: PLCRemoteDevice[] = [
    {
      name: 'bus_a',
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices: [device],
      },
    },
  ]

  const result = generateEtherdogConfigs(bus)
  if (result === null) throw new Error('generator returned null')
  const parsed = JSON.parse(result.busconfig) as { config: { slaves: { sdo_configurations: RuntimeSdoRow[] }[] } }[]
  return parsed[0]?.config.slaves[0]?.sdo_configurations ?? []
}

const valueAt = (entries: SDOConfigurationEntry[], index: string, subIndex: number): string | undefined =>
  entries.find((e) => e.index === index && e.subIndex === subIndex)?.value

describe('ESI composite sub-item DefaultData decoding', () => {
  describe('the KS100E DT60C2 layout', () => {
    const xml = esi(
      `<DataType><Name>DT60C2</Name><BitSize>32</BitSize>${roSubIndexZero}${rwSubItem(1, 'Interpolation time period value', 'USINT', '8', 16)}${rwSubItem(2, 'Interpolation time index', 'SINT', '8', 24)}</DataType>`,
      `<Object><Index>#x60C2</Index><Name>Interpolation time period</Name><Type>DT60C2</Type><BitSize>32</BitSize><Info>${infoSubItem('Interpolation time period value', '01000000')}${infoSubItem('Interpolation time index', 'FFFFFFFD')}</Info></Object>`,
    )

    test('decodes each sub-item at its own BitSize', () => {
      const entries = entriesOf(xml)

      expect(entries).toHaveLength(2)
      expect(valueAt(entries, '0x60C2', 1)).toBe('1')
      expect(valueAt(entries, '0x60C2', 2)).toBe('-1')
    })

    test('never produces 4261412607 as a startup SDO', () => {
      const sdos = startupSdosOf(entriesOf(xml))

      expect(sdos).toHaveLength(2)
      expect(sdos.find((s) => s.subindex === 2)?.value).toBe(-1)
      expect(sdos.map((s) => s.value)).not.toContain(4261412607)
    })
  })

  describe('oversized DefaultData on every integer width', () => {
    const cases: [string, string, string, string][] = [
      ['SINT', '8', '7FFFFFFF', '127'],
      ['SINT', '8', '80FFFFFF', '-128'],
      ['USINT', '8', '01FFFFFF', '1'],
      ['USINT', '8', 'FFFFFFFF', '255'],
      ['INT', '16', 'FEFFFFFF', '-2'],
      ['UINT', '16', 'FFFFFFFF', '65535'],
      ['DINT', '32', 'FDFFFFFFFFFFFFFF', '-3'],
      ['LINT', '64', 'FCFFFFFFFFFFFFFFFF', '-4'],
    ]

    test.each(cases)('a %s of BitSize %s with DefaultData %s decodes to %s', (type, bitSize, data, expected) => {
      const xml = esi(
        `<DataType><Name>DT2100</Name><BitSize>128</BitSize>${roSubIndexZero}${rwSubItem(1, 'Value', type, bitSize, 8)}</DataType>`,
        `<Object><Index>#x2100</Index><Name>Oversized</Name><Type>DT2100</Type><BitSize>128</BitSize><Info>${infoSubItem('Value', data)}</Info></Object>`,
      )

      const entries = entriesOf(xml)

      expect(entries).toHaveLength(1)
      expect(valueAt(entries, '0x2100', 1)).toBe(expected)
    })
  })

  describe('BitOffs', () => {
    test.each([8, 16])('does not choose which bytes are decoded when it is %s', (periodOffs) => {
      const xml = esi(
        `<DataType><Name>DT2300</Name><BitSize>32</BitSize>${roSubIndexZero}${rwSubItem(1, 'Period', 'USINT', '8', periodOffs)}${rwSubItem(2, 'Index', 'SINT', '8', 24)}</DataType>`,
        `<Object><Index>#x2300</Index><Name>Padded</Name><Type>DT2300</Type><BitSize>32</BitSize><Info>${infoSubItem('Period', '01000000')}${infoSubItem('Index', 'FFFFFFFD')}</Info></Object>`,
      )

      const entries = entriesOf(xml)

      expect(entries).toHaveLength(2)
      expect(valueAt(entries, '0x2300', 1)).toBe('1')
      expect(valueAt(entries, '0x2300', 2)).toBe('-1')
    })
  })

  describe('DefaultData that already matches its BitSize', () => {
    test.each([
      ['DINT', '32', '0000FEFF', '-131072'],
      ['DINT', '32', '00000200', '131072'],
      ['UDINT', '32', '20A10700', '500000'],
    ])('keeps the value a %s of BitSize %s already decoded from %s', (type, bitSize, data, expected) => {
      const xml = esi(
        `<DataType><Name>DT2400</Name><BitSize>40</BitSize>${roSubIndexZero}${rwSubItem(1, 'Value', type, bitSize, 8)}</DataType>`,
        `<Object><Index>#x2400</Index><Name>Exact</Name><Type>DT2400</Type><BitSize>40</BitSize><Info>${infoSubItem('Value', data)}</Info></Object>`,
      )

      expect(valueAt(entriesOf(xml), '0x2400', 1)).toBe(expected)
    })
  })
})

describe('BitSize that does not fit its integer type', () => {
  const malformed: [string, string, string][] = [
    ['SINT', '0', 'FFFFFFFD'],
    ['SINT', '-8', 'FFFFFFFD'],
    ['SINT', '', 'FFFFFFFD'],
    ['SINT', '32', 'FFFFFFFD'],
    ['INT', '8', 'FEFF'],
    ['USINT', '16', '0100'],
    ['UDINT', '16', '01000000'],
  ]

  describe('on a composite sub-item', () => {
    const xmlFor = (type: string, bitSize: string, data: string): string =>
      esi(
        `<DataType><Name>DT2500</Name><BitSize>16</BitSize>${roSubIndexZero}${rwSubItem(1, 'Probe', type, bitSize, 8)}${rwSubItem(2, 'Control', 'SINT', '8', 24)}</DataType>`,
        `<Object><Index>#x2500</Index><Name>Malformed</Name><Type>DT2500</Type><BitSize>16</BitSize><Info>${infoSubItem('Probe', data)}${infoSubItem('Control', 'FD')}</Info></Object>`,
      )

    test.each(malformed)('a %s with BitSize %s yields an empty value and its sibling still decodes', (t, b, d) => {
      const entries = entriesOf(xmlFor(t, b, d))

      expect(entries).toHaveLength(2)
      expect(valueAt(entries, '0x2500', 1)).toBe('')
      expect(entries.find((e) => e.subIndex === 1)?.defaultValue).toBe('')
      expect(valueAt(entries, '0x2500', 2)).toBe('-3')
    })

    test.each(malformed)('a %s with BitSize %s sends no startup SDO for that sub-item', (t, b, d) => {
      const sdos = startupSdosOf(entriesOf(xmlFor(t, b, d)))

      expect(sdos).toHaveLength(1)
      expect(sdos[0]).toMatchObject({ index: '0x2500', subindex: 2, value: -3 })
    })
  })

  describe('on a single object', () => {
    const xmlFor = (type: string, bitSize: string, data: string): string =>
      esi(
        '',
        `${singleObject('2410', 'Probe', type, bitSize, data)}${singleObject('2411', 'Control', 'SINT', '8', 'FD')}`,
      )

    test.each(malformed)('a %s with BitSize %s yields an empty value and no startup SDO', (t, b, d) => {
      const entries = entriesOf(xmlFor(t, b, d))

      expect(entries).toHaveLength(2)
      expect(valueAt(entries, '0x2410', 0)).toBe('')
      expect(valueAt(entries, '0x2411', 0)).toBe('-3')

      const sdos = startupSdosOf(entries)
      expect(sdos).toHaveLength(1)
      expect(sdos[0]).toMatchObject({ index: '0x2411', value: -3 })
    })
  })
})

describe('the vendor ESI fixtures', () => {
  const INTEGER_TYPES = new Set(['SINT', 'USINT', 'INT', 'UINT', 'DINT', 'UDINT', 'LINT', 'ULINT'])
  const fixturesDir = join(__dirname, 'fixtures', 'esi-real')
  const read = (name: string): string => decodeXmlBytes(new Uint8Array(readFileSync(join(fixturesDir, name))))

  const rawDefaultOf = (objects: ESICoEObject[], index: string, subIndex: number): string | undefined => {
    const object = objects.find((o) => o.index === index)
    if (!object) return undefined
    if (object.subItems && object.subItems.length > 0) {
      return object.subItems.find((s) => parseInt(s.subIndex, 10) === subIndex)?.defaultValue
    }
    return object.defaultValue
  }

  const objectSetsOf = (xml: string): ESICoEObject[][] => {
    const sets: ESICoEObject[][] = []

    const light = parseESILight(xml)
    ;(light.devices ?? []).forEach((_, deviceIndex) => {
      const parsed = parseESIDeviceFull(xml, deviceIndex)
      if (parsed.success && parsed.device?.coeObjects) sets.push(parsed.device.coeObjects)
    })

    const modules = parseESIModuleFull(xml)
    if (modules.success) {
      for (const esiModule of modules.modules ?? []) {
        if (esiModule.coeObjects) sets.push(esiModule.coeObjects)
      }
    }

    return sets
  }

  const fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.xml'))

  test('every fixture is read', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  test.each(fixtures)('%s: no integer default with a DefaultData decodes to an empty value', (name) => {
    const xml = read(name)
    const emptied: string[] = []

    for (const objects of objectSetsOf(xml)) {
      for (const entry of extractDefaultSdoConfigurations(objects)) {
        if (entry.value !== '') continue
        if (!INTEGER_TYPES.has((entry.dataType ?? '').toUpperCase())) continue
        const raw = rawDefaultOf(objects, entry.index, entry.subIndex)
        if (raw !== undefined && raw.trim() !== '')
          emptied.push(`${entry.index}:${entry.subIndex} ${entry.dataType} ${raw}`)
      }
    }

    expect(emptied).toEqual([])
  })
})
