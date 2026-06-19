import type {
  OpcUaFieldConfig,
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaServerConfig,
  PLCServer,
} from '@root/middleware/shared/ports/open-plc-types'

import { generateOpcUaConfig, OPCUA_CONFIG_FORMAT_VERSION, validateOpcUaConfig } from '../generate-opcua-config'
import { OpcUaConfigError } from '../resolve-indices'
import * as resolveIndices from '../resolve-indices'
import type { PLCInstanceInfo } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const perm: OpcUaPermissions = { viewer: 'r', operator: 'rw', engineer: 'rw' }

const makeNode = (overrides: Partial<OpcUaNodeConfig> = {}): OpcUaNodeConfig => ({
  id: 'n1',
  pouName: 'MAIN',
  variablePath: 'MY_VAR',
  variableType: 'INT',
  nodeId: 'ns=1;s=MY_VAR',
  browseName: 'MY_VAR',
  displayName: 'My Variable',
  description: 'desc',
  permissions: perm,
  nodeType: 'variable',
  ...overrides,
})

const makeField = (overrides: Partial<OpcUaFieldConfig> = {}): OpcUaFieldConfig => ({
  fieldPath: 'FIELD1',
  displayName: 'Field 1',
  permissions: perm,
  ...overrides,
})

const baseServerConfig = (): OpcUaServerConfig => ({
  server: {
    enabled: true,
    name: 'TestServer',
    applicationUri: 'urn:test:server',
    productUri: 'urn:test:product',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc',
  },
  securityProfiles: [
    {
      id: 'sp1',
      name: 'None-None',
      enabled: true,
      securityPolicy: 'None',
      securityMode: 'None',
      authMethods: ['Anonymous'],
    },
  ],
  security: {
    serverCertificateStrategy: 'auto_self_signed',
    serverCertificateCustom: null,
    serverPrivateKeyCustom: null,
    trustedClientCertificates: [],
  },
  users: [],
  cycleTimeMs: 100,
  addressSpace: { namespaceUri: 'urn:test:ns', nodes: [] },
})

const makePLCServer = (config: OpcUaServerConfig): PLCServer => ({
  name: 'opcua_server',
  protocol: 'opcua' as const,
  opcuaServerConfig: config,
})

/**
 * Build a minimal debug-map.json string from a list of leaves. Caller
 * supplies (path, type, arr, elem); size defaults to 2.
 */
const debugMapJson = (
  leaves: Array<{ path: string; type: string; arr: number; elem: number; size?: number }>,
): string =>
  JSON.stringify({
    version: 2,
    md5: 'deadbeef',
    typeTags: { BOOL: 0, INT: 3, REAL: 9 },
    arrays: [{ index: 0, count: leaves.length }],
    leaves: leaves.map((l) => ({
      arrayIdx: l.arr,
      elemIdx: l.elem,
      path: l.path,
      type: l.type,
      size: l.size ?? 2,
    })),
  })

const instances: PLCInstanceInfo[] = [{ name: 'INSTANCE0', task: 'TASK0', program: 'MAIN' }]

// parseDebugMap was an OPC-UA-specific re-export. The underlying
// JSON parser + leaf-path Map construction now live in debug-parser.ts
// (parseDebugMap + buildLeafPathMap) — covered by the debugger's own
// tests. The end-to-end behaviour (malformed JSON / wrong version
// gracefully degrade to "no variables") is exercised by the
// generateOpcUaConfig and validateOpcUaConfig flows below.

// ---------------------------------------------------------------------------
// generateOpcUaConfig
// ---------------------------------------------------------------------------

