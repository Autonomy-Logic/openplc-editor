/**
 * Slave-level ESI `<InitCmds>` ordering tests.
 *
 * The generator has to emit the slave's ESI InitCmd writes before any user startup SDO
 * and before the PDO-assignment block, so a drive that needs internal state set first
 * (Delta ASDA-A2-E mode-of-operation, UR20 reset) sees them in that order on the wire.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, SDOConfigurationEntry } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

type Row = { index: string; subindex: number; value: number | string; value_bytes?: string; data_type?: string }

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
    coeFlags: { pdoAssign: true, pdoConfig: false, completeAccess: false },
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

const seq = (devices: ConfiguredEtherCATDevice[]): Row[] => {
  const result = generateEtherdogConfigs(bus(devices))
  if (result === null) throw new Error('generator returned null')
  const bc = JSON.parse(result.busconfig) as { config: { slaves: { sdo_configurations: Row[] }[] } }[]
  return bc[0]!.config.slaves[0]!.sdo_configurations
}

const esiInitCmd = (over: Partial<SDOConfigurationEntry> = {}): SDOConfigurationEntry => ({
  index: '0x6060',
  subIndex: 0,
  value: '8',
  defaultValue: '8',
  dataType: 'USINT',
  bitLength: 8,
  name: 'Mode of operation',
  objectName: 'ESI InitCmd',
  ...over,
})

const userSdo = (over: Partial<SDOConfigurationEntry> = {}): SDOConfigurationEntry => ({
  index: '0x6071',
  subIndex: 0,
  value: '100',
  defaultValue: '0',
  dataType: 'INT',
  bitLength: 16,
  name: 'Target',
  objectName: 'User Target',
  ...over,
})

describe('Slave-level ESI InitCmd ordering', () => {
  test('ESI InitCmd lands before user startup SDOs', () => {
    const slave = configuredSlave({
      esiInitCmdSdos: [esiInitCmd()],
      sdoConfigurations: [userSdo()],
    })
    const s = seq([slave])
    expect(s[0]).toMatchObject({ index: '0x6060', value: 8 })
    expect(s[1]).toMatchObject({ index: '0x6071', value: 100 })
  })

  test('user startup SDOs still land before the PDO-assignment block', () => {
    const slave = configuredSlave({
      esiInitCmdSdos: [esiInitCmd()],
      sdoConfigurations: [userSdo()],
      rxPdos: [{ index: '0x1600', name: 'PDO', entries: [], assigned: true }],
    })
    const s = seq([slave])
    const user = s.findIndex((e) => e.index === '0x6071')
    const assign = s.findIndex((e) => e.index === '0x1C12')
    expect(user).toBeLessThan(assign)
    expect(user).toBeGreaterThan(-1)
    expect(assign).toBeGreaterThan(-1)
  })

  test('byte-string InitCmd routes through value_bytes with OCTET_STRING data type', () => {
    const slave = configuredSlave({
      esiInitCmdSdos: [
        {
          index: '0x8010',
          subIndex: 3,
          value: '',
          defaultValue: '',
          dataType: 'OCTET_STRING',
          bitLength: 80,
          name: 'Module name',
          objectName: 'ESI InitCmd',
          valueBytes: '55523230',
        },
      ],
    })
    const s = seq([slave])
    expect(s[0]).toMatchObject({ index: '0x8010', subindex: 3, data_type: 'OCTET_STRING', value_bytes: '55523230' })
  })

  test('no ESI InitCmd emits nothing extra; existing behaviour is preserved', () => {
    const slave = configuredSlave({
      sdoConfigurations: [userSdo()],
    })
    const s = seq([slave])
    expect(s[0]).toMatchObject({ index: '0x6071', value: 100 })
  })
})
