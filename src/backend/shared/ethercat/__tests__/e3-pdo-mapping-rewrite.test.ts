/**
 * PDO mapping-rewrite generator tests.
 *
 * The startup SDO block has to rewrite each assigned non-Fixed PDO's mapping so the
 * slave boots with the entries the user has in the project, matching the CODESYS
 * 3.5.22.10 output. Covers both the ETG.1000 three-step form and the Complete-Access
 * form a slave that advertises CA receives.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, PersistedPdo, PersistedPdoEntry } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

type Row = {
  slave: number
  index: string
  subindex: number
  value: number | string
  data_type: string
  name?: string
  complete_access?: boolean
  value_bytes?: string
  bit_length?: number
}

const entry = (index: string, sub: string, bitLen: number, name = index): PersistedPdoEntry => ({
  index,
  subIndex: sub,
  bitLen,
  name,
  dataType: 'UINT',
})

const pdoWithEntries = (
  index: string,
  entries: PersistedPdoEntry[],
  over: Partial<PersistedPdo> = {},
): PersistedPdo => ({
  index,
  name: index,
  entries,
  assigned: true,
  ...over,
})

const configuredSlave = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 's',
  position: 1,
  name: 's',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x1',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: {
    ...createDefaultSlaveConfig(),
    coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false },
  },
  channelMappings: [],
  ...over,
})

const bus = (devices: ConfiguredEtherCATDevice[]): PLCRemoteDevice[] =>
  [
    {
      name: 'bus_a',
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices,
      },
    },
  ] as unknown as PLCRemoteDevice[]

const firstSlave = (devices: ConfiguredEtherCATDevice[]): { sdo_configurations: Row[] } => {
  const result = generateEtherdogConfigs(bus(devices))
  if (result === null) throw new Error('generator returned null')
  const bc = JSON.parse(result.busconfig) as { config: { slaves: { sdo_configurations: Row[] }[] } }[]
  return bc[0]!.config.slaves[0]!
}

describe('PDO mapping-rewrite SDO block', () => {
  test('three-step form: clear → entry UDINTs → publish count for an assigned non-Fixed PDO', () => {
    const slave = configuredSlave({
      rxPdos: [pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8, 'Mode'), entry('0x6071', '0x00', 16, 'Target')])],
    })
    const mapping = firstSlave([slave]).sdo_configurations.filter((e) => e.index === '0x1600')
    expect(mapping.length).toBe(4) // clear + 2 entries + count
    expect(mapping[0]).toMatchObject({ index: '0x1600', subindex: 0, value: 0, data_type: 'USINT' })
    // Pack: entry index << 16 | subindex << 8 | bitLen
    expect(mapping[1]).toMatchObject({ subindex: 1, value: (0x6060 << 16) | (0 << 8) | 8 })
    expect(mapping[2]).toMatchObject({ subindex: 2, value: (0x6071 << 16) | (0 << 8) | 16 })
    expect(mapping[3]).toMatchObject({ subindex: 0, value: 2, data_type: 'USINT' })
  })

  test('Complete-Access form: one write per PDO, count padded to 16 bits, then UDINTs little-endian', () => {
    const slave = configuredSlave({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: true },
      },
      rxPdos: [pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8, 'Mode')])],
    })
    const mapping = firstSlave([slave]).sdo_configurations.filter((e) => e.index === '0x1600')
    expect(mapping.length).toBe(1)
    expect(mapping[0]).toMatchObject({
      index: '0x1600',
      subindex: 0,
      complete_access: true,
      data_type: 'OCTET_STRING',
    })
    // Payload: count 01, pad 00, uint32((0x6060<<16)|(0<<8)|8) little-endian = 08 00 60 60
    expect(mapping[0]?.value_bytes).toBe('0x010008006060')
    expect(mapping[0]?.bit_length).toBe(6 * 8)
  })

  test('a Fixed PDO is excluded from the rewrite block', () => {
    const slave = configuredSlave({
      rxPdos: [
        pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8)]),
        pdoWithEntries('0x1601', [entry('0x6071', '0x00', 16)], { fixed: true }),
      ],
    })
    const indices = firstSlave([slave]).sdo_configurations.map((e) => e.index)
    expect(indices).toContain('0x1600')
    expect(indices).not.toContain('0x1601')
  })

  test('unassigned PDOs are skipped', () => {
    const slave = configuredSlave({
      rxPdos: [
        pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8)], { assigned: false }),
        pdoWithEntries('0x1601', [entry('0x6071', '0x00', 16)]),
      ],
    })
    const indices = firstSlave([slave]).sdo_configurations.map((e) => e.index)
    expect(indices).not.toContain('0x1600')
    expect(indices).toContain('0x1601')
  })

  test('mapping rewrite is skipped entirely when coeFlags.pdoConfig is false', () => {
    const slave = configuredSlave({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: true, pdoConfig: false, completeAccess: false },
      },
      rxPdos: [pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8)])],
    })
    const indices = firstSlave([slave]).sdo_configurations.map((e) => e.index)
    expect(indices).not.toContain('0x1600')
    expect(indices).toContain('0x1C12')
  })

  test('per sync manager: clear 0x1C12, then per PDO its mapping and its assignment, then the count', () => {
    const slave = configuredSlave({
      rxPdos: [pdoWithEntries('0x1600', [entry('0x6060', '0x00', 8)]), pdoWithEntries('0x1601', [])],
    })
    const seq = firstSlave([slave]).sdo_configurations.map((e) => `${e.index}:${e.subindex}=${e.value}`)
    expect(seq).toEqual([
      '0x1C12:0=0',
      '0x1600:0=0',
      `0x1600:1=${(0x6060 << 16) | 8}`,
      '0x1600:0=1',
      `0x1C12:1=${0x1600}`,
      `0x1C12:2=${0x1601}`,
      '0x1C12:0=2',
    ])
  })

  test('TxPDOs land in the block after RxPDOs, each in assignment order', () => {
    const slave = configuredSlave({
      rxPdos: [pdoWithEntries('0x1601', [entry('0x6071', '0x00', 16)])],
      txPdos: [
        pdoWithEntries('0x1A01', [entry('0x6041', '0x00', 16)]),
        pdoWithEntries('0x1A00', [entry('0x6040', '0x00', 16)]),
      ],
    })
    const indices = firstSlave([slave]).sdo_configurations.map((e) => e.index)
    const rxIdx = indices.indexOf('0x1601')
    const tx00Idx = indices.indexOf('0x1A00')
    const tx01Idx = indices.indexOf('0x1A01')
    expect(rxIdx).toBeGreaterThan(-1)
    expect(tx01Idx).toBeGreaterThan(rxIdx)
    expect(tx00Idx).toBeGreaterThan(tx01Idx)
  })
})