describe('generateOpcUaConfig', () => {
  it('returns null when servers is undefined', () => {
    expect(generateOpcUaConfig(undefined, debugMapJson([]), [])).toBeNull()
  })

  it('returns null when servers is empty', () => {
    expect(generateOpcUaConfig([], debugMapJson([]), [])).toBeNull()
  })

  it('returns null when no opcua server is enabled', () => {
    const cfg = baseServerConfig()
    cfg.server.enabled = false
    expect(generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])).toBeNull()
  })

  it('returns null when server has no opcuaServerConfig', () => {
    const server: PLCServer = {
      name: 'opcua_server',
      protocol: 'opcua' as const,
      opcuaServerConfig: undefined as unknown as OpcUaServerConfig,
    }
    expect(generateOpcUaConfig([server], debugMapJson([]), [])).toBeNull()
  })

  it('throws when debug map is empty but address space has nodes', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode()]
    expect(() => generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), instances)).toThrow(OpcUaConfigError)
  })

  it('maps server settings to snake_case runtime format', () => {
    const cfg = baseServerConfig()
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{ config: { server: { endpoint_url: string; application_uri: string } } }>
    expect(parsed[0].config.server.endpoint_url).toBe('opc.tcp://0.0.0.0:4840/openplc')
    expect(parsed[0].config.server.application_uri).toBe('urn:test:server')
  })

  it('stamps the contract format_version so the runtime can gate old configs', () => {
    const cfg = baseServerConfig()
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{ config: { format_version: number } }>
    expect(parsed[0].config.format_version).toBe(OPCUA_CONFIG_FORMAT_VERSION)
  })

  it('emits canonical datatype + size for a simple variable from the debug map (not the stored type)', () => {
    const cfg = baseServerConfig()
    // Stored variableType is INT, but the compiler says the leaf is a
    // 4-byte DINT — the runtime must encode 4 bytes, so the emitted
    // datatype/size come from the debug map, not the stored type.
    cfg.addressSpace.nodes = [makeNode({ pouName: 'GVL', variablePath: 'COUNTER', variableType: 'INT' })]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'COUNTER', type: 'DINT', arr: 0, elem: 1, size: 4 }]),
      [],
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { variables: Array<{ datatype: string; size: number; arr: number; elem: number }> } }
    }>
    expect(parsed[0].config.address_space.variables[0]).toMatchObject({
      datatype: 'DINT',
      size: 4,
      arr: 0,
      elem: 1,
    })
  })

  it('filters disabled security profiles', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles.push({
      id: 'sp2',
      name: 'Disabled',
      enabled: false,
      securityPolicy: 'Basic256Sha256',
      securityMode: 'Sign',
      authMethods: ['Username'],
    })
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{
      config: { server: { security_profiles: Array<{ name: string; enabled: boolean }> } }
    }>
    const profiles = parsed[0].config.server.security_profiles
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('None-None')
  })

  it('maps security config with trusted certificates', () => {
    const cfg = baseServerConfig()
    cfg.security.trustedClientCertificates = [{ id: 'c1', pem: '-----BEGIN-----\n...' }]
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{
      config: { security: { trusted_client_certificates: Array<{ id: string; pem: string }> } }
    }>
    expect(parsed[0].config.security.trusted_client_certificates).toEqual([{ id: 'c1', pem: '-----BEGIN-----\n...' }])
  })

  it('maps users config', () => {
    const cfg = baseServerConfig()
    cfg.users = [
      {
        id: 'u1',
        type: 'password',
        username: 'admin',
        passwordHash: '$2b$x',
        certificateId: null,
        role: 'engineer',
      },
    ]
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{
      config: { users: Array<{ username: string; role: string }> }
    }>
    expect(parsed[0].config.users[0].username).toBe('admin')
    expect(parsed[0].config.users[0].role).toBe('engineer')
  })

  it('maps cycle_time_ms and namespace_uri', () => {
    const cfg = baseServerConfig()
    cfg.cycleTimeMs = 250
    const json = generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([]), [])!
    const parsed = JSON.parse(json) as Array<{
      config: { cycle_time_ms: number; address_space: { namespace_uri: string } }
    }>
    expect(parsed[0].config.cycle_time_ms).toBe(250)
    expect(parsed[0].config.address_space.namespace_uri).toBe('urn:test:ns')
  })

  it('resolves a variable node in address space', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ pouName: 'MAIN', variablePath: 'X', variableType: 'INT' })]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.X', type: 'INT', arr: 0, elem: 7 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { variables: Array<{ arr: number; elem: number; datatype: string }> } }
    }>
    expect(parsed[0].config.address_space.variables[0]).toMatchObject({ arr: 0, elem: 7, datatype: 'INT' })
  })

  it('resolves a structure node with flat leaf fields', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'SENSOR',
        fields: [makeField({ fieldPath: 'A', datatype: 'INT' }), makeField({ fieldPath: 'B', datatype: 'REAL' })],
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([
        { path: 'INSTANCE0.SENSOR.A', type: 'INT', arr: 0, elem: 1 },
        { path: 'INSTANCE0.SENSOR.B', type: 'REAL', arr: 0, elem: 2 },
      ]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: {
        address_space: {
          structures: Array<{ fields: Array<{ name: string; arr: number; elem: number }> }>
        }
      }
    }>
    expect(parsed[0].config.address_space.structures[0].fields).toHaveLength(2)
    expect(parsed[0].config.address_space.structures[0].fields[0]).toMatchObject({ name: 'A', arr: 0, elem: 1 })
  })

  it('resolves a structure with nested fields', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'OUTER',
        fields: [
          makeField({
            fieldPath: 'TON0',
            datatype: 'TON',
            fields: [
              makeField({ fieldPath: 'IN', datatype: 'BOOL' }),
              makeField({ fieldPath: 'ET', datatype: 'TIME' }),
            ],
          }),
        ],
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([
        { path: 'INSTANCE0.OUTER.TON0.IN', type: 'BOOL', arr: 0, elem: 10 },
        { path: 'INSTANCE0.OUTER.TON0.ET', type: 'TIME', arr: 0, elem: 11 },
      ]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: {
        address_space: {
          structures: Array<{
            fields: Array<{
              name: string
              arr: number | null
              elem: number | null
              fields?: Array<{ name: string; arr: number; elem: number }>
            }>
          }>
        }
      }
    }>
    const top = parsed[0].config.address_space.structures[0].fields[0]
    expect(top.arr).toBeNull()
    expect(top.elem).toBeNull()
    expect(top.fields).toHaveLength(2)
    expect(top.fields![0]).toMatchObject({ name: 'IN', arr: 0, elem: 10 })
  })

  it('resolves a simple array node', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'PROFILE',
        variableType: 'ARRAY[1..3] OF INT',
        arrayLength: 3,
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.PROFILE[0]', type: 'INT', arr: 0, elem: 50 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: {
        address_space: {
          arrays: Array<{ datatype: string; length: number; arr: number; elem: number }>
        }
      }
    }>
    expect(parsed[0].config.address_space.arrays[0]).toMatchObject({
      datatype: 'INT',
      length: 3,
      arr: 0,
      elem: 50,
    })
  })

  it('extracts element type from variableType when elementType not set', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'TABLE',
        variableType: 'ARRAY[1..2] OF real',
        arrayLength: 2,
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.TABLE[0]', type: 'REAL', arr: 0, elem: 8 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { arrays: Array<{ datatype: string }> } }
    }>
    expect(parsed[0].config.address_space.arrays[0].datatype).toBe('REAL')
  })

  it('uses the canonical element type/size from the debug map, ignoring the stored variableType', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'WEIRD',
        variableType: 'WEIRD_TYPE', // stored type is bogus — must be ignored
        arrayLength: 1,
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.WEIRD[0]', type: 'DINT', arr: 0, elem: 1, size: 4 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { arrays: Array<{ datatype: string; size: number }> } }
    }>
    expect(parsed[0].config.address_space.arrays[0]).toMatchObject({ datatype: 'DINT', size: 4 })
  })

  it('uses the canonical element type even when the stored variableType is empty', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A',
        variableType: '',
        arrayLength: 1,
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.A[0]', type: 'INT', arr: 0, elem: 0, size: 2 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { arrays: Array<{ datatype: string; size: number }> } }
    }>
    expect(parsed[0].config.address_space.arrays[0]).toMatchObject({ datatype: 'INT', size: 2 })
  })

  it('defaults arrayLength to 1 when not set', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ nodeType: 'array', variablePath: 'A', variableType: 'ARRAY[1..1] OF INT' })]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.A[0]', type: 'INT', arr: 0, elem: 0 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: { address_space: { arrays: Array<{ length: number }> } }
    }>
    expect(parsed[0].config.address_space.arrays[0].length).toBe(1)
  })

  it('treats array with fields as structure (heterogeneous element types)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A',
        fields: [makeField({ fieldPath: 'EF', datatype: 'INT' })],
      }),
    ]
    const json = generateOpcUaConfig(
      [makePLCServer(cfg)],
      debugMapJson([{ path: 'INSTANCE0.A.EF', type: 'INT', arr: 0, elem: 1 }]),
      instances,
    )!
    const parsed = JSON.parse(json) as Array<{
      config: {
        address_space: {
          arrays: unknown[]
          structures: unknown[]
        }
      }
    }>
    // Promotes from arrays[] to structures[] when fields are present
    expect(parsed[0].config.address_space.structures.length).toBe(1)
    expect(parsed[0].config.address_space.arrays.length).toBe(0)
  })

  it('collects multiple OpcUaConfigErrors and throws combined', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ pouName: 'MAIN', variablePath: 'GHOST_A' }),
      makeNode({ pouName: 'MAIN', variablePath: 'GHOST_B' }),
    ]
    expect(() =>
      generateOpcUaConfig([makePLCServer(cfg)], debugMapJson([{ path: 'X', type: 'INT', arr: 0, elem: 0 }]), instances),
    ).toThrow(/Failed to resolve 2 OPC-UA variable/)
  })

  it('re-throws non-OpcUaConfigError from address space building', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode()]
    const spy = jest.spyOn(resolveIndices, 'resolveVariableAddress').mockImplementation(() => {
      throw new TypeError('boom')
    })
    try {
      expect(() =>
        generateOpcUaConfig(
          [makePLCServer(cfg)],
          debugMapJson([{ path: 'X', type: 'INT', arr: 0, elem: 0 }]),
          instances,
        ),
      ).toThrow('boom')
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// validateOpcUaConfig
// ---------------------------------------------------------------------------

describe('validateOpcUaConfig', () => {
  it('returns valid when config is correct', () => {
    const cfg = baseServerConfig()
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports error when no security profiles enabled', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles[0].enabled = false
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('At least one security profile'))).toBe(true)
  })

  it('reports error when username auth enabled but no users configured', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles[0].authMethods = ['Username']
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Username authentication'))).toBe(true)
  })

  it('no username-auth error when users are configured', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles[0].authMethods = ['Username']
    cfg.users = [
      {
        id: 'u1',
        type: 'password',
        username: 'a',
        passwordHash: 'x',
        certificateId: null,
        role: 'viewer',
      },
    ]
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(true)
  })

  it('validates variable node resolution errors', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ pouName: 'MAIN', variablePath: 'GHOST' })]
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  // Field-level resolution misses no longer fail validation: the
  // build silently drops unresolvable fields (e.g. stale library-FB
  // internals saved before the pou-helpers filter) and warns. Top-
  // level variable / simple-array misses still fail — those are the
  // user-renamed-or-deleted-it cases.
  it('field-level resolution misses are NOT validation errors (dropped at build with warning)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ nodeType: 'structure', variablePath: 'S', fields: [makeField({ fieldPath: 'GHOST' })] }),
    ]
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(true)
  })

  it('validates simple array node resolution errors', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ nodeType: 'array', variablePath: 'GHOST_ARR', arrayLength: 3 })]
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(false)
  })

  it('array-with-fields field-level miss is NOT a validation error', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A',
        fields: [makeField({ fieldPath: 'EF' })],
      }),
    ]
    const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
    expect(result.valid).toBe(true)
  })

  it('validates structure node successfully', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'S',
        fields: [makeField({ fieldPath: 'F', datatype: 'INT' })],
      }),
    ]
    const result = validateOpcUaConfig(
      cfg,
      debugMapJson([{ path: 'INSTANCE0.S.F', type: 'INT', arr: 0, elem: 0 }]),
      instances,
    )
    expect(result.valid).toBe(true)
  })

  it('validates simple array node successfully', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ nodeType: 'array', variablePath: 'A', variableType: 'ARRAY[1..3] OF INT', arrayLength: 3 }),
    ]
    const result = validateOpcUaConfig(
      cfg,
      debugMapJson([{ path: 'INSTANCE0.A[0]', type: 'INT', arr: 0, elem: 0 }]),
      instances,
    )
    expect(result.valid).toBe(true)
  })

  it('validates array with fields successfully', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A',
        fields: [makeField({ fieldPath: 'E', datatype: 'INT' })],
      }),
    ]
    const result = validateOpcUaConfig(
      cfg,
      debugMapJson([{ path: 'INSTANCE0.A.E', type: 'INT', arr: 0, elem: 0 }]),
      instances,
    )
    expect(result.valid).toBe(true)
  })

  it('catches non-OpcUaConfigError via getErrorMessage', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode()]
    const spy = jest.spyOn(resolveIndices, 'resolveVariableAddress').mockImplementation(() => {
      throw new TypeError('something else')
    })
    try {
      const result = validateOpcUaConfig(cfg, debugMapJson([]), instances)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('something else'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
