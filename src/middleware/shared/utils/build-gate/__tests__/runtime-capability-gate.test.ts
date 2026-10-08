/**
 * DOPE-704 E7 target-capability gate tests.
 *
 * The gate asks whether EtherDOG as it is advertised can run what the editor is about
 * to build. A plain-slave project needs no new features and must build against every
 * EtherDOG, including pre-R4 that does not advertise anything. A modular-coupler
 * project needs `dynamic_alloc` and `sdo_byte_string`; a byte-string / complete-access
 * SDO (fields reserved on the detector; not yet persisted on the model) will light up
 * the matching feature when the type gains the field.
 *
 * Backward compatibility (BR24) is the one case that gets its own test — the plain
 * project against the pre-R4 silent runtime, which must stay allowed.
 */

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

import {
  evaluateRuntimeCapabilityGate,
  requiredRuntimeFeatures,
  runtimeCapabilityStateFor,
  type RuntimeFeature,
} from '../runtime-capability-gate'

const bus = (
  overrides: Partial<NonNullable<PLCRemoteDevice['ethercatConfig']>['devices'][number]> = {},
): PLCRemoteDevice[] =>
  [
    {
      name: 'bus_a',
      protocol: 'ethercat',
      ethercatConfig: {
        masterConfig: { enabled: true, networkInterface: 'eth0', cycleTimeUs: 1000 },
        devices: [
          {
            id: 'd',
            position: 1,
            name: 'd',
            esiDeviceRef: { repositoryItemId: 'r', deviceIndex: 0 },
            vendorId: '0x1',
            productCode: '0x1',
            revisionNo: '0x1',
            addedFrom: 'repository',
            channelMappings: [],
            ...overrides,
          },
        ],
      },
    },
  ] as unknown as PLCRemoteDevice[]

