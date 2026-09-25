import type { ConfiguredEtherCATDevice, PersistedChannelInfo } from '@root/middleware/shared/ports/esi-types'
import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEthercatConfig, generateEtherdogConfigs } from '../generate-ethercat-config'
import { validateEthercatConfig } from '../validate-ethercat-config'

type Channel = Record<string, unknown> & { pdo_entry_index: string; pdo_entry_subindex: number }
type Slave = { position: number; channels: Channel[] }
type RootEntry = { name: string; config: { slaves: Slave[] } }
type IoMapping = {
  version: number
  masters: { name: string; entries: { slave: number; index: string; subindex: number; iec_location: string }[] }[]
}

const channel = (
  channelId: string,
  direction: 'input' | 'output',
  entryIndex: string,
  entrySubIndex: string,
): PersistedChannelInfo => ({
  channelId,
  name: channelId,
  direction,
  pdoIndex: direction === 'input' ? '0x1A00' : '0x1600',
  entryIndex,
  entrySubIndex,
  dataType: 'BOOL',
  bitLen: 1,
  iecType: 'BOOL',
})

const device = (
  name: string,
  position: number | undefined,
  channelInfo: PersistedChannelInfo[],
  channelMappings: { channelId: string; iecLocation: string }[],
): ConfiguredEtherCATDevice => ({
  id: name,
  position,
  name,
  esiDeviceRef: { repositoryItemId: 'repo', deviceIndex: 0 },
  vendorId: '0x00000002',
  productCode: '0x03EC3052',
  revisionNo: '0x00120000',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings,
  channelInfo,
  slaveType: 'digital_input',
})

const master = (name: string, networkInterface: string, devices: ConfiguredEtherCATDevice[], enabled = true) =>
  ({
    name,
    protocol: 'ethercat',
    ethercatConfig: {
      masterConfig: { enabled, networkInterface, cycleTimeUs: 1000 },
      devices,
    },
  }) as unknown as PLCRemoteDevice

// Two masters; mapped, empty-mapped and unmapped channels; a defaulted position.
const fixture = (): PLCRemoteDevice[] => [
  master('bus_a', 'eth0', [
    device(
      'EL1002',
      1,
      [channel('in0', 'input', '0x6000', '0x01'), channel('in1', 'input', '0x6010', '0x01')],
      [
        { channelId: 'in0', iecLocation: '%IX0.0' },
        { channelId: 'in1', iecLocation: '' },
      ],
    ),
    device(
      'EL2002',
      undefined,
      [channel('out0', 'output', '0x7000', '0x01'), channel('out1', 'output', '0x7010', '0x01')],
      [{ channelId: 'out1', iecLocation: '%QX0.1' }],
    ),
  ]),
  master('bus_disabled', 'eth2', [device('EL1002', 1, [channel('in0', 'input', '0x6000', '0x01')], [])], false),
  master('bus_empty', 'eth3', []),
  master('bus_b', 'eth1', [
    device('EL1002', 5, [channel('in0', 'input', '0x6000', '0x01')], [{ channelId: 'in0', iecLocation: '%IX1.0' }]),
  ]),
]

const channelKey = (slave: number, index: string, subindex: number) => `${slave}:${index}:${subindex}`

describe('generateEthercatConfig (legacy conf/ethercat.json)', () => {
  it('returns null when there is no enabled EtherCAT master with slaves', () => {
    expect(generateEthercatConfig(undefined)).toBeNull()
    expect(generateEthercatConfig([])).toBeNull()
    expect(generateEthercatConfig([master('bus_empty', 'eth0', [])])).toBeNull()
  })

  it('keeps iec_location on every channel, empty when unmapped', () => {
    const entries = JSON.parse(generateEthercatConfig(fixture())!) as RootEntry[]
    expect(entries.map((e) => e.name)).toEqual(['bus_a', 'bus_b'])
    const locations = entries.flatMap((e) => e.config.slaves.flatMap((s) => s.channels.map((c) => c.iec_location)))
    expect(locations).toEqual(['%IX0.0', '', '', '%QX0.1', '%IX1.0'])
  })
})

describe('generateEtherdogConfigs (busconfig + iomapping)', () => {
  it('returns null when there is no enabled EtherCAT master with slaves', () => {
    expect(generateEtherdogConfigs(undefined)).toBeNull()
    expect(generateEtherdogConfigs([])).toBeNull()
    expect(generateEtherdogConfigs([master('bus_empty', 'eth0', [])])).toBeNull()
  })

  it('writes no iec_location into the busconfig and keeps every other channel field', () => {
    const { busconfig } = generateEtherdogConfigs(fixture())!
    expect(busconfig).not.toContain('iec_location')
    const entries = JSON.parse(busconfig) as RootEntry[]
    expect(Object.keys(entries[0].config.slaves[0].channels[0])).toEqual([
      'index',
      'name',
      'type',
      'bit_length',
      'pdo_index',
      'pdo_entry_index',
      'pdo_entry_subindex',
    ])
  })

  it('emits one master per busconfig entry, same order and name, with entries only for mapped channels', () => {
    const configs = generateEtherdogConfigs(fixture())!
    const bus = JSON.parse(configs.busconfig) as RootEntry[]
    const mapping = JSON.parse(configs.iomapping) as IoMapping
    expect(mapping).toEqual({
      version: 1,
      masters: [
        {
          name: 'bus_a',
          entries: [
            { slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX0.0' },
            { slave: 2, index: '0x7010', subindex: 1, iec_location: '%QX0.1' },
          ],
        },
        { name: 'bus_b', entries: [{ slave: 5, index: '0x6000', subindex: 1, iec_location: '%IX1.0' }] },
      ],
    })
    expect(mapping.masters.map((m) => m.name)).toEqual(bus.map((e) => e.name))
  })

  it('round-trips: re-merging iec_location into the busconfig reproduces the legacy file', () => {
    const legacy = JSON.parse(generateEthercatConfig(fixture())!) as RootEntry[]
    const configs = generateEtherdogConfigs(fixture())!
    const bus = JSON.parse(configs.busconfig) as RootEntry[]
    const mapping = JSON.parse(configs.iomapping) as IoMapping

    const merged = bus.map((entry, i) => {
      const locations = new Map(
        mapping.masters[i].entries.map((e) => [channelKey(e.slave, e.index, e.subindex), e.iec_location]),
      )
      return {
        ...entry,
        config: {
          ...entry.config,
          slaves: entry.config.slaves.map((slave) => ({
            ...slave,
            channels: slave.channels.map((ch) => ({
              ...ch,
              iec_location: locations.get(channelKey(slave.position, ch.pdo_entry_index, ch.pdo_entry_subindex)) ?? '',
            })),
          })),
        },
      }
    })

    expect(merged).toEqual(legacy)
  })

  it('produces a pair that passes validateEthercatConfig', () => {
    const { busconfig, iomapping } = generateEtherdogConfigs(fixture())!
    expect(validateEthercatConfig(busconfig, iomapping)).toEqual([])
  })
})
