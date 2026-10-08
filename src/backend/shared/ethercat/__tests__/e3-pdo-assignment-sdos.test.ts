/**
 * DOPE-704 E3 generator tests.
 *
 * Verifies the PDO-assignment startup SDO block (0x1C12 / 0x1C13 writes in CODESYS order)
 * that the generator emits when a slave advertises PdoAssign. The on-wire sequence is
 * what the Delta ASDA-A2-E fixture needs to boot in a mode other than its silicon
 * default, and is the acceptance criterion AC01 in the Requirements Gathering.
 */

import type { ConfiguredEtherCATDevice, PersistedPdo } from '@root/middleware/shared/ports/esi-types'
import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

type IoEntry = { slave: number; index: string; subindex: number; value: number | string; name?: string }

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

const pdo = (index: string, assigned: boolean | undefined = true, name = index): PersistedPdo => ({
  index,
  name,
  entries: [],
  assigned,
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

/** Pull the sdo_configurations rows of the first slave from the first master's config. */
const firstBusConfig = (devices: ConfiguredEtherCATDevice[]): { sdo_configurations: IoEntry[] }[] => {
  const result = generateEtherdogConfigs(bus(devices))
  if (result === null) throw new Error('generator returned null')
  const bc = JSON.parse(result.busconfig) as { config: { slaves: { sdo_configurations: IoEntry[] }[] } }[]
  return bc[0]!.config.slaves
}

describe('DOPE-704 E3: PDO-assignment SDO block', () => {
  test('a slave without PdoAssign emits no 0x1C1n writes', () => {
    const slave = configuredSlave({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: false, completeAccess: false },
      },
      rxPdos: [pdo('0x1600')],
      txPdos: [pdo('0x1A00')],
    })
    const [first] = firstBusConfig([slave])
    const assignmentWrites = first!.sdo_configurations.filter(
      (e: IoEntry) => e.index === '0x1C12' || e.index === '0x1C13',
    )
    expect(assignmentWrites).toEqual([])
  })

  test('a slave without coeFlags (pre-E2 schema) emits no 0x1C1n writes', () => {
    const slave = configuredSlave({
      config: createDefaultSlaveConfig(), // no coeFlags
      rxPdos: [pdo('0x1600')],
    })
    const [first] = firstBusConfig([slave])
    expect(first!.sdo_configurations).toEqual([])
  })

  test('Delta multi-mode: 0x1C12 clear / list / count in CODESYS order', () => {
    const slave = configuredSlave({
      rxPdos: [pdo('0x1600', true, 'CSP'), pdo('0x1601', false, 'CSV')],
      txPdos: [pdo('0x1A00', true, 'Status')],
    })
    const [first] = firstBusConfig([slave])
    const rxWrites = first!.sdo_configurations.filter((e: IoEntry) => e.index === '0x1C12')

    expect(rxWrites.length).toBe(3) // clear, 1 assigned, count
    expect(rxWrites[0]).toMatchObject({ index: '0x1C12', subindex: 0, value: 0 })
    expect(rxWrites[1]).toMatchObject({ index: '0x1C12', subindex: 1, value: 0x1600 })
    expect(rxWrites[2]).toMatchObject({ index: '0x1C12', subindex: 0, value: 1 })
  })

  test('multiple assigned PDOs: slots fill in index-sort order', () => {
    const slave = configuredSlave({
      rxPdos: [pdo('0x1601'), pdo('0x1603'), pdo('0x1600')],
    })
    const [first] = firstBusConfig([slave])
    const rxWrites = first!.sdo_configurations.filter((e: IoEntry) => e.index === '0x1C12')
    expect(rxWrites.length).toBe(5) // clear + 3 + count
    expect(rxWrites[1]).toMatchObject({ subindex: 1, value: 0x1600 })
    expect(rxWrites[2]).toMatchObject({ subindex: 2, value: 0x1601 })
    expect(rxWrites[3]).toMatchObject({ subindex: 3, value: 0x1603 })
    expect(rxWrites[4]).toMatchObject({ subindex: 0, value: 3 })
  })

  test('TxPDOs land on 0x1C13 and RxPDOs on 0x1C12, each with its own sequence', () => {
    const slave = configuredSlave({
      rxPdos: [pdo('0x1600')],
      txPdos: [pdo('0x1A00'), pdo('0x1A01')],
    })
    const [first] = firstBusConfig([slave])
    const indices = first!.sdo_configurations.map((e: IoEntry) => e.index)
    // All Rx writes should come before any Tx writes.
    const firstTxIdx = indices.indexOf('0x1C13')
    const lastRxIdx = indices.lastIndexOf('0x1C12')
    expect(lastRxIdx).toBeLessThan(firstTxIdx)

    const txWrites = first!.sdo_configurations.filter((e: IoEntry) => e.index === '0x1C13')
    expect(txWrites.length).toBe(4) // clear + 2 + count
    expect(txWrites[0]).toMatchObject({ subindex: 0, value: 0 })
    expect(txWrites[1]).toMatchObject({ subindex: 1, value: 0x1a00 })
    expect(txWrites[2]).toMatchObject({ subindex: 2, value: 0x1a01 })
    expect(txWrites[3]).toMatchObject({ subindex: 0, value: 2 })
  })

  test('user startup SDOs come first; the PDO-assignment block follows', () => {
    const slave = configuredSlave({
      sdoConfigurations: [
        {
          index: '0x6060',
          subIndex: 0,
          value: '8',
          defaultValue: '0',
          dataType: 'USINT',
          bitLength: 8,
          name: 'Mode',
          objectName: 'Mode of operation',
        },
      ],
      rxPdos: [pdo('0x1600')],
    })
    const [first] = firstBusConfig([slave])
    const seq = first!.sdo_configurations
    expect(seq[0]).toMatchObject({ index: '0x6060', value: 8 })
    expect(seq[1]).toMatchObject({ index: '0x1C12', subindex: 0, value: 0 })
  })

  test('DOPE-657 project: assigned === undefined behaves as every PDO assigned', () => {
    const slave = configuredSlave({
      rxPdos: [pdo('0x1600', undefined), pdo('0x1601', undefined)],
    })
    const [first] = firstBusConfig([slave])
    const rxWrites = first!.sdo_configurations.filter((e: IoEntry) => e.index === '0x1C12')
    expect(rxWrites.length).toBe(4) // clear + 2 + count
    expect(rxWrites[rxWrites.length - 1]).toMatchObject({ subindex: 0, value: 2 })
  })

  test('every PDO unassigned on a given direction emits nothing on that direction', () => {
    const slave = configuredSlave({
      rxPdos: [pdo('0x1600', false), pdo('0x1601', false)],
      txPdos: [pdo('0x1A00')],
    })
    const [first] = firstBusConfig([slave])
    const indices = first!.sdo_configurations.map((e: IoEntry) => e.index)
    expect(indices.includes('0x1C12')).toBe(false)
    expect(indices.includes('0x1C13')).toBe(true)
  })
})
