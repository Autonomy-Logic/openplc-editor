/**
 * DOPE-704 E5 generator tests.
 *
 * Verifies the modular-devices generator path: a modular coupler (e.g. Weidmüller UR20)
 * carries plugged-in modules in its `modules?` array, and the generator must:
 *
 *   1. Merge each module's RxPDOs/TxPDOs into the coupler's PDO lists, slot-ordered after
 *      the coupler's own PDOs. The module's PDO indices are assumed to already be slot-
 *      adjusted at persistence time (set by the UI when the module is added), so the
 *      generator copies them through.
 *   2. Merge each module's startup SDOs into the slave's `sdo_configurations`, slot-
 *      ordered, carrying `complete_access` and byte-string payloads through when the
 *      module's `InitCmd` writes need them (RTOP-319 R2 plumbing).
 *   3. Emit a `0xF030` module-ident-list write (clear/list/count on the sub-indices) when
 *      the coupler's `coeFlags.pdoConfig` is true. Empty slot positions use ident 0.
 *   4. NOT emit `0x1C12`/`0x1C13` on couplers that advertise no `PdoAssign` — the E3 gate
 *      already handles that, but the modular path must respect it too.
 *
 * These writes are what makes the UR20-EC coupler expose its module slot image on the bus;
 * they are the acceptance criterion AC04 in the Requirements Gathering.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  PersistedPdo,
} from '@root/middleware/shared/ports/esi-types'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'

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
    config: { slaves: { sdo_configurations: IoSdoRow[]; rx_pdos: unknown[]; tx_pdos: unknown[] }[] }
  }[]
  return parsed[0]!.config.slaves[0]!
}

describe('DOPE-704 E5: modular-devices generator', () => {
  test('coupler with no modules behaves exactly as a plain slave', () => {
    const device = coupler({
      rxPdos: [makePdo('0x1600', 'Coupler Rx')],
      txPdos: [makePdo('0x1A00', 'Coupler Tx')],
    })
    const slave = firstSlave([device])
    expect(slave.rx_pdos.length).toBe(1)
    expect(slave.tx_pdos.length).toBe(1)
    // No 0xF030 emission when no modules.
    expect(slave.sdo_configurations.filter((e) => e.index === '0x0F30')).toEqual([])
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

    const rxIndices = (slave.rx_pdos as { index: string }[]).map((p) => p.index)
    const txIndices = (slave.tx_pdos as { index: string }[]).map((p) => p.index)
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
    const rxIndices = (slave.rx_pdos as { index: string }[]).map((p) => p.index)
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
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0x0F30')
    expect(identWrites.length).toBe(5) // clear + 3 slots + count
    expect(identWrites[0]).toMatchObject({ index: '0x0F30', subindex: 0, value: 0 })
    expect(identWrites[1]).toMatchObject({ index: '0x0F30', subindex: 1, value: 0x05421352 })
    expect(identWrites[2]).toMatchObject({ index: '0x0F30', subindex: 2, value: 0x05421353 })
    expect(identWrites[3]).toMatchObject({ index: '0x0F30', subindex: 3, value: 0x05421354 })
    expect(identWrites[4]).toMatchObject({ index: '0x0F30', subindex: 0, value: 3 })
  })

  test('0xF030 ident list fills empty slot positions with 0', () => {
    const device = coupler({
      modules: [
        module_({ slot: 1, ident: '0x1' }),
        module_({ slot: 3, ident: '0x3' }), // slot 2 missing
      ],
    })
    const slave = firstSlave([device])
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0x0F30')
    // clear + 3 sub-indices (slot 1, 0, slot 3) + count
    expect(identWrites.length).toBe(5)
    expect(identWrites[1]).toMatchObject({ subindex: 1, value: 0x1 })
    expect(identWrites[2]).toMatchObject({ subindex: 2, value: 0 })
    expect(identWrites[3]).toMatchObject({ subindex: 3, value: 0x3 })
    expect(identWrites[4]).toMatchObject({ subindex: 0, value: 3 })
  })

  test('0xF030 is NOT emitted when the coupler has coeFlags.pdoConfig = false', () => {
    const device = coupler({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: false, completeAccess: false },
      },
      modules: [module_({ slot: 1, ident: '0x1' })],
    })
    const slave = firstSlave([device])
    expect(slave.sdo_configurations.filter((e) => e.index === '0x0F30')).toEqual([])
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

  test('E5 extras: 0xF030 emitted via Complete Access when coupler advertises CompleteAccess', () => {
    const device = coupler({
      config: {
        ...createDefaultSlaveConfig(),
        coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: true },
      },
      modules: [
        module_({ slot: 1, ident: '0x1A0F' }),
        module_({ slot: 2, ident: '0x1A10' }),
      ],
    })
    const slave = firstSlave([device])
    const identWrites = slave.sdo_configurations.filter((e) => e.index === '0x0F30')
    // Complete Access path: single SDO carries the whole ident array.
    expect(identWrites.length).toBe(1)
    expect(identWrites[0]).toMatchObject({ index: '0x0F30', subindex: 0, complete_access: true })
    // Byte layout: 1 count byte + 4 bytes per slot (UDINT LE) = 9 bytes for 2 slots.
    expect(identWrites[0]!.value_bytes).toBe(
      // count=02, slot1=0x1A0F → 0F 1A 00 00, slot2=0x1A10 → 10 1A 00 00
      '020F1A0000101A0000',
    )
  })

  test('E5 extras: module SDO byte-string payload (valueBytes) rides through to runtime', () => {
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
              valueBytes: '55523230', // "UR20" in ASCII
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
    expect(moduleBytes!.value_bytes).toBe('55523230')
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
    const posIdent = indicesInOrder.indexOf('0x0F30')
    const posAssign = indicesInOrder.indexOf('0x1C12')
    expect(posUser).toBeGreaterThanOrEqual(0)
    expect(posModule).toBeGreaterThan(posUser)
    expect(posIdent).toBeGreaterThan(posModule)
    expect(posAssign).toBeGreaterThan(posIdent)
  })
})
