import {
  evaluateRuntimeCapabilityGate,
  MIN_ETHERDOG_VERSION,
  type RemoteDeviceInput,
  requiredRuntimeFeatures,
  runtimeCapabilityStateFor,
} from '../runtime-capability-gate'

type Slave = NonNullable<NonNullable<RemoteDeviceInput['ethercatConfig']>['devices']>[number]

const bus = (...devices: Slave[]): RemoteDeviceInput[] => [{ protocol: 'ethercat', ethercatConfig: { devices } }]

const flags = (completeAccess: boolean, pdoAssign = false, pdoConfig = false) => ({
  config: { coeFlags: { pdoAssign, pdoConfig, completeAccess } },
})

const pdo = (over: { assigned?: boolean; fixed?: boolean; entries?: unknown[] } = {}) => ({
  entries: over.entries ?? [{}],
  ...over,
})

describe('requiredRuntimeFeatures', () => {
  test('nothing for no devices, other protocols, or a plain slave without new features', () => {
    expect(requiredRuntimeFeatures(undefined)).toEqual([])
    expect(requiredRuntimeFeatures([{ protocol: 'modbus-tcp' }])).toEqual([])
    expect(requiredRuntimeFeatures(bus({ ...flags(false, true, true), rxPdos: [pdo()] }))).toEqual([])
  })

  test('a modular coupler needs dynamic allocation', () => {
    expect(requiredRuntimeFeatures(bus({ modules: [{}] }))).toEqual(['ethercat.dynamic_alloc'])
  })

  test('a byte payload anywhere (user SDO, ESI InitCmd, module InitCmd) needs byte strings', () => {
    for (const device of [
      { sdoConfigurations: [{ valueBytes: '0x01' }] },
      { esiInitCmdSdos: [{ valueBytes: '0x08' }] },
      { modules: [{ sdoConfigurations: [{ valueBytes: '0x4142' }] }] },
    ]) {
      expect(requiredRuntimeFeatures(bus(device))).toContain('ethercat.sdo_byte_string')
    }
    expect(requiredRuntimeFeatures(bus({ sdoConfigurations: [{ valueBytes: '' }] }))).toEqual([])
  })

  test('an SDO flagged Complete Access needs Complete Access', () => {
    expect(requiredRuntimeFeatures(bus({ sdoConfigurations: [{ completeAccess: true }] }))).toEqual([
      'ethercat.sdo_complete_access',
    ])
  })

  test('with CompleteAccess the generated assignment, mapping rewrite and module list are CA byte writes', () => {
    const ca = ['ethercat.sdo_byte_string', 'ethercat.sdo_complete_access']
    expect(requiredRuntimeFeatures(bus({ ...flags(true, true), txPdos: [pdo({ fixed: true })] }))).toEqual(ca)
    expect(requiredRuntimeFeatures(bus({ ...flags(true, false, true), rxPdos: [pdo()] }))).toEqual(ca)
    expect(
      requiredRuntimeFeatures(bus({ ...flags(true), modules: [{}], slotsSpec: { downloadModuleIdentList: true } })),
    ).toEqual(['ethercat.dynamic_alloc', ...ca])
  })

  test('CompleteAccess alone writes nothing: fixed, unassigned or empty PDOs and no module list', () => {
    expect(
      requiredRuntimeFeatures(
        bus({
          ...flags(true, false, true),
          rxPdos: [pdo({ fixed: true }), pdo({ assigned: false }), pdo({ entries: [] })],
        }),
      ),
    ).toEqual([])
    expect(requiredRuntimeFeatures(bus({ ...flags(true), modules: [{}] }))).toEqual(['ethercat.dynamic_alloc'])
  })
})

describe('evaluateRuntimeCapabilityGate', () => {
  const required = ['ethercat.dynamic_alloc', 'ethercat.sdo_byte_string'] as const

  test('a project needing nothing builds against any runtime', () => {
    expect(
      evaluateRuntimeCapabilityGate({
        requiredFeatures: [],
        advertisement: { connected: true, advertisedFeatures: undefined },
      }),
    ).toEqual({ kind: 'allow' })
  })

  test('offline build is allowed with a warning naming the EtherDOG version', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: required,
      advertisement: { connected: false, advertisedFeatures: undefined },
    })
    expect(verdict).toEqual({
      kind: 'allow',
      warning: expect.stringContaining(`requires EtherDOG ${MIN_ETHERDOG_VERSION} or newer`),
    })
  })

  test('a connected runtime advertising every feature allows', () => {
    expect(
      evaluateRuntimeCapabilityGate({
        requiredFeatures: required,
        advertisement: { connected: true, advertisedFeatures: [...required, 'ethercat.future_thing'] },
      }),
    ).toEqual({ kind: 'allow' })
  })

  test('a runtime without the features array refuses with every required feature', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: required,
      advertisement: { connected: true, advertisedFeatures: undefined },
    })
    expect(verdict).toEqual({
      kind: 'refuse',
      reason: expect.stringContaining('1.0.0 or newer'),
      missing: [...required],
    })
  })

  test('features that could not be read refuse with the reason, not as missing features', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: required,
      advertisement: {
        connected: true,
        advertisedFeatures: undefined,
        unavailableReason: 'EtherDOG is not running on the target',
      },
    })
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.reason).toMatch(/could not be read: EtherDOG is not running on the target/)
    expect(verdict.reason).not.toMatch(/does not provide/)
    expect(verdict.missing).toEqual([...required])
  })

  test('an unread advertisement does not matter for a project without new features', () => {
    expect(
      evaluateRuntimeCapabilityGate({
        requiredFeatures: [],
        advertisement: { connected: true, advertisedFeatures: undefined, unavailableReason: 'timeout' },
      }),
    ).toEqual({ kind: 'allow' })
  })

  test('a runtime missing one feature is refused naming only that one', () => {
    const verdict = evaluateRuntimeCapabilityGate({
      requiredFeatures: required,
      advertisement: { connected: true, advertisedFeatures: ['ethercat.dynamic_alloc'] },
    })
    expect(verdict.kind).toBe('refuse')
    if (verdict.kind !== 'refuse') return
    expect(verdict.missing).toEqual(['ethercat.sdo_byte_string'])
    expect(verdict.reason).toMatch(/byte-string startup SDOs/)
    expect(verdict.reason).not.toMatch(/modular couplers/)
  })
})

describe('runtimeCapabilityStateFor', () => {
  test('pairs the project requirements with the advertisement', () => {
    const advertisement = { connected: true, advertisedFeatures: ['ethercat.dynamic_alloc'] }
    expect(runtimeCapabilityStateFor({ remoteDevices: bus({ modules: [{}] }), advertisement })).toEqual({
      requiredFeatures: ['ethercat.dynamic_alloc'],
      advertisement,
    })
  })
})
