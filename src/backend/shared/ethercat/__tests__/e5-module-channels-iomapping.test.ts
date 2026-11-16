/**
 * Module-channel iomapping tests.
 *
 * A modular coupler's module channels must land in the busconfig channels array and in
 * the iomapping document, so a program that reads a module's input / writes a module's
 * output through its IEC address actually sees the data on the wire.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  PersistedChannelInfo,
} from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

const configuredSlave = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 's',
  position: 1,
  name: 'ur20_coupler',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x1',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: {
    ...createDefaultSlaveConfig(),
    coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: false },
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

type BusChannel = { name: string; pdo_index: string; pdo_entry_index: string; pdo_entry_subindex: number }
type BusSlave = { channels: BusChannel[] }
type IoRow = { slave: number; index: string; subindex: number; iec_location: string }

const parse = (devices: ConfiguredEtherCATDevice[]) => {
  const result = generateEtherdogConfigs(bus(devices))
  if (result === null) throw new Error('generator returned null')
  const busconfig = JSON.parse(result.busconfig) as { config: { slaves: BusSlave[] } }[]
  const iomapping = JSON.parse(result.iomapping) as { version: number; masters: { name: string; entries: IoRow[] }[] }
  return { busconfig, iomapping }
}

const digitalInputModuleChannel = (slot: number, suffix: string): PersistedChannelInfo => ({
  channelId: `0x1A0${slot}-0x6000-0x0${slot}`,
  name: `DI-${slot}-${suffix}`,
  direction: 'input',
  pdoIndex: `0x1A0${slot}`,
  entryIndex: '0x6000',
  entrySubIndex: `0x0${slot}`,
  dataType: 'BOOL',
  bitLen: 1,
  iecType: 'BOOL',
})

describe('Module channels appear in busconfig channels and iomapping', () => {
  test('each module channel with an iecLocation produces an iomapping entry', () => {
    const module: ConfiguredEtherCATModule = {
      id: 'slot-1',
      slot: 1,
      name: 'UR20-4DI-P',
      ident: '0x00001a0f',
      esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x00001a0f' },
      channelInfo: [digitalInputModuleChannel(1, 'A'), digitalInputModuleChannel(1, 'B')],
      channelMappings: [
        { channelId: '0x1A01-0x6000-0x01', iecLocation: '%IX8.0', alias: 'DI1_A' },
        { channelId: '0x1A01-0x6000-0x01', iecLocation: '%IX8.1', alias: 'DI1_B' },
      ],
    }
    // Fix channelMappings to match two unique channel ids
    module.channelInfo = [digitalInputModuleChannel(1, 'A'), digitalInputModuleChannel(2, 'B')]
    module.channelMappings = [
      { channelId: '0x1A01-0x6000-0x01', iecLocation: '%IX8.0', alias: 'DI1_A' },
      { channelId: '0x1A02-0x6000-0x02', iecLocation: '%IX8.1', alias: 'DI1_B' },
    ]
    const slave = configuredSlave({ modules: [module] })
    const { busconfig, iomapping } = parse([slave])

    const channels = busconfig[0]!.config.slaves[0]!.channels
    expect(channels.map((c) => c.name)).toEqual(['DI-1-A', 'DI-2-B'])

    const master = iomapping.masters[0]!
    expect(master.entries.length).toBe(2)
    expect(master.entries).toContainEqual({ slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX8.0' })
    expect(master.entries).toContainEqual({ slave: 1, index: '0x6000', subindex: 2, iec_location: '%IX8.1' })
  })

  test('a module with no channelInfo derives channels from its persisted PDOs', () => {
    const module: ConfiguredEtherCATModule = {
      id: 'slot-1',
      slot: 1,
      name: 'UR20-4DI-P',
      ident: '0x00001a0f',
      esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x00001a0f' },
      channelMappings: [{ channelId: '0x1A00-0x6000-0x01', iecLocation: '%IX8.0', alias: '' }],
      txPdos: [
        {
          index: '0x1A00',
          name: 'DI PDO',
          assigned: true,
          entries: [{ index: '0x6000', subIndex: '0x01', bitLen: 1, name: 'Input 1', dataType: 'BOOL' }],
        },
      ],
    }
    const slave = configuredSlave({ modules: [module] })
    const { busconfig, iomapping } = parse([slave])
    const channels = busconfig[0]!.config.slaves[0]!.channels
    expect(channels.length).toBe(1)
    expect(channels[0]!.name).toBe('Input 1')
    expect(iomapping.masters[0]!.entries[0]!.iec_location).toBe('%IX8.0')
  })

  test('a slave with no modules behaves as before (no module channels appended)', () => {
    const slave = configuredSlave({
      channelInfo: [
        {
          channelId: 'own-ch',
          name: 'Own',
          direction: 'input',
          pdoIndex: '0x1A00',
          entryIndex: '0x6000',
          entrySubIndex: '0x01',
          dataType: 'BOOL',
          bitLen: 1,
          iecType: 'BOOL',
        },
      ],
      channelMappings: [{ channelId: 'own-ch', iecLocation: '%IX0.0', alias: '' }],
    })
    const { busconfig, iomapping } = parse([slave])
    const channels = busconfig[0]!.config.slaves[0]!.channels
    expect(channels.map((c) => c.name)).toEqual(['Own'])
    expect(iomapping.masters[0]!.entries.length).toBe(1)
  })

  test("module channels follow the slave's own channels", () => {
    const module: ConfiguredEtherCATModule = {
      id: 'slot-1',
      slot: 1,
      name: 'UR20-4DI-P',
      ident: '0x00001a0f',
      esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x00001a0f' },
      channelInfo: [digitalInputModuleChannel(1, 'Mod')],
      channelMappings: [{ channelId: '0x1A01-0x6000-0x01', iecLocation: '%IX8.0', alias: '' }],
    }
    const slave = configuredSlave({
      channelInfo: [
        {
          channelId: 'own-ch',
          name: 'OwnFirst',
          direction: 'input',
          pdoIndex: '0x1A00',
          entryIndex: '0x6000',
          entrySubIndex: '0x00',
          dataType: 'BOOL',
          bitLen: 1,
          iecType: 'BOOL',
        },
      ],
      channelMappings: [{ channelId: 'own-ch', iecLocation: '%IX0.0', alias: '' }],
      modules: [module],
    })
    const { busconfig } = parse([slave])
    const channels = busconfig[0]!.config.slaves[0]!.channels
    expect(channels.map((c) => c.name)).toEqual(['OwnFirst', 'DI-1-Mod'])
  })
})