describe('DOPE-704 E7: requiredRuntimeFeatures', () => {
  test('no remote devices → empty', () => {
    expect(requiredRuntimeFeatures(undefined)).toEqual([])
    expect(requiredRuntimeFeatures([])).toEqual([])
  })

  test('a plain EtherCAT slave with no modules and no SDOs → empty', () => {
    expect(requiredRuntimeFeatures(bus())).toEqual([])
  })

  test('a Modbus TCP remote device never contributes features', () => {
    const remote = [{ name: 'mb', protocol: 'modbus-tcp' as const }] as unknown as PLCRemoteDevice[]
    expect(requiredRuntimeFeatures(remote)).toEqual([])
  })

  test('a modular coupler (modules present) requires dynamic_alloc and sdo_byte_string', () => {
    const devices = bus({
      modules: [
        {
          id: 'slot-1',
          slot: 1,
          name: 'module',
          ident: '0x1',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
          channelMappings: [],
        },
      ],
    })
    expect(requiredRuntimeFeatures(devices)).toEqual(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'])
  })

  test('an SDO entry with valueBytes marks sdo_byte_string', () => {
    const devices = bus({
      // valueBytes field is forward-looking; cast through unknown to simulate what
      // the detector will see when the SDOConfigurationEntry type gains the field.
      sdoConfigurations: [
        {
          index: '0x8000',
          subIndex: 1,
          value: '',
          valueBytes: '0A0B0C',
          defaultValue: '',
          dataType: 'STRING',
          bitLength: 24,
          name: 'ModuleName',
          objectName: 'DeviceId',
        },
      ] as unknown as NonNullable<Parameters<typeof bus>[0]>['sdoConfigurations'],
    })
    expect(requiredRuntimeFeatures(devices)).toEqual(['ethercat.sdo_byte_string'])
  })

  test('an SDO entry with completeAccess marks sdo_complete_access', () => {
    const devices = bus({
      sdoConfigurations: [
        {
          index: '0x8000',
          subIndex: 0,
          value: '0',
          completeAccess: true,
          defaultValue: '',
          dataType: 'RECORD',
          bitLength: 128,
          name: 'Record',
          objectName: 'Group',
        },
      ] as unknown as NonNullable<Parameters<typeof bus>[0]>['sdoConfigurations'],
    })
    expect(requiredRuntimeFeatures(devices)).toEqual(['ethercat.sdo_complete_access'])
  })

  test('a module SDO entry contributes just like a slave SDO entry', () => {
    const devices = bus({
      modules: [
        {
          id: 'slot-1',
          slot: 1,
          name: 'module',
          ident: '0x1',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
          channelMappings: [],
          sdoConfigurations: [
            {
              index: '0x8010',
              subIndex: 3,
              value: '',
              valueBytes: '55523230',
              defaultValue: '',
              dataType: 'STRING',
              bitLength: 32,
              name: 'ModuleName',
              objectName: 'DeviceId',
            },
          ],
        },
      ] as unknown as NonNullable<Parameters<typeof bus>[0]>['modules'],
    })
    // dynamic_alloc + sdo_byte_string from the module's presence AND its byte-string
    // SDO. The dedupe keeps the list minimal.
    expect(requiredRuntimeFeatures(devices)).toEqual(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'])
  })

  test('returns a stable, sorted list', () => {
    const devices = bus({
      modules: [
        {
          id: 's',
          slot: 1,
          name: 's',
          ident: '0x1',
          esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
          channelMappings: [],
          sdoConfigurations: [
            {
              index: '0x8000',
              subIndex: 0,
              value: '0',
              completeAccess: true,
              defaultValue: '',
              dataType: 'RECORD',
              bitLength: 128,
              name: 'r',
              objectName: 'g',
            },
          ],
        },
      ] as unknown as NonNullable<Parameters<typeof bus>[0]>['modules'],
    })
    const features = requiredRuntimeFeatures(devices)
    expect(features).toEqual([...features].sort())
  })
})

describe('DOPE-704 E7: evaluateRuntimeCapabilityGate', () => {
  const alloc = (advertisedFeatures: RuntimeFeature[] | undefined, runtimeVersion?: string) => ({
    advertisement: { advertisedFeatures, runtimeVersion },
  })

  test('empty requirements → allow regardless of advertisement', () => {
    expect(evaluateRuntimeCapabilityGate({ requiredFeatures: [], ...alloc(undefined) })).toEqual({ kind: 'allow' })
    expect(
      evaluateRuntimeCapabilityGate({
        requiredFeatures: [],
        ...alloc(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string', 'ethercat.sdo_complete_access']),
      }),
    ).toEqual({ kind: 'allow' })
  })

  test('BR24: plain-slave project (no required features) builds against a pre-R4 silent runtime', () => {
    expect(evaluateRuntimeCapabilityGate({ requiredFeatures: [], ...alloc(undefined) })).toEqual({ kind: 'allow' })
  })

  test('required features present on the runtime → allow', () => {
    expect(
      evaluateRuntimeCapabilityGate({
        requiredFeatures: ['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'],
        ...alloc(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string', 'ethercat.scan_modules']),
      }),
    ).toEqual({ kind: 'allow' })
  })

  test('pre-R4 runtime refuses a modular-coupler project with the version-upgrade message', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: ['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'],
      ...alloc(undefined, '4.2.11'),
    })
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.missing).toEqual(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'])
    expect(verdict.reason).toContain('ethercat.dynamic_alloc')
    expect(verdict.reason).toContain('ethercat.sdo_byte_string')
    expect(verdict.reason).toContain('4.2.11')
    expect(verdict.reason).toContain('Upgrade EtherDOG')
  })

  test('runtime missing one of two features: refuse naming only the missing one', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: ['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'],
      ...alloc(['ethercat.dynamic_alloc'], '0.1.0'),
    })
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.missing).toEqual(['ethercat.sdo_byte_string'])
    expect(verdict.reason).toContain('ethercat.sdo_byte_string')
    expect(verdict.reason).not.toContain('ethercat.dynamic_alloc,')
  })

  test('refusal without runtime version falls back to the reconnect phrasing', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: ['ethercat.dynamic_alloc'],
      ...alloc([]),
    })
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.reason).toContain('reconnect')
    expect(verdict.reason).not.toContain('(current:')
  })
})

describe('DOPE-704 E7: runtimeCapabilityStateFor', () => {
  test('composes requiredFeatures from the project and advertisement from the hello', () => {
    const state = runtimeCapabilityStateFor({
      remoteDevices: bus({
        modules: [
          {
            id: 's',
            slot: 1,
            name: 's',
            ident: '0x1',
            esiModuleRef: { repositoryItemId: 'r', moduleIdent: '0x1' },
            channelMappings: [],
          },
        ] as unknown as NonNullable<Parameters<typeof bus>[0]>['modules'],
      }),
      advertisement: { advertisedFeatures: ['ethercat.dynamic_alloc'], runtimeVersion: '0.1.0' },
    })
    expect(state.requiredFeatures).toEqual(['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'])
    expect(state.advertisement.advertisedFeatures).toEqual(['ethercat.dynamic_alloc'])
    // One refusal, named, so the compile step can bubble it unchanged.
    const verdict = evaluateRuntimeCapabilityGate(state)
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.missing).toEqual(['ethercat.sdo_byte_string'])
  })
})
