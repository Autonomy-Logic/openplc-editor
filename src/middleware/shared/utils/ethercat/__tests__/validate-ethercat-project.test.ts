/**
 * Project-level validator tests covering the BR21 invariants:
 *   1. Mandatory PDO unassigned
 *   2. Fixed PDO deselected
 *   3. Unresolved exclusion
 *   4. Below-MinInstances slot
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, PersistedPdo } from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../../../../../backend/shared/ethercat/device-config-defaults'
import { validateEthercatProject } from '../validate-ethercat-project'

const slave = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 's',
  position: 1,
  name: 'drive',
  esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
  vendorId: '0x1',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: createDefaultSlaveConfig(),
  channelMappings: [],
  ...over,
})

const bus = (devices: ConfiguredEtherCATDevice[], busName = 'bus_a'): PLCRemoteDevice[] =>
  [
    {
      name: busName,
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices,
      },
    },
  ] as unknown as PLCRemoteDevice[]

const pdo = (index: string, over: Partial<PersistedPdo> = {}): PersistedPdo => ({
  index,
  name: index,
  entries: [],
  assigned: true,
  ...over,
})

describe('validateEthercatProject (BR21)', () => {
  test('empty project returns no errors', () => {
    expect(validateEthercatProject([])).toEqual([])
    expect(validateEthercatProject(undefined)).toEqual([])
  })

  test('all-good project returns no errors', () => {
    const s = slave({ rxPdos: [pdo('0x1600')] })
    expect(validateEthercatProject(bus([s]))).toEqual([])
  })

  test('Mandatory RxPDO reported unassigned is flagged', () => {
    const s = slave({ rxPdos: [pdo('0x1600', { mandatory: true, assigned: false })] })
    const errors = validateEthercatProject(bus([s]))
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/Mandatory/)
    expect(errors[0]).toMatch(/0x1600/)
  })

  test('Fixed PDO reported unassigned is flagged', () => {
    const s = slave({ txPdos: [pdo('0x1A00', { fixed: true, assigned: false })] })
    const errors = validateEthercatProject(bus([s]))
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/Fixed/)
    expect(errors[0]).toMatch(/0x1A00/)
  })

  test('Unresolved exclusion: two assigned PDOs excluding each other', () => {
    const s = slave({
      rxPdos: [pdo('0x1600', { exclude: ['0x1601'] }), pdo('0x1601')],
    })
    const errors = validateEthercatProject(bus([s]))
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/excludes 0x1601/)
  })

  test('Exclusion resolved: the excluded PDO is unassigned', () => {
    const s = slave({
      rxPdos: [pdo('0x1600', { exclude: ['0x1601'] }), pdo('0x1601', { assigned: false })],
    })
    expect(validateEthercatProject(bus([s]))).toEqual([])
  })

  test('Below-MinInstances slot is flagged', () => {
    const s = slave({
      isModularCoupler: true,
      slotsSpec: {
        slots: [
          { name: 'bus', minInstances: 1, maxInstances: 1 },
          { name: 'io', minInstances: 2, maxInstances: 16 },
        ],
        slotIndexIncrement: 16,
        slotPdoIncrement: 1,
        downloadModuleIdentList: false,
      },
      modules: [
        {
          id: 'slot-1',
          slot: 1,
          name: 'Bus module',
          ident: '0x0001',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x0001' },
          channelMappings: [],
        },
      ],
    })
    const errors = validateEthercatProject(bus([s]))
    expect(errors.length).toBe(1)
    expect(errors[0]).toMatch(/slot 2/)
    expect(errors[0]).toMatch(/at least 2/)
  })

  test('MinInstances met for every slot: no error', () => {
    const s = slave({
      isModularCoupler: true,
      slotsSpec: {
        slots: [{ name: 'io', minInstances: 1, maxInstances: 16 }],
        slotIndexIncrement: 16,
        slotPdoIncrement: 1,
        downloadModuleIdentList: false,
      },
      modules: [
        {
          id: 'slot-1',
          slot: 1,
          name: 'DI',
          ident: '0x1',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
          channelMappings: [],
        },
      ],
    })
    expect(validateEthercatProject(bus([s]))).toEqual([])
  })

  test('error messages name the bus and the slave position', () => {
    const s = slave({ position: 3, name: 'Delta ASDA-A2-E', rxPdos: [pdo('0x1600', { mandatory: true, assigned: false })] })
    const errors = validateEthercatProject(bus([s], 'eth0_bus'))
    expect(errors[0]).toMatch(/eth0_bus/)
    expect(errors[0]).toMatch(/slave 3/)
    expect(errors[0]).toMatch(/Delta ASDA-A2-E/)
  })
})
