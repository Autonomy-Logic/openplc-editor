/**
 * DOPE-704 E2 schema tests.
 *
 * Exercise the PDO assignment + CoE flags data model and the one-pass migration from
 * the pre-E2 (DOPE-657) schema. The fixtures are synthetic — real-hardware fixtures live
 * under __tests__/fixtures and are already exercised by the existing suites.
 */

import type { ConfiguredEtherCATDevice, ESIDevice, ESIPdo, PersistedPdo } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { deriveCoEFlags, lacksE2Schema, migrateSlaveToE2Schema, persistPdos } from '../enrich-device-data'

const esiPdo = (over: Partial<ESIPdo> & { index: string }): ESIPdo => ({
  name: over.index,
  fixed: false,
  mandatory: false,
  entries: [],
  ...over,
})

const esiDevice = (over: Partial<ESIDevice> = {}): ESIDevice => ({
  type: { productCode: '0x0', revisionNo: '0x0', name: 'Test' },
  name: 'Test',
  fmmu: [],
  syncManagers: [],
  rxPdo: [],
  txPdo: [],
  ...over,
})

const configuredDevice = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 'd',
  name: 'd',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x0',
  productCode: '0x0',
  revisionNo: '0x0',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings: [],
  ...over,
})

describe('DOPE-704 E2: persistPdos carries ESI defaults forward', () => {
  test('fixed / mandatory / sm / exclude land on persisted PDOs when the ESI declares them', () => {
    const pdos = persistPdos([
      esiPdo({ index: '0x1600', fixed: true, mandatory: true, smIndex: 2, exclude: ['0x1601', '0x1602'] }),
      esiPdo({ index: '0x1601', smIndex: 2, exclude: ['0x1600'] }),
    ])

    expect(pdos[0]).toMatchObject({
      index: '0x1600',
      fixed: true,
      mandatory: true,
      sm: 2,
      exclude: ['0x1601', '0x1602'],
    })
    expect(pdos[1]).toMatchObject({ index: '0x1601', sm: 2, exclude: ['0x1600'] })
    expect(pdos[1]?.fixed).toBeUndefined()
    expect(pdos[1]?.mandatory).toBeUndefined()
  })

  test('absent ESI defaults do not land on persisted PDOs', () => {
    const pdos = persistPdos([esiPdo({ index: '0x1A00' })])
    expect(pdos[0]?.fixed).toBeUndefined()
    expect(pdos[0]?.mandatory).toBeUndefined()
    expect(pdos[0]?.sm).toBeUndefined()
    expect(pdos[0]?.exclude).toBeUndefined()
  })
})

describe('DOPE-704 E2: deriveCoEFlags defaults from the ESI', () => {
  test('reads the device coeFlags when present', () => {
    const device = esiDevice({ coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false } })
    expect(deriveCoEFlags(device)).toEqual({ pdoAssign: true, pdoConfig: true, completeAccess: false })
  })

  test('defaults to all-false when the ESI omits the CoE block', () => {
    expect(deriveCoEFlags(esiDevice())).toEqual({ pdoAssign: false, pdoConfig: false, completeAccess: false })
  })
})

describe('DOPE-704 E2: lacksE2Schema detects pre-E2 projects', () => {
  test('fresh ConfiguredEtherCATDevice (DOPE-657 era) lacks the schema', () => {
    const dev = configuredDevice({
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true }],
    })
    expect(lacksE2Schema(dev)).toBe(true)
  })

  test('a device with coeFlags populated is up to date', () => {
    const dev = configuredDevice({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false },
      },
    })
    expect(lacksE2Schema(dev)).toBe(false)
  })

  test('a device whose PDOs carry fixed/mandatory/exclude is up to date', () => {
    const dev = configuredDevice({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: false, completeAccess: false },
      },
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true, fixed: true }],
    })
    expect(lacksE2Schema(dev)).toBe(false)
  })
})

describe('DOPE-704 E2: migrateSlaveToE2Schema', () => {
  test('fills coeFlags from the ESI and preserves the user data', () => {
    const dev = configuredDevice({
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true }],
      channelMappings: [{ channelId: 'ch1', iecLocation: '%IX0.0', alias: 'MyAlias' }],
    })
    const esi = esiDevice({
      coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false },
      rxPdo: [esiPdo({ index: '0x1600', fixed: true, mandatory: true, smIndex: 2 })],
    })

    const migrated = migrateSlaveToE2Schema(dev, esi)

    expect(migrated.config.coeFlags).toEqual({ pdoAssign: true, pdoConfig: true, completeAccess: false })
    expect(migrated.rxPdos?.[0]).toMatchObject({
      index: '0x1600',
      assigned: true,
      fixed: true,
      mandatory: true,
      sm: 2,
    })
    // User data preserved verbatim.
    expect(migrated.channelMappings).toEqual([{ channelId: 'ch1', iecLocation: '%IX0.0', alias: 'MyAlias' }])
  })

  test('merges exclude lists from the ESI onto saved PDOs', () => {
    const dev = configuredDevice({
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true }],
    })
    const esi = esiDevice({
      rxPdo: [esiPdo({ index: '0x1600', exclude: ['0x1601'] })],
    })
    expect(migrateSlaveToE2Schema(dev, esi).rxPdos?.[0]?.exclude).toEqual(['0x1601'])
  })

  test('is idempotent: second migration leaves the slave unchanged', () => {
    const esi = esiDevice({
      coeFlags: { pdoAssign: true, pdoConfig: false, completeAccess: true },
      rxPdo: [esiPdo({ index: '0x1600', fixed: true })],
    })
    const dev = configuredDevice({
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true }],
    })
    const once = migrateSlaveToE2Schema(dev, esi)
    const twice = migrateSlaveToE2Schema(once, esi)
    expect(twice).toEqual(once)
  })

  test('user-set CoE flags are not overwritten by the ESI defaults', () => {
    const dev = configuredDevice({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: false, completeAccess: false }, // user Expert choice
      },
    })
    const esi = esiDevice({ coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: true } })
    const migrated = migrateSlaveToE2Schema(dev, esi)
    expect(migrated.config.coeFlags).toEqual({ pdoAssign: false, pdoConfig: false, completeAccess: false })
  })

  test('a PDO absent from the ESI is kept verbatim (projects targeting a replaced ESI)', () => {
    const dev = configuredDevice({
      rxPdos: [{ index: '0x1600', name: 'r', entries: [], assigned: true }],
    })
    const esi = esiDevice({ rxPdo: [] })
    const migrated = migrateSlaveToE2Schema(dev, esi)
    expect(migrated.rxPdos?.[0]).toEqual({ index: '0x1600', name: 'r', entries: [], assigned: true })
  })
})
