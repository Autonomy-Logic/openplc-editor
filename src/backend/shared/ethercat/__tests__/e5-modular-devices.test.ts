/**
 * Modular-coupler generator tests: module PDOs merged into the coupler's lists by
 * ModulePdoGroup and slot, module startup SDOs, the 0xF030 module ident list, and no
 * 0x1C1n writes on a coupler without PdoAssign.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  PersistedPdo,
} from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

type BusPdo = { index: string; entries: { index: string; bit_length: number; data_type: string }[] }

type IoSdoRow = {
  index: string
  subindex: number
  value: number
  name: string
  complete_access?: boolean
  value_bytes?: string
}

const coupler = (over: Partial<ConfiguredEtherCATDevice> = {}): ConfiguredEtherCATDevice => ({
  id: 'coupler',
  position: 1,
  name: 'UR20-FBC-EC',
  esiDeviceRef: { repositoryItemId: 'weidmueller', deviceIndex: 0 },
  vendorId: '0x230',
  productCode: '0x4C520001',
  revisionNo: '0x00030000',
  addedFrom: 'repository',
  config: {
    ...createDefaultSlaveConfig(),
    // ETG.5001 couplers like UR20 keep PdoAssign off (fixed PDOs) but turn PdoConfig on
    // so the 0xF030 module-ident-list download goes through.
    coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: false },
  },
  channelMappings: [],
  isModularCoupler: true,
  slotsSpec: {
    slots: [{ minInstances: 0, maxInstances: 64 }],
    slotIndexIncrement: 16,
    slotPdoIncrement: 1,
    downloadModuleIdentList: true,
  },
  ...over,
})

const module_ = (
  over: Partial<ConfiguredEtherCATModule> & { slot: number; ident: string },
): ConfiguredEtherCATModule => ({
  id: `slot-${over.slot}`,
  name: `module ${over.slot}`,
  esiModuleRef: { repositoryItemId: 'weidmueller', moduleIdent: over.ident },
  channelMappings: [],
  ...over,
})

const makePdo = (index: string, name = index, entries: PersistedPdo['entries'] = []): PersistedPdo => ({
  index,
  name,
  entries,
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

const firstSlave = (devices: ConfiguredEtherCATDevice[]) => {
  const result = generateEtherdogConfigs(bus(devices))
  if (result === null) throw new Error('generator returned null')
  const parsed = JSON.parse(result.busconfig) as {
    config: {
      slaves: {
        sdo_configurations: IoSdoRow[]
        rx_pdos: BusPdo[]
        tx_pdos: BusPdo[]
        channels: { index: number; name: string }[]
      }[]
    }
  }[]
  return parsed[0]!.config.slaves[0]!
}

describe('modular-coupler generator', () => {
  test('coupler with no modules behaves exactly as a plain slave', () => {
    const device = coupler({
      rxPdos: [makePdo('0x1600', 'Coupler Rx')],
      txPdos: [makePdo('0x1A00', 'Coupler Tx')],
    })
    const slave = firstSlave([device])
    expect(slave.rx_pdos.length).toBe(1)
    expect(slave.tx_pdos.length).toBe(1)
    // No 0xF030 emission when no modules.
    expect(slave.sdo_configurations.filter((e) => e.index === '0xF030')).toEqual([])
  })

  test('module PDOs merge after coupler PDOs in slot order', () => {
    const device = coupler({
      rxPdos: [makePdo('0x1600', 'Coupler Rx')],
      txPdos: [makePdo('0x1A00', 'Coupler Tx')],
      modules: [
        module_({
          slot: 1,
          ident: '0x05421352',
          rxPdos: [makePdo('0x1610', 'Slot1 Rx')],
          txPdos: [makePdo('0x1A10', 'Slot1 Tx')],
        }),
        module_({
          slot: 2,
          ident: '0x05421353',
          rxPdos: [makePdo('0x1620', 'Slot2 Rx')],
          txPdos: [makePdo('0x1A20', 'Slot2 Tx')],
        }),
      ],
    })
    const slave = firstSlave([device])

    const rxIndices = slave.rx_pdos.map((p) => p.index)
    const txIndices = slave.tx_pdos.map((p) => p.index)
    expect(rxIndices).toEqual(['0x1600', '0x1610', '0x1620'])
    expect(txIndices).toEqual(['0x1A00', '0x1A10', '0x1A20'])
  })

  test('module PDOs in reversed slot order emerge sorted by slot', () => {
    const device = coupler({
      modules: [
        module_({ slot: 3, ident: '0x3', rxPdos: [makePdo('0x1630')] }),
        module_({ slot: 1, ident: '0x1', rxPdos: [makePdo('0x1610')] }),
        module_({ slot: 2, ident: '0x2', rxPdos: [makePdo('0x1620')] }),
      ],
    })
    const slave = firstSlave([device])
    const rxIndices = slave.rx_pdos.map((p) => p.index)
    expect(rxIndices).toEqual(['0x1610', '0x1620', '0x1630'])
  })

  test('0xF030 ident list: clear / list / count with each slot ident in order', () => {
    const device = coupler({
      modules: [
        module_({ slot: 1, ident: '0x05421352' }),
        module_({ slot: 2, ident: '0x05421353' }),
        module_({ slot: 3, ident: '0x05421354' }),
      ],
    })
    const slave = firstSlave([device])
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0xF030')
    expect(identWrites.length).toBe(5) // clear + 3 slots + count
    expect(identWrites[0]).toMatchObject({ index: '0xF030', subindex: 0, value: 0 })
    expect(identWrites[1]).toMatchObject({ index: '0xF030', subindex: 1, value: 0x05421352 })
    expect(identWrites[2]).toMatchObject({ index: '0xF030', subindex: 2, value: 0x05421353 })
    expect(identWrites[3]).toMatchObject({ index: '0xF030', subindex: 3, value: 0x05421354 })
    expect(identWrites[4]).toMatchObject({ index: '0xF030', subindex: 0, value: 3 })
  })

  test('0xF030 ident list fills empty slot positions with 0', () => {
    const device = coupler({
      modules: [
        module_({ slot: 1, ident: '0x1' }),
        module_({ slot: 3, ident: '0x3' }), // slot 2 missing
      ],
    })
    const slave = firstSlave([device])
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0xF030')
    // clear + 3 sub-indices (slot 1, 0, slot 3) + count
    expect(identWrites.length).toBe(5)
    expect(identWrites[1]).toMatchObject({ subindex: 1, value: 0x1 })
    expect(identWrites[2]).toMatchObject({ subindex: 2, value: 0 })
    expect(identWrites[3]).toMatchObject({ subindex: 3, value: 0x3 })
    expect(identWrites[4]).toMatchObject({ subindex: 0, value: 3 })
  })

  test('0xF030 is not emitted when the coupler ESI does not declare DownloadModuleIdentList', () => {
    const device = coupler({
      slotsSpec: { slots: [], slotIndexIncrement: 16, slotPdoIncrement: 1, downloadModuleIdentList: false },
      modules: [module_({ slot: 1, ident: '0x1' })],
    })
    const slave = firstSlave([device])
    expect(slave.sdo_configurations.filter((e) => e.index === '0xF030')).toEqual([])
  })

  test('a coupler with no PdoAssign emits no 0x1C1n writes even with modules present', () => {
    const device = coupler({
      rxPdos: [makePdo('0x1600')],
      modules: [module_({ slot: 1, ident: '0x1', rxPdos: [makePdo('0x1610')] })],
    })
    const slave = firstSlave([device])
    const assignmentWrites = slave.sdo_configurations.filter((e) => e.index === '0x1C12' || e.index === '0x1C13')
    expect(assignmentWrites).toEqual([])
  })

  test('module startup SDOs merge into sdo_configurations in slot order, labelled by slot', () => {
    const device = coupler({
      modules: [
        module_({
          slot: 1,
          ident: '0x1',
          sdoConfigurations: [
            {
              index: '0x8010',
              subIndex: 1,
              value: '5',
              defaultValue: '0',
              dataType: 'USINT',
              bitLength: 8,
              name: 'Filter',
              objectName: 'Module 1 Settings',
            },
          ],
        }),
        module_({
          slot: 2,
          ident: '0x2',
          sdoConfigurations: [
            {
              index: '0x8020',
              subIndex: 2,
              value: '10',
              defaultValue: '0',
              dataType: 'USINT',
              bitLength: 8,
              name: 'Threshold',
              objectName: 'Module 2 Settings',
            },
          ],
        }),
      ],
    })
    const slave = firstSlave([device])
    const moduleSdos = slave.sdo_configurations.filter((e) => e.index === '0x8010' || e.index === '0x8020')
    expect(moduleSdos.length).toBe(2)
    expect(moduleSdos[0]).toMatchObject({ index: '0x8010', subindex: 1, value: 5 })
    expect(moduleSdos[0]!.name).toContain('slot 1')
    expect(moduleSdos[1]).toMatchObject({ index: '0x8020', subindex: 2, value: 10 })
    expect(moduleSdos[1]!.name).toContain('slot 2')
  })

  test('0xF030 emitted via Complete Access when coupler advertises CompleteAccess', () => {
    const device = coupler({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: true },
      },
      modules: [module_({ slot: 1, ident: '0x1A0F' }), module_({ slot: 2, ident: '0x1A10' })],
    })
    const slave = firstSlave([device])
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0xF030')
    // Complete Access path: single SDO carries the whole ident array.
    expect(identWrites.length).toBe(1)
    expect(identWrites[0]).toMatchObject({ index: '0xF030', subindex: 0, complete_access: true })
    // count 02 padded to 16 bits, then slot1=0x1A0F → 0F 1A 00 00, slot2=0x1A10 → 10 1A 00 00
    expect(identWrites[0]!.value_bytes).toBe('0x02000F1A0000101A0000')
  })

  test('module SDO byte-string payload (valueBytes) rides through to runtime', () => {
    const device = coupler({
      modules: [
        {
          id: 'slot-1',
          slot: 1,
          name: 'UR20-4DI-P',
          ident: '0x1A0F',
          esiModuleRef: { repositoryItemId: 'w', moduleIdent: '0x1A0F' },
          channelMappings: [],
          sdoConfigurations: [
            {
              index: '0x8010',
              subIndex: 3,
              value: '',
              valueBytes: '0x55523230', // "UR20" in ASCII
              completeAccess: true,
              defaultValue: 'UR20',
              dataType: 'OCTET_STRING',
              bitLength: 32,
              name: 'Module name',
              objectName: 'Module slot 1 InitCmd',
            },
          ],
        },
      ],
    })
    const slave = firstSlave([device])
    const moduleBytes = slave.sdo_configurations.find((e) => e.index === '0x8010' && e.subindex === 3)
    expect(moduleBytes).toBeDefined()
    expect(moduleBytes!.value_bytes).toBe('0x55523230')
    expect(moduleBytes!.complete_access).toBe(true)
  })

  test('full emission order: user startup SDOs → module SDOs → 0xF030 ident list → 0x1C1n', () => {
    const device = coupler({
      config: {
        ...createDefaultSlaveConfig(),
        // enable both so we can observe both blocks
        coeFlags: { pdoAssign: true, pdoConfig: true, completeAccess: false },
      },
      sdoConfigurations: [
        {
          index: '0x8000',
          subIndex: 1,
          value: '42',
          defaultValue: '0',
          dataType: 'USINT',
          bitLength: 8,
          name: 'CouplerStart',
          objectName: 'Coupler Settings',
        },
      ],
      rxPdos: [makePdo('0x1600', 'Coupler Rx')],
      modules: [
        module_({
          slot: 1,
          ident: '0x1',
          sdoConfigurations: [
            {
              index: '0x8010',
              subIndex: 1,
              value: '7',
              defaultValue: '0',
              dataType: 'USINT',
              bitLength: 8,
              name: 'ModuleStart',
              objectName: 'Module 1',
            },
          ],
        }),
      ],
    })
    const slave = firstSlave([device])
    const indicesInOrder = slave.sdo_configurations.map((e) => e.index)
    const posUser = indicesInOrder.indexOf('0x8000')
    const posModule = indicesInOrder.indexOf('0x8010')
    const posIdent = indicesInOrder.indexOf('0xF030')
    const posAssign = indicesInOrder.indexOf('0x1C12')
    expect(posUser).toBeGreaterThanOrEqual(0)
    expect(posModule).toBeGreaterThan(posUser)
    expect(posIdent).toBeGreaterThan(posModule)
    expect(posAssign).toBeGreaterThan(posIdent)
  })

  test('0xF030 at transition IP is written before every other startup SDO', () => {
    const device = coupler({
      slotsSpec: {
        slots: [{ minInstances: 0, maxInstances: 64 }],
        slotIndexIncrement: 16,
        slotPdoIncrement: 1,
        downloadModuleIdentList: true,
        downloadModuleListTransition: 'IP',
      },
      esiInitCmdSdos: [
        {
          index: '0xF810',
          subIndex: 1,
          value: '',
          valueBytes: '0x00100100',
          defaultValue: '',
          dataType: 'OCTET_STRING',
          bitLength: 32,
          name: 'InitCmd',
          objectName: 'ESI InitCmd',
        },
      ],
      modules: [module_({ slot: 1, ident: '0x1' })],
    })
    const order = firstSlave([device]).sdo_configurations.map((e) => e.index)
    expect(order[0]).toBe('0xF030')
    expect(order.indexOf('0xF810')).toBeGreaterThan(order.lastIndexOf('0xF030'))
  })

  test('PDOs are ordered by ModulePdoGroup, then slot; the coupler PDO a group names leads that group', () => {
    const device = coupler({
      modulePdoGroups: [
        { group: 0, alignment: 1, rxPdoIndex: '0x16FF', txPdoIndex: '0x1AFF' },
        { group: 1, alignment: 1, rxPdoIndex: '0x1600', txPdoIndex: '0x1A00' },
      ],
      txPdos: [makePdo('0x1AFF', 'Coupler status')],
      modules: [
        module_({ slot: 2, ident: '0x2', modulePdoGroup: 1, txPdos: [makePdo('0x1A01')] }),
        module_({ slot: 1, ident: '0x1', modulePdoGroup: 1, txPdos: [makePdo('0x1A00')] }),
      ],
    })
    expect(firstSlave([device]).tx_pdos.map((p) => p.index)).toEqual(['0x1AFF', '0x1A00', '0x1A01'])
  })

  test('a group with Alignment n starts each PDO on an n-byte boundary, padding the previous PDO', () => {
    const bit = (sub: string) => ({ index: '0x6000', subIndex: sub, bitLen: 1, name: sub, dataType: 'BOOL' })
    const word = { index: '0x6010', subIndex: '0x01', bitLen: 16, name: 'AI', dataType: 'INT' }
    const device = coupler({
      modulePdoGroups: [
        { group: 0, alignment: 0 },
        { group: 2, alignment: 2 },
      ],
      modules: [
        module_({
          slot: 1,
          ident: '0x1',
          modulePdoGroup: 0,
          txPdos: [makePdo('0x1A00', 'DI', [bit('0x01'), bit('0x02')])],
        }),
        module_({ slot: 2, ident: '0x2', modulePdoGroup: 2, txPdos: [makePdo('0x1A01', 'AI', [word])] }),
      ],
    })
    const tx = firstSlave([device]).tx_pdos
    expect(tx.map((p) => p.index)).toEqual(['0x1A00', '0x1A01'])
    expect(tx[0]?.entries.map((e) => [e.index, e.bit_length, e.data_type])).toEqual([
      ['0x6000', 1, 'BOOL'],
      ['0x6000', 1, 'BOOL'],
      ['0x0000', 14, 'PAD'],
    ])
  })

  test('channel indices are unique across the coupler and its modules', () => {
    const info = (pdo: string, name: string) => ({
      channelId: name,
      name,
      direction: 'input' as const,
      pdoIndex: pdo,
      entryIndex: '0x6000',
      entrySubIndex: '0x01',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    })
    const device = coupler({
      channelInfo: [info('0x1AFF', 'status')],
      modules: [
        module_({ slot: 1, ident: '0x1', channelInfo: [info('0x1A00', 'a')] }),
        module_({ slot: 2, ident: '0x2', channelInfo: [info('0x1A01', 'b')] }),
      ],
    })
    expect(firstSlave([device]).channels.map((c) => c.index)).toEqual([0, 1, 2])
  })

  test('InitCmds for the IP transition are written before the PS ones', () => {
    const cmd = (index: string, transition: string) => ({
      index,
      subIndex: 1,
      value: '1',
      defaultValue: '1',
      dataType: 'USINT',
      bitLength: 8,
      name: index,
      objectName: 'InitCmd',
      transition,
    })
    const device = coupler({
      esiInitCmdSdos: [cmd('0xF810', 'PS'), cmd('0xF811', 'IP')],
      modules: [module_({ slot: 1, ident: '0x1', sdoConfigurations: [cmd('0x8000', 'PS'), cmd('0x8001', 'IP,PS')] })],
    })
    const order = firstSlave([device])
      .sdo_configurations.map((e) => e.index)
      .filter((i) => i !== '0xF030')
    expect(order).toEqual(['0xF811', '0x8001', '0xF810', '0x8000'])
  })
})

describe('station, mandatory and fixed fields for EtherDOG', () => {
  const contract = (devices: ConfiguredEtherCATDevice[]) => {
    const result = generateEtherdogConfigs(bus(devices))
    if (result === null) throw new Error('generator returned null')
    const parsed: unknown = JSON.parse(result.busconfig)
    if (!Array.isArray(parsed)) throw new Error('busconfig is not an array')
    const root: { config: { slaves: Record<string, unknown>[] } } = parsed[0]
    return root.config.slaves
  }

  test('a modular coupler lists its slot rules and modules in slot order', () => {
    const device = coupler({
      slotsSpec: {
        slots: [{ minInstances: 1, maxInstances: 8, moduleClasses: ['Di'], moduleIdents: ['0x1'] }],
        slotIndexIncrement: 16,
        slotPdoIncrement: 1,
        downloadModuleIdentList: true,
      },
      modules: [
        module_({ slot: 2, ident: '0x00000002', moduleClass: 'Di' }),
        module_({ slot: 1, ident: '0x00000001' }),
      ],
    })
    expect(contract([device])[0]?.modular).toEqual({
      slot_index_increment: 16,
      slots: [{ min_instances: 1, max_instances: 8, module_classes: ['Di'], module_idents: ['0x1'] }],
      modules: [
        { slot: 1, ident: '0x00000001', class: '' },
        { slot: 2, ident: '0x00000002', class: 'Di' },
      ],
    })
  })

  test('a plain slave has no modular, mandatory_pdos or fixed keys', () => {
    const plain = coupler({
      isModularCoupler: false,
      slotsSpec: undefined,
      rxPdos: [makePdo('0x1600')],
      txPdos: [makePdo('0x1A00')],
    })
    const [slave] = contract([plain])
    expect(slave).not.toHaveProperty('modular')
    expect(slave).not.toHaveProperty('mandatory_pdos')
    expect(JSON.stringify(slave)).not.toContain('"fixed"')
  })

  test('mandatory PDOs of the slave and its modules are listed once; fixed rides on the PDO', () => {
    const device = coupler({
      txPdos: [{ ...makePdo('0x1AFF'), mandatory: true, fixed: true }],
      modules: [
        module_({ slot: 1, ident: '0x1', txPdos: [{ ...makePdo('0x1A00'), mandatory: true, fixed: true }] }),
        module_({ slot: 2, ident: '0x1', rxPdos: [{ ...makePdo('0x1601'), fixed: false }] }),
      ],
    })
    const [slave] = contract([device])
    expect(slave?.mandatory_pdos).toEqual(['0x1AFF', '0x1A00'])
    const pdos = firstSlave([device])
    expect(pdos.tx_pdos.map((p) => [p.index, 'fixed' in p])).toEqual([
      ['0x1AFF', true],
      ['0x1A00', true],
    ])
    expect(pdos.rx_pdos.map((p) => 'fixed' in p)).toEqual([false])
  })
})
