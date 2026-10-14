/**
 * Project-level validator tests: Mandatory PDOs, exclusion, unique PDO indices, and the
 * modular-coupler slot rules (definitions in order, Min/MaxInstances, accepted class or
 * ident, one module per slot, supported 0xF030 transition).
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  ESISlotsSpec,
  PersistedPdo,
} from '@root/middleware/shared/ports/esi-types'

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

const mod = (slot: number, over: Partial<ConfiguredEtherCATModule> = {}): ConfiguredEtherCATModule => ({
  id: `m${slot}`,
  slot,
  name: `M${slot}`,
  ident: '0x1',
  esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
  channelMappings: [],
  moduleClass: 'Di',
  ...over,
})

const spec = (slots: ESISlotsSpec['slots'], over: Partial<ESISlotsSpec> = {}): ESISlotsSpec => ({
  slots,
  slotIndexIncrement: 16,
  slotPdoIncrement: 1,
  downloadModuleIdentList: true,
  ...over,
})

const coupler = (slotsSpec: ESISlotsSpec, modules: ConfiguredEtherCATModule[]) =>
  slave({ isModularCoupler: true, slotsSpec, modules })

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

  test('Fixed only locks the entries: an unassigned Fixed, non-Mandatory PDO is valid', () => {
    const s = slave({ txPdos: [pdo('0x1A00', { fixed: true, assigned: false })] })
    expect(validateEthercatProject(bus([s]))).toEqual([])
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
    expect(errors[0]).toMatch(/slot definition 2 \('io'\)/)
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
    const s = slave({
      position: 3,
      name: 'Delta ASDA-A2-E',
      rxPdos: [pdo('0x1600', { mandatory: true, assigned: false })],
    })
    const errors = validateEthercatProject(bus([s], 'eth0_bus'))
    expect(errors[0]).toMatch(/eth0_bus/)
    expect(errors[0]).toMatch(/slave 3/)
    expect(errors[0]).toMatch(/Delta ASDA-A2-E/)
  })

  test('module PDOs are checked like the slave PDOs', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 8 }]), [
      mod(1, { txPdos: [pdo('0x1A00', { mandatory: true, assigned: false })] }),
    ])
    const errors = validateEthercatProject(bus([s]))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/module 'M1' in slot 1 TxPDOs: PDO 0x1A00/)
  })

  test('two assigned PDOs with one index on a slave are refused', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 8 }]), [
      mod(1, { txPdos: [pdo('0x1A00')] }),
      mod(2, { txPdos: [pdo('0x1a00')] }),
    ])
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/PDO 0x1a00 of module 'M2' \(slot 2\) has the same index as a PDO of module 'M1'/),
    ])
  })

  test('more modules than MaxInstances are refused', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 2 }]), [mod(1), mod(2), mod(3)])
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/module 'M3' in slot 3: no slot definition of the coupler accepts it/),
    ])
  })

  test('a module of a class no definition accepts is refused', () => {
    const s = coupler(spec([{ name: 'io', minInstances: 0, maxInstances: 8, moduleClasses: ['Di', 'Do'] }]), [
      mod(1),
      mod(2, { ident: '0x91F84', moduleClass: 'Ai' }),
    ])
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/module 'M2' in slot 2: no slot definition of the coupler accepts it/),
    ])
  })

  test('a definition still below MinInstances names the class it refused', () => {
    const s = coupler(spec([{ name: 'io', minInstances: 2, maxInstances: 8, moduleClasses: ['Di'] }]), [
      mod(1),
      mod(2, { ident: '0x91F84', moduleClass: 'Ai' }),
    ])
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/slot definition 1 \('io'\) does not accept module 0x91F84 \(class 'Ai'\)/),
    ])
  })

  test('a module listed by ident is accepted whatever its class', () => {
    const s = coupler(
      spec([{ minInstances: 0, maxInstances: 8, moduleClasses: ['Di'], moduleIdents: ['#x00091F84'] }]),
      [mod(1, { ident: '0x00091f84', moduleClass: 'Ai' })],
    )
    expect(validateEthercatProject(bus([s]))).toEqual([])
  })

  test('definitions fill in order: a module the first one rejects moves on once MinInstances is met', () => {
    const s = coupler(
      spec([
        { name: 'head', minInstances: 1, maxInstances: 1, moduleClasses: ['Head'] },
        { name: 'io', minInstances: 0, maxInstances: 8, moduleClasses: ['Di'] },
      ]),
      [mod(1, { moduleClass: 'Head' }), mod(2), mod(3)],
    )
    expect(validateEthercatProject(bus([s]))).toEqual([])
  })

  test('an empty slot is allowed and counts towards the current definition', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 2 }]), [mod(1), mod(3)])
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/module 'M3' in slot 3: no slot definition/),
    ])
  })

  test('two modules in one slot and a slot 0 are refused', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 8 }]), [mod(0), mod(1), mod(1, { name: 'other' })])
    const errors = validateEthercatProject(bus([s]))
    expect(errors).toEqual([
      expect.stringMatching(/module 'M0' in slot 0: slot numbers start at 1/),
      expect.stringMatching(/module 'other' in slot 1: slot 1 already holds 'M1'/),
    ])
  })

  test('a module-list transition EtherDOG cannot honour is refused', () => {
    const s = coupler(spec([{ minInstances: 0, maxInstances: 8 }], { downloadModuleListTransition: 'SO' }), [mod(1)])
    expect(validateEthercatProject(bus([s]))).toEqual([expect.stringMatching(/transition 'SO'; only IP and PS/)])
  })

  test('modules on a slave whose ESI declares no <Slots> are refused', () => {
    const s = slave({ modules: [mod(1)] })
    expect(validateEthercatProject(bus([s]))).toEqual([expect.stringMatching(/declares no <Slots>/)])
  })

  test('an InitCmd for a transition after PRE-OP is refused; IP and PS pass', () => {
    const initCmd = (index: string, transition: string) => ({
      index,
      subIndex: 1,
      value: '1',
      defaultValue: '1',
      dataType: 'USINT',
      bitLength: 8,
      name: index,
      objectName: 'ESI InitCmd',
      transition,
    })
    const s = coupler(spec([{ minInstances: 0, maxInstances: 8 }]), [
      mod(1, { sdoConfigurations: [initCmd('0x8000', 'PS'), initCmd('0x8001', 'PS,SO')] }),
    ])
    s.esiInitCmdSdos = [initCmd('0xF810', 'IP'), initCmd('0xF811', 'OS')]
    expect(validateEthercatProject(bus([s]))).toEqual([
      expect.stringMatching(/slave 1 \('drive'\): InitCmd 0xF811:1 runs at transition OS; EtherDOG writes/),
      expect.stringMatching(/module 'M1' in slot 1: InitCmd 0x8001:1 runs at transition SO;/),
    ])
  })
})
