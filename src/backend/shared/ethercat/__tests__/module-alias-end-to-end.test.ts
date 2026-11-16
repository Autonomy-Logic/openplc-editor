/**
 * End-to-end proof: an alias set on a modular-coupler SUB-MODULE channel is
 * seen by the IEC alias registry, resolves on a program variable at compile
 * time, lands in the EtherDOG iomapping at the module's own IEC location, and
 * is emitted by the ST transpiler as a located variable so STruC++ wires the
 * PLC variable to the right PDO byte on the runtime.
 *
 * Scenario — the exact one the demand owner spelled out:
 *   - Weidmueller UR20 coupler at EtherCAT position 1
 *   - UR20-4DO-P plugged at slot 1 (digital-output module, 4 bits)
 *   - Alias "Valve_2" set on digital output 2 (channel bound to %QX2.1)
 *   - A program `main` with a BOOL variable `Valve_2_var` whose Location is
 *     the alias name "Valve_2"
 *
 * The test exercises the production code paths — no mocks, no fixtures with
 * pre-resolved addresses: resolution is what we're asserting.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'
import type { ConfiguredEtherCATDevice, ConfiguredEtherCATModule } from '@root/middleware/shared/ports/esi-types'
import { buildAliasIndex, migrateToRegistry } from '@root/middleware/shared/utils/iec-address/registry'
import { resolveProjectAliases } from '@root/middleware/shared/utils/iec-address/resolve-project-aliases'

import { createDefaultSlaveConfig } from '../device-config-defaults'
import { generateEtherdogConfigs } from '../generate-ethercat-config'
import { transpileToSt } from '../../transpilers/st-transpiler'
import type { TranspileProject } from '../../transpilers/st-transpiler/types'

// Minimal UR20-4DO-P module: 4 BOOL outputs on %QX2.*, with the RxPDO entries of UR20_IO.xml.
const ur20_4do_p = (): ConfiguredEtherCATModule => ({
  id: 'slot-1',
  slot: 1,
  name: 'UR20-4DO-P',
  ident: '0x01012FA0',
  esiModuleRef: { repositoryItemId: 'weidm', moduleIdent: '0x01012FA0' },
  channelInfo: [
    {
      channelId: '0x1600-0x7000-0x1',
      name: 'DO 1',
      direction: 'output',
      pdoIndex: '0x1600',
      entryIndex: '0x7000',
      entrySubIndex: '0x1',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
    {
      channelId: '0x1600-0x7000-0x2',
      name: 'DO 2',
      direction: 'output',
      pdoIndex: '0x1600',
      entryIndex: '0x7000',
      entrySubIndex: '0x2',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
    {
      channelId: '0x1600-0x7000-0x3',
      name: 'DO 3',
      direction: 'output',
      pdoIndex: '0x1600',
      entryIndex: '0x7000',
      entrySubIndex: '0x3',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
    {
      channelId: '0x1600-0x7000-0x4',
      name: 'DO 4',
      direction: 'output',
      pdoIndex: '0x1600',
      entryIndex: '0x7000',
      entrySubIndex: '0x4',
      dataType: 'BOOL',
      bitLen: 1,
      iecType: 'BOOL',
    },
  ],
  channelMappings: [
    { channelId: '0x1600-0x7000-0x1', iecLocation: '%QX2.0', alias: '' },
    // digital output 2 — the alias binding the user described
    { channelId: '0x1600-0x7000-0x2', iecLocation: '%QX2.1', alias: 'Valve_2' },
    { channelId: '0x1600-0x7000-0x3', iecLocation: '%QX2.2', alias: '' },
    { channelId: '0x1600-0x7000-0x4', iecLocation: '%QX2.3', alias: '' },
  ],
  rxPdos: [
    {
      index: '0x1600',
      name: 'DO PDO',
      assigned: true,
      entries: [
        { index: '0x7000', subIndex: '0x1', bitLen: 1, name: 'DO 1', dataType: 'BOOL' },
        { index: '0x7000', subIndex: '0x2', bitLen: 1, name: 'DO 2', dataType: 'BOOL' },
        { index: '0x7000', subIndex: '0x3', bitLen: 1, name: 'DO 3', dataType: 'BOOL' },
        { index: '0x7000', subIndex: '0x4', bitLen: 1, name: 'DO 4', dataType: 'BOOL' },
      ],
    },
  ],
})

const ur20Coupler = (): ConfiguredEtherCATDevice => ({
  id: 'ur20-fbc',
  position: 1,
  name: 'UR20-FBC-EC',
  esiDeviceRef: { repositoryItemId: 'weidm', deviceIndex: 0 },
  vendorId: '0x230',
  productCode: '0x1',
  revisionNo: '0x1',
  addedFrom: 'repository',
  config: { ...createDefaultSlaveConfig(), coeFlags: { pdoAssign: false, pdoConfig: true, completeAccess: false } },
  channelMappings: [],
  modules: [ur20_4do_p()],
})

const busWithUr20 = (): PLCRemoteDevice[] =>
  [
    {
      name: 'eth_test',
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices: [ur20Coupler()],
      },
    },
  ] as unknown as PLCRemoteDevice[]

describe('UR20 module alias → compile-ready → iomapping → ST (full chain)', () => {
  test('the alias "Valve_2" appears in the alias index pointing at %QX2.1', () => {
    const registry = migrateToRegistry({ remoteDevices: busWithUr20() })
    const aliasIndex = buildAliasIndex(registry)
    expect(aliasIndex.get('Valve_2')).toBe('%QX2.1')
  })

  test('a program variable bound to the alias name resolves to %QX2.1 at compile time', () => {
    const projectData = {
      pous: [
        {
          name: 'main',
          type: 'program' as const,
          language: 'st' as const,
          body: { language: 'st' as const, value: 'Valve_2_var := TRUE;' },
          interface: {
            variables: [
              // Location holds the ALIAS NAME, not a literal %addr — this is the
              // alias binding the editor persists on a program variable.
              {
                name: 'Valve_2_var',
                type: { definition: 'base-type', value: 'BOOL' },
                class: 'local',
                location: 'Valve_2',
              },
            ],
          },
        },
      ],
      remoteDevices: busWithUr20(),
      configurations: { resource: { globalVariables: [] } },
    } as unknown as Parameters<typeof resolveProjectAliases>[0]

    const registry = migrateToRegistry({ remoteDevices: projectData.remoteDevices })
    const resolved = resolveProjectAliases(projectData, buildAliasIndex(registry))

    const pou = resolved.pous[0]!
    const v = pou.interface!.variables[0]!
    expect(v.name).toBe('Valve_2_var')
    expect(v.location).toBe('%QX2.1')
  })

  test('generateEtherdogConfigs emits an iomapping row linking the module PDO entry to %QX2.1', () => {
    const result = generateEtherdogConfigs(busWithUr20())
    if (result === null) throw new Error('generator returned null')
    const iomapping = JSON.parse(result.iomapping) as {
      masters: { entries: { slave: number; index: string; subindex: number; iec_location: string }[] }[]
    }
    const entries = iomapping.masters[0]!.entries
    const forDO2 = entries.find((e) => e.index === '0x7000' && e.subindex === 2)
    expect(forDO2).toBeDefined()
    expect(forDO2!.iec_location).toBe('%QX2.1')
    expect(forDO2!.slave).toBe(1)
  })

  test('transpileToSt declares the variable AT %QX2.1 after alias resolution', () => {
    const registry = migrateToRegistry({ remoteDevices: busWithUr20() })
    const transpileProject: TranspileProject = {
      dataTypes: [],
      pous: [
        {
          name: 'main',
          pouType: 'program',
          interface: {
            variables: [
              {
                name: 'Valve_2_var',
                type: { definition: 'base-type', value: 'BOOL' },
                class: 'local',
                location: 'Valve_2',
              },
            ],
          },
          body: { language: 'st', value: 'Valve_2_var := TRUE;' },
        },
      ],
      configuration: { tasks: [], instances: [], globalVariables: [] },
    }

    // Resolve aliases on the ST transpiler's input — exactly what the editor
    // does before handing the project to the pipeline.
    const aliasIndex = buildAliasIndex(registry)
    for (const pou of transpileProject.pous) {
      for (const v of pou.interface.variables) {
        if (v.location && !v.location.startsWith('%')) {
          v.location = aliasIndex.get(v.location) ?? ''
        }
      }
    }

    const result = transpileToSt(transpileProject)
    expect(result.errors).toEqual([])
    expect(result.programSt).not.toBeNull()
    expect(result.programSt!).toMatch(/Valve_2_var\s+AT\s+%QX2\.1\s*:\s*BOOL\s*;/)
  })
})
