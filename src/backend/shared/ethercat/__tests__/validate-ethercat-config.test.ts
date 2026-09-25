import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { pdoToChannels } from '../esi-parser'
import { parseESIDeviceFull } from '../esi-parser-main'
import { ETHERDOG_LIMITS, validateEthercatConfig } from '../validate-ethercat-config'

const DELTA_ESI = readFileSync(resolve(__dirname, 'fixtures/delta-asda2e.xml'), 'utf-8')

const makeMaster = (name: string, networkInterface: string) => ({
  name,
  protocol: 'ETHERCAT',
  config: {
    master: {
      interface: networkInterface,
      cycle_time_us: 1000,
      watchdog_timeout_cycles: 3,
    },
    slaves: [],
    diagnostics: {
      log_connections: true,
      log_data_access: false,
      log_errors: true,
      max_log_entries: 10000,
      status_update_interval_ms: 500,
    },
  },
})

const toJson = (entries: unknown[]) => JSON.stringify(entries, null, 2)

describe('validateEthercatConfig', () => {
  describe('no-op cases', () => {
    it('returns no errors when configJson is null (no EtherCAT masters generated)', () => {
      expect(validateEthercatConfig(null)).toEqual([])
    })

    it('returns no errors when configJson is an empty string', () => {
      expect(validateEthercatConfig('')).toEqual([])
    })

    it('returns no errors for an empty entries array', () => {
      expect(validateEthercatConfig(toJson([]))).toEqual([])
    })
  })

  describe('happy path', () => {
    it('returns no errors for a single master', () => {
      expect(validateEthercatConfig(toJson([makeMaster('master_a', 'eth0')]))).toEqual([])
    })

    it('returns no errors for multiple masters with distinct interfaces', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth1'),
        makeMaster('master_c', 'enp3s0'),
      ])
      expect(validateEthercatConfig(json)).toEqual([])
    })
  })

  describe('unique-interface validation', () => {
    it('returns an error when two masters share the same interface', () => {
      const json = toJson([makeMaster('master_a', 'eth0'), makeMaster('master_b', 'eth0')])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain("'eth0'")
      expect(errors[0]).toContain('master_a')
      expect(errors[0]).toContain('master_b')
    })

    it('reports each duplicate group once when three masters share an interface', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth0'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('master_a')
      expect(errors[0]).toContain('master_b')
      expect(errors[0]).toContain('master_c')
    })

    it('reports multiple duplicate groups separately', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth1'),
        makeMaster('master_d', 'eth1'),
        makeMaster('master_e', 'eth2'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(2)
      const joined = errors.join(' | ')
      expect(joined).toContain("'eth0'")
      expect(joined).toContain("'eth1'")
      expect(joined).not.toContain("'eth2'")
    })

    it('does not flag a unique interface that appears alongside duplicates', () => {
      const json = toJson([
        makeMaster('master_a', 'eth0'),
        makeMaster('master_b', 'eth0'),
        makeMaster('master_c', 'eth1'),
      ])
      const errors = validateEthercatConfig(json)
      expect(errors).toHaveLength(1)
      expect(errors[0]).not.toContain("'eth1'")
    })

    it('uses a placeholder name for unnamed masters', () => {
      const json = toJson([makeMaster('', 'eth0'), makeMaster('', 'eth0')])
      const errors = validateEthercatConfig(json)
      expect(errors[0]).toContain('<unnamed master>')
    })
  })

  describe('malformed input', () => {
    it('returns an error when the JSON is unparseable', () => {
      const errors = validateEthercatConfig('{not json')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('Failed to parse')
    })

    it('returns an error when the parsed value is not an array', () => {
      const errors = validateEthercatConfig('{"foo": "bar"}')
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('not an array')
    })
  })

  describe('I/O mapping validation', () => {
    const withSlaves = (name: string, networkInterface: string, slaves: unknown[]) => {
      const entry = makeMaster(name, networkInterface)
      return { ...entry, config: { ...entry.config, slaves } }
    }
    const slave = (position: number, keys: [string, number][]) => ({
      position,
      channels: keys.map(([index, subindex]) => ({ pdo_entry_index: index, pdo_entry_subindex: subindex })),
    })
    const bus = toJson([
      withSlaves('bus_a', 'eth0', [slave(1, [['0x6000', 1]]), slave(2, [['0x7000', 1]])]),
      withSlaves('bus_b', 'eth1', [slave(1, [['0x6000', 1]])]),
    ])
    const mapping = (masters: unknown[]) => JSON.stringify({ version: 1, masters })

    it('returns no errors when every entry resolves to one channel', () => {
      const io = mapping([
        {
          name: 'bus_a',
          entries: [
            { slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX0.0' },
            { slave: 2, index: '0x7000', subindex: 1, iec_location: '%QX0.0' },
          ],
        },
        { name: 'bus_b', entries: [] },
      ])
      expect(validateEthercatConfig(bus, io)).toEqual([])
    })

    it('reports an entry that matches no channel', () => {
      const io = mapping([
        { name: 'bus_a', entries: [{ slave: 3, index: '0x6000', subindex: 1, iec_location: '%IX0.0' }] },
        { name: 'bus_b', entries: [] },
      ])
      const errors = validateEthercatConfig(bus, io)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('%IX0.0')
      expect(errors[0]).toContain('has no matching channel')
    })

    it('accepts an entry that appears in several alternative PDOs', () => {
      const alt = toJson([
        withSlaves('bus_a', 'eth0', [
          slave(1, [
            ['0x6000', 1],
            ['0x6000', 1],
          ]),
        ]),
      ])
      const io = mapping([
        { name: 'bus_a', entries: [{ slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX0.0' }] },
      ])
      expect(validateEthercatConfig(alt, io)).toEqual([])
    })

    it('accepts the Delta ASDA-A2-E statusword, which four exclusive TxPDOs declare', () => {
      const parsed = parseESIDeviceFull(DELTA_ESI, 0)
      const channels = pdoToChannels(parsed.device!).filter((ch) => ch.entryIndex.toLowerCase() === '0x6041')
      expect(new Set(channels.map((ch) => ch.pdoIndex)).size).toBe(4)
      const deltaBus = toJson([
        withSlaves('bus_a', 'eth0', [
          {
            position: 1,
            channels: channels.map((ch) => ({
              pdo_entry_index: ch.entryIndex,
              pdo_entry_subindex: parseInt(ch.entrySubIndex.replace(/^#x/i, '0x'), 16),
            })),
          },
        ]),
      ])
      const io = mapping([
        { name: 'bus_a', entries: [{ slave: 1, index: channels[0].entryIndex, subindex: 0, iec_location: '%IW0' }] },
      ])
      expect(validateEthercatConfig(deltaBus, io)).toEqual([])
    })

    it('reports a process data entry mapped to two locations', () => {
      const io = mapping([
        {
          name: 'bus_a',
          entries: [
            { slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX0.0' },
            { slave: 1, index: '0x6000', subindex: 1, iec_location: '%IX0.1' },
          ],
        },
        { name: 'bus_b', entries: [] },
      ])
      const errors = validateEthercatConfig(bus, io)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('mapped twice: %IX0.0 and %IX0.1')
    })

    it('resolves entries only inside their own master', () => {
      const io = mapping([
        { name: 'bus_a', entries: [] },
        { name: 'bus_b', entries: [{ slave: 2, index: '0x7000', subindex: 1, iec_location: '%QX0.0' }] },
      ])
      expect(validateEthercatConfig(bus, io)).toHaveLength(1)
    })

    it('reports a master count or name that does not match the bus configuration', () => {
      expect(validateEthercatConfig(bus, mapping([{ name: 'bus_a', entries: [] }]))[0]).toContain('1 master(s)')
      const renamed = mapping([
        { name: 'bus_b', entries: [] },
        { name: 'bus_a', entries: [] },
      ])
      expect(validateEthercatConfig(bus, renamed)[0]).toContain("is 'bus_b'")
    })

    it('reports an unparseable or shapeless I/O mapping', () => {
      expect(validateEthercatConfig(bus, '{not json')[0]).toContain('Failed to parse generated EtherCAT I/O mapping')
      expect(validateEthercatConfig(bus, '{}')[0]).toContain('no masters array')
    })

    it('reports an I/O mapping without a bus configuration', () => {
      expect(validateEthercatConfig(null, mapping([]))).toHaveLength(1)
    })
  })
  describe('runtime limits (EtherDOG runtimes)', () => {
    const L = ETHERDOG_LIMITS
    const pdo = (index: string, entries: number) => ({ index, entries: Array.from({ length: entries }, () => ({})) })
    const busWith = (slave: Record<string, unknown>, masters = 1) =>
      toJson(
        Array.from({ length: masters }, (_, m) => {
          const entry = makeMaster(`bus_${m}`, `eth${m}`)
          return { ...entry, config: { ...entry.config, slaves: m === 0 ? [{ position: 1, ...slave }] : [] } }
        }),
      )
    const mapWith = (entries: { iec_location: string }[], masters = 1) =>
      JSON.stringify({
        version: 1,
        masters: Array.from({ length: masters }, (_, m) => ({
          name: `bus_${m}`,
          entries:
            m === 0
              ? entries.map((e, i) => ({ slave: 1, index: '0x6000', subindex: i % 256, iec_location: e.iec_location }))
              : [],
        })),
      })
    const channels = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ pdo_entry_index: '0x6000', pdo_entry_subindex: i % 256 }))
    const limitErrors = (bus: string, io: string) =>
      validateEthercatConfig(bus, io).filter(
        (e) => e.includes('at most') || e.includes('IEC location') || e.includes('beyond'),
      )

    it('accepts a project at every limit', () => {
      const bus = busWith({
        channels: channels(L.channelsPerSlave),
        rx_pdos: Array.from({ length: L.pdosPerDirection }, (_, i) => pdo(`0x16${i}`, L.entriesPerPdo)),
        sdo_configurations: Array.from({ length: L.sdosPerSlave }, () => ({})),
      })
      const io = mapWith([{ iec_location: '%IW65535' }, { iec_location: '%QX65535.7' }])
      expect(limitErrors(bus, io)).toEqual([])
    })

    it('reports too many masters, slaves, PDOs, PDO entries, channels and SDOs', () => {
      expect(limitErrors(busWith({}, L.masters + 1), mapWith([], L.masters + 1))).toHaveLength(1)
      const big = toJson([
        {
          ...makeMaster('bus_0', 'eth0'),
          config: {
            ...makeMaster('bus_0', 'eth0').config,
            slaves: Array.from({ length: L.slavesPerMaster + 1 }, (_, i) => ({ position: i + 1 })),
          },
        },
      ])
      expect(limitErrors(big, mapWith([]))[0]).toContain(`${L.slavesPerMaster + 1} slaves`)
      const slave = busWith({
        channels: channels(L.channelsPerSlave + 1),
        tx_pdos: [
          ...Array.from({ length: L.pdosPerDirection }, (_, i) => pdo(`0x1A${i}`, 1)),
          pdo('0x1AFF', L.entriesPerPdo + 1),
        ],
        sdo_configurations: Array.from({ length: L.sdosPerSlave + 1 }, () => ({})),
      })
      const errors = limitErrors(slave, mapWith([]))
      expect(errors).toHaveLength(4)
      expect(errors.join('\n')).toContain('TxPDOs')
      expect(errors.join('\n')).toContain('PDO 0x1AFF has 33 entries')
    })

    it('reports more mapped entries than a master supports', () => {
      const io = mapWith(Array.from({ length: L.mappedEntriesPerMaster + 1 }, (_, i) => ({ iec_location: `%IW${i}` })))
      expect(limitErrors(busWith({}), io)[0]).toContain(`maps ${L.mappedEntriesPerMaster + 1} entries`)
    })

    it('reports IEC locations the runtime cannot hold', () => {
      const io = mapWith([
        { iec_location: '%IW65536' },
        { iec_location: '%QX1.8' },
        { iec_location: '%IX0000000000000001.0' },
      ])
      expect(limitErrors(busWith({}), io)).toHaveLength(3)
    })

    it('reports a master name longer than the runtime keeps', () => {
      const name = 'm'.repeat(L.nameLength + 1)
      const bus = toJson([makeMaster(name, 'eth0')])
      const io = JSON.stringify({ version: 1, masters: [{ name, entries: [] }] })
      expect(validateEthercatConfig(bus, io).some((e) => e.includes('longer than 63'))).toBe(true)
    })

    it('does not apply to the legacy format', () => {
      expect(validateEthercatConfig(busWith({}, L.masters + 1))).toEqual([])
    })
  })
})
