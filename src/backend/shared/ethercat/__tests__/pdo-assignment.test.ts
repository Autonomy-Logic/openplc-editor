import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ConfiguredEtherCATDevice, ESIPdo } from '@root/middleware/shared/ports/esi-types'
import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { enrichDeviceData, lacksPdoAssignment, recordPdoAssignment } from '../enrich-device-data'
import { assignedPdos, pdoToChannels } from '../esi-parser'
import { parseESIDeviceFull } from '../esi-parser-main'
import { generateEthercatConfig, generateEtherdogConfigs } from '../generate-ethercat-config'
import { validateEthercatConfig } from '../validate-ethercat-config'

const DELTA_ESI = readFileSync(resolve(__dirname, 'fixtures/delta-asda2e.xml'), 'utf-8')

type BusSlave = { tx_pdos: { index: string }[]; rx_pdos: { index: string }[]; channels: { pdo_index: string }[] }
type IoEntry = { slave: number; index: string; subindex: number; iec_location: string }

const deltaDevice = (): ReturnType<typeof parseESIDeviceFull>['device'] => parseESIDeviceFull(DELTA_ESI, 0).device

/** A Delta slave as the editor adds it: enriched from the ESI. */
const configuredDelta = (overrides: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 'delta',
  position: 1,
  name: 'ASDA_A2_E',
  esiDeviceRef: { repositoryItemId: 'repo', deviceIndex: 0 },
  vendorId: '0x000001DD',
  productCode: '0x10305070',
  revisionNo: '0x00000001',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  ...enrichDeviceData(deltaDevice()!),
  ...overrides,
})

const bus = (devices: ConfiguredEtherCATDevice[]): PLCRemoteDevice[] =>
  [
    {
      name: 'bus_a',
      protocol: 'ethercat',
      ethercatConfig: { masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 }, devices },
    },
  ] as unknown as PLCRemoteDevice[]

const pdo = (index: string, extra: Partial<ESIPdo> = {}): ESIPdo => ({
  index,
  name: index,
  fixed: false,
  mandatory: false,
  entries: [],
  ...extra,
})

describe('PDO assignment', () => {
  describe('assignedPdos', () => {
    it('keeps the PDOs the ESI places in a sync manager or marks mandatory', () => {
      const pdos = [pdo('#x1A00'), pdo('#x1A01', { smIndex: 3 }), pdo('#x1A02', { mandatory: true }), pdo('#x1A03')]
      expect(assignedPdos(pdos).map((p) => p.index)).toEqual(['#x1A01', '#x1A02'])
    })

    it('takes every PDO as assigned when the ESI marks none', () => {
      const pdos = [pdo('#x1A00'), pdo('#x1A01')]
      expect(assignedPdos(pdos)).toEqual(pdos)
    })
  })

  describe('Delta ASDA-A2-E, whose ESI declares four alternative PDOs per direction', () => {
    it('derives channels only from the default assignment, 0x1601 and 0x1A01', () => {
      const pdoIndices = new Set(pdoToChannels(deltaDevice()!).map((ch) => ch.pdoIndex.toLowerCase()))
      expect([...pdoIndices].sort()).toEqual(['0x1601', '0x1a01'])
    })

    it('keeps every PDO in the project, flagging which are assigned', () => {
      const device = configuredDelta()
      expect(device.txPdos?.map((p) => [p.index.toLowerCase(), p.assigned])).toEqual([
        ['0x1a00', false],
        ['0x1a01', true],
        ['0x1a02', false],
        ['0x1a03', false],
      ])
      expect(device.rxPdos?.filter((p) => p.assigned).map((p) => p.index.toLowerCase())).toEqual(['0x1601'])
    })

    it('builds for EtherDOG runtimes through the real path, with one mapping per entry', () => {
      const split = generateEtherdogConfigs(bus([configuredDelta()]))!
      expect(validateEthercatConfig(split.busconfig, split.iomapping)).toEqual([])

      const slave = (JSON.parse(split.busconfig) as { config: { slaves: BusSlave[] } }[])[0].config.slaves[0]
      expect(slave.tx_pdos.map((p) => p.index.toLowerCase())).toEqual(['0x1a01'])
      expect(slave.rx_pdos.map((p) => p.index.toLowerCase())).toEqual(['0x1601'])
      expect(new Set(slave.channels.map((ch) => ch.pdo_index.toLowerCase()))).toEqual(new Set(['0x1601', '0x1a01']))

      const entries = (JSON.parse(split.iomapping) as { masters: { entries: IoEntry[] }[] }).masters[0].entries
      const keys = entries.map((e) => `${e.slave}:${e.index}:${e.subindex}`)
      expect(new Set(keys).size).toBe(keys.length)
      expect(entries.length).toBe(slave.channels.length)
    })

    it('builds in the legacy format with the same assigned PDOs', () => {
      const legacy = generateEthercatConfig(bus([configuredDelta()]))!
      expect(validateEthercatConfig(legacy)).toEqual([])
      const slave = (JSON.parse(legacy) as { config: { slaves: BusSlave[] } }[])[0].config.slaves[0]
      expect(slave.tx_pdos.map((p) => p.index.toLowerCase())).toEqual(['0x1a01'])
    })
  })

  describe('projects saved before the assignment was recorded', () => {
    /** The Delta as saved before: every PDO and channel, every channel mapped, no `assigned`. */
    const savedBefore = (): ConfiguredEtherCATDevice => {
      const esi = deltaDevice()!
      const all = { ...esi, txPdo: esi.txPdo.map((p) => ({ ...p, mandatory: true })) }
      const allRx = { ...all, rxPdo: all.rxPdo.map((p) => ({ ...p, mandatory: true })) }
      const enriched = enrichDeviceData(allRx)
      const strip = (pdos: ConfiguredEtherCATDevice['txPdos']) => pdos?.map(({ assigned: _a, ...rest }) => rest)
      return configuredDelta({
        ...enriched,
        txPdos: strip(enriched.txPdos),
        rxPdos: strip(enriched.rxPdos),
      })
    }

    it('are recognised as lacking the assignment', () => {
      expect(lacksPdoAssignment(savedBefore())).toBe(true)
      expect(lacksPdoAssignment(configuredDelta())).toBe(false)
      expect(lacksPdoAssignment(configuredDelta({ txPdos: [], rxPdos: [] }))).toBe(false)
    })

    it('fail the EtherDOG build with a message that says how to fix them', () => {
      const split = generateEtherdogConfigs(bus([savedBefore()]))!
      const errors = validateEthercatConfig(split.busconfig, split.iomapping)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain('mapped twice')
      expect(errors[0]).toContain('open the slave in the EtherCAT editor to record which one is assigned')
    })

    it('are migrated keeping the addresses of the channels that remain', () => {
      const before = savedBefore()
      const migrated = { ...before, ...recordPdoAssignment(before, deltaDevice()!) }

      const remaining = new Set(migrated.channelInfo?.map((ch) => ch.channelId))
      const kept = before.channelMappings.filter((m) => remaining.has(m.channelId))
      expect(migrated.channelMappings).toEqual(kept)
      expect(kept.length).toBeGreaterThan(0)
      expect(lacksPdoAssignment(migrated)).toBe(false)

      const split = generateEtherdogConfigs(bus([migrated]))!
      expect(validateEthercatConfig(split.busconfig, split.iomapping)).toEqual([])
    })
  })
})
