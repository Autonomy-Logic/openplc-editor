import type {
  OpcUaFieldConfig,
  OpcUaNodeConfig,
  OpcUaPermissions,
  OpcUaServerConfig,
  PLCServer,
} from '@root/middleware/shared/ports/open-plc-types'

import { generateOpcUaConfig, parseDebugFile, validateOpcUaConfig } from '../generate-opcua-config'
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
  initialValue: 0,
  permissions: perm,
  nodeType: 'variable',
  ...overrides,
})

const makeField = (overrides: Partial<OpcUaFieldConfig> = {}): OpcUaFieldConfig => ({
  fieldPath: 'FIELD1',
  displayName: 'Field 1',
  initialValue: 0,
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

const debugContent = (entries: Array<{ path: string; type: string }>): string => {
  const vars = entries.map((e) => `{ &(${e.path}), ${e.type} }`).join(',\n  ')
  return `debug_vars[] = {\n  ${vars}\n};`
}

const instances: PLCInstanceInfo[] = [{ name: 'INSTANCE0', task: 'TASK0', program: 'MAIN' }]

// ---------------------------------------------------------------------------
// parseDebugFile
// ---------------------------------------------------------------------------

describe('parseDebugFile', () => {
  it('parses valid debug.c entries', () => {
    const content = debugContent([
      { path: 'RES0__INSTANCE0.X', type: 'INT_ENUM' },
      { path: 'CONFIG0__G', type: 'BOOL_ENUM' },
    ])
    const result = parseDebugFile(content)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: 'RES0__INSTANCE0.X', type: 'INT_ENUM', index: 0 })
    expect(result[1]).toEqual({ name: 'CONFIG0__G', type: 'BOOL_ENUM', index: 1 })
  })

  it('returns empty array when debug_vars not found', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    expect(parseDebugFile('// nothing')).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('Could not find debug_vars[] array in debug.c')
    warnSpy.mockRestore()
  })

  it('returns empty array when debug_vars block has no entries', () => {
    expect(parseDebugFile('debug_vars[] = {\n};')).toEqual([])
  })

  it('handles whitespace variations around &(...)', () => {
    const content = 'debug_vars[] = {\n  {  &( RES0__I.V )  ,  REAL_ENUM  }\n};'
    const result = parseDebugFile(content)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('RES0__I.V')
  })
})

// ---------------------------------------------------------------------------
// generateOpcUaConfig - early exits
// ---------------------------------------------------------------------------

describe('generateOpcUaConfig', () => {
  it('returns null when servers is undefined', () => {
    expect(generateOpcUaConfig(undefined, '', [])).toBeNull()
  })

  it('returns null when servers is empty', () => {
    expect(generateOpcUaConfig([], '', [])).toBeNull()
  })

  it('returns null when no opcua server is enabled', () => {
    const cfg = baseServerConfig()
    cfg.server.enabled = false
    expect(generateOpcUaConfig([makePLCServer(cfg)], '', [])).toBeNull()
  })

  it('returns null when server has no opcuaServerConfig', () => {
    const srv: PLCServer[] = [{ name: 'test', protocol: 'opcua' as const }]
    expect(generateOpcUaConfig(srv, '', [])).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Debug empty but nodes present (line 426)
  // ---------------------------------------------------------------------------

  it('throws when debug is empty but address space has nodes (line 426)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode()]
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    expect(() => generateOpcUaConfig([makePLCServer(cfg)], '// no vars', instances)).toThrow(
      'Cannot resolve OPC-UA variable indices',
    )
    warnSpy.mockRestore()
  })

  // ---------------------------------------------------------------------------
  // Server config mapping
  // ---------------------------------------------------------------------------

  it('maps server settings to snake_case runtime format', () => {
    const cfg = baseServerConfig()
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], debugContent([]), [])!)
    const s = result[0].config.server
    expect(s.name).toBe('TestServer')
    expect(s.application_uri).toBe('urn:test:server')
    expect(s.product_uri).toBe('urn:test:product')
    expect(s.endpoint_url).toBe('opc.tcp://0.0.0.0:4840/openplc')
  })

  it('filters disabled security profiles', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles = [
      { id: 'sp1', name: 'A', enabled: true, securityPolicy: 'None', securityMode: 'None', authMethods: ['Anonymous'] },
      { id: 'sp2', name: 'B', enabled: false, securityPolicy: 'Basic256', securityMode: 'Sign', authMethods: ['Username'] },
    ]
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], debugContent([]), [])!)
    expect(result[0].config.server.security_profiles).toHaveLength(1)
    expect(result[0].config.server.security_profiles[0].name).toBe('A')
  })

  // ---------------------------------------------------------------------------
  // Security config with trusted certificates (line 159)
  // ---------------------------------------------------------------------------

  it('maps security config with trusted certificates (line 159)', () => {
    const cfg = baseServerConfig()
    cfg.security = {
      serverCertificateStrategy: 'custom',
      serverCertificateCustom: 'CERT',
      serverPrivateKeyCustom: 'KEY',
      trustedClientCertificates: [{ id: 'c1', pem: 'PEM1' }, { id: 'c2', pem: 'PEM2' }],
    }
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], debugContent([]), [])!)
    const sec = result[0].config.security
    expect(sec.server_certificate_strategy).toBe('custom')
    expect(sec.server_certificate_custom).toBe('CERT')
    expect(sec.server_private_key_custom).toBe('KEY')
    expect(sec.trusted_client_certificates).toEqual([
      { id: 'c1', pem: 'PEM1' },
      { id: 'c2', pem: 'PEM2' },
    ])
  })

  // ---------------------------------------------------------------------------
  // Users config mapping
  // ---------------------------------------------------------------------------

  it('maps users config', () => {
    const cfg = baseServerConfig()
    cfg.users = [
      { id: 'u1', type: 'password', username: 'admin', passwordHash: 'h', certificateId: null, role: 'engineer' },
      { id: 'u2', type: 'certificate', username: null, passwordHash: null, certificateId: 'c1', role: 'viewer' },
    ]
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], debugContent([]), [])!)
    expect(result[0].config.users).toEqual([
      { type: 'password', username: 'admin', password_hash: 'h', certificate_id: null, role: 'engineer' },
      { type: 'certificate', username: null, password_hash: null, certificate_id: 'c1', role: 'viewer' },
    ])
  })

  // ---------------------------------------------------------------------------
  // cycle_time_ms and namespace_uri
  // ---------------------------------------------------------------------------

  it('maps cycle_time_ms and namespace_uri', () => {
    const cfg = baseServerConfig()
    cfg.cycleTimeMs = 250
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], debugContent([]), [])!)
    expect(result[0].config.cycle_time_ms).toBe(250)
    expect(result[0].config.address_space.namespace_uri).toBe('urn:test:ns')
  })

  // ---------------------------------------------------------------------------
  // Address space: variable node (lines 311-312 switch)
  // ---------------------------------------------------------------------------

  it('resolves a variable node in address space', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ variablePath: 'COUNTER' })]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.COUNTER', type: 'INT_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    const vars = result[0].config.address_space.variables
    expect(vars).toHaveLength(1)
    expect(vars[0]).toMatchObject({ node_id: 'ns=1;s=MY_VAR', browse_name: 'MY_VAR', index: 0, datatype: 'INT' })
  })

  // ---------------------------------------------------------------------------
  // Address space: structure node (lines 316, 246-248, 221-234)
  // ---------------------------------------------------------------------------

  it('resolves a structure node with flat leaf fields (lines 246-248, 221-234)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'SENSOR',
        fields: [
          makeField({ fieldPath: 'X', datatype: 'INT', initialValue: 0 }),
          makeField({ fieldPath: 'Y', datatype: 'REAL', initialValue: 1.5 }),
        ],
      }),
    ]
    const dc = debugContent([
      { path: 'RES0__INSTANCE0.SENSOR.X', type: 'INT_ENUM' },
      { path: 'RES0__INSTANCE0.SENSOR.Y', type: 'REAL_ENUM' },
    ])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    const structs = result[0].config.address_space.structures
    expect(structs).toHaveLength(1)
    expect(structs[0].fields).toHaveLength(2)
    expect(structs[0].fields[0]).toMatchObject({ name: 'X', datatype: 'INT', index: 0 })
    expect(structs[0].fields[1]).toMatchObject({ name: 'Y', datatype: 'REAL', index: 1 })
    expect(structs[0].fields[0].permissions).toEqual({ viewer: 'r', operator: 'rw', engineer: 'rw' })
  })

  it('resolves a structure with nested fields (convertResolvedFieldToRuntime recursive)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'FB',
        fields: [
          makeField({
            fieldPath: 'INNER',
            datatype: 'TON',
            initialValue: '',
            fields: [makeField({ fieldPath: 'LEAF', datatype: 'BOOL', initialValue: false })],
          }),
        ],
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.FB.INNER.LEAF', type: 'BOOL_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    const s = result[0].config.address_space.structures[0]
    expect(s.fields[0].name).toBe('INNER')
    expect(s.fields[0].index).toBeNull()
    expect(s.fields[0].fields).toHaveLength(1)
    expect(s.fields[0].fields[0]).toMatchObject({ name: 'LEAF', index: 0, datatype: 'BOOL' })
  })

  // ---------------------------------------------------------------------------
  // Address space: array node - simple (lines 274-283, 318-326)
  // ---------------------------------------------------------------------------

  it('resolves a simple array node (lines 274-283)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'ARR',
        variableType: 'ARRAY[1..10] OF INT',
        arrayLength: 10,
        elementType: 'INT',
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.ARR.value.table[0]', type: 'INT_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    const arrays = result[0].config.address_space.arrays
    expect(arrays).toHaveLength(1)
    expect(arrays[0]).toMatchObject({ datatype: 'INT', length: 10, index: 0 })
  })

  // ---------------------------------------------------------------------------
  // extractArrayElementType (lines 262-263)
  // ---------------------------------------------------------------------------

  it('extracts element type from variableType when elementType not set (line 262-263)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A2',
        variableType: 'ARRAY[0..4] OF REAL',
        arrayLength: 5,
        // no elementType
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.A2.value.table[0]', type: 'REAL_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    expect(result[0].config.address_space.arrays[0].datatype).toBe('REAL')
  })

  it('returns original variableType when no OF pattern found', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A3',
        variableType: 'CUSTOM_ARRAY',
        arrayLength: 3,
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.A3.value.table[0]', type: 'INT_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    expect(result[0].config.address_space.arrays[0].datatype).toBe('CUSTOM_ARRAY')
  })

  it('uses UNKNOWN when no elementType and variableType is empty', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'A4',
        variableType: '',
        arrayLength: 1,
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.A4.value.table[0]', type: 'INT_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    expect(result[0].config.address_space.arrays[0].datatype).toBe('UNKNOWN')
  })

  it('defaults arrayLength to 1 when not set', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ nodeType: 'array', variablePath: 'A5', variableType: 'ARRAY[1..1] OF BOOL', elementType: 'BOOL' }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.A5.value.table[0]', type: 'BOOL_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    expect(result[0].config.address_space.arrays[0].length).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // Address space: array with fields treated as structure (lines 321-322)
  // ---------------------------------------------------------------------------

  it('treats array with fields as structure (lines 321-322)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'FBA',
        fields: [makeField({ fieldPath: 'EF', datatype: 'INT', initialValue: 0 })],
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.FBA.EF', type: 'INT_ENUM' }])
    const result = JSON.parse(generateOpcUaConfig([makePLCServer(cfg)], dc, instances)!)
    expect(result[0].config.address_space.structures).toHaveLength(1)
    expect(result[0].config.address_space.arrays).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Error collection and aggregation (lines 329-333, 340-341)
  // ---------------------------------------------------------------------------

  it('collects multiple OpcUaConfigErrors and throws combined (lines 340-341)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ id: 'n1', variablePath: 'MISS1', nodeType: 'variable' }),
      makeNode({ id: 'n2', variablePath: 'MISS2', nodeType: 'variable' }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.OTHER', type: 'INT_ENUM' }])
    expect(() => generateOpcUaConfig([makePLCServer(cfg)], dc, instances)).toThrow(
      'Failed to resolve 2 OPC-UA variable(s)',
    )
  })

  it('re-throws non-OpcUaConfigError from address space building (line 333)', () => {
    const spy = jest.spyOn(resolveIndices, 'resolveVariableIndex').mockImplementation(() => {
      throw new TypeError('unexpected crash')
    })
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ variablePath: 'X', nodeType: 'variable' })]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.X', type: 'INT_ENUM' }])
    expect(() => generateOpcUaConfig([makePLCServer(cfg)], dc, instances)).toThrow(TypeError)
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// validateOpcUaConfig (lines 484-499)
// ---------------------------------------------------------------------------

describe('validateOpcUaConfig', () => {
  it('returns valid when config is correct', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ variablePath: 'X' })]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.X', type: 'INT_ENUM' }])
    expect(validateOpcUaConfig(cfg, dc, instances)).toEqual({ valid: true, errors: [] })
  })

  it('reports error when no security profiles enabled', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles = [
      { id: 'sp1', name: 'A', enabled: false, securityPolicy: 'None', securityMode: 'None', authMethods: ['Anonymous'] },
    ]
    const result = validateOpcUaConfig(cfg, debugContent([]), [])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('At least one security profile must be enabled')
  })

  it('reports error when username auth enabled but no users configured', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles = [
      { id: 'sp1', name: 'A', enabled: true, securityPolicy: 'None', securityMode: 'None', authMethods: ['Username'] },
    ]
    cfg.users = []
    const result = validateOpcUaConfig(cfg, debugContent([]), [])
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Username authentication is enabled but no users are configured')
  })

  it('no username-auth error when users are configured', () => {
    const cfg = baseServerConfig()
    cfg.securityProfiles = [
      { id: 'sp1', name: 'A', enabled: true, securityPolicy: 'None', securityMode: 'None', authMethods: ['Username'] },
    ]
    cfg.users = [{ id: 'u1', type: 'password', username: 'a', passwordHash: 'h', certificateId: null, role: 'engineer' }]
    const result = validateOpcUaConfig(cfg, debugContent([]), [])
    expect(result.errors).not.toContain('Username authentication is enabled but no users are configured')
  })

  // ---------------------------------------------------------------------------
  // Validate variable resolution (line 484)
  // ---------------------------------------------------------------------------

  it('validates variable node resolution errors (line 484)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ variablePath: 'MISSING', nodeType: 'variable' })]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.OTHER', type: 'INT_ENUM' }])
    const result = validateOpcUaConfig(cfg, dc, instances)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------------------
  // Validate structure node (line 487)
  // ---------------------------------------------------------------------------

  it('validates structure node resolution errors (line 487)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ nodeType: 'structure', variablePath: 'S', fields: [makeField({ fieldPath: 'MF' })] }),
    ]
    const result = validateOpcUaConfig(cfg, debugContent([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------------------
  // Validate simple array node (line 494)
  // ---------------------------------------------------------------------------

  it('validates simple array node resolution errors (line 494)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ nodeType: 'array', variablePath: 'MA', arrayLength: 5 })]
    const result = validateOpcUaConfig(cfg, debugContent([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------------------
  // Validate array with fields (line 492)
  // ---------------------------------------------------------------------------

  it('validates array with fields as structure (line 492)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'FBA',
        fields: [makeField({ fieldPath: 'MEF' })],
      }),
    ]
    const result = validateOpcUaConfig(cfg, debugContent([]), instances)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------------------
  // Validate successful resolution for structure/array (covers break on 485, 493)
  // ---------------------------------------------------------------------------

  it('validates structure node successfully (covers line 485 break)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'structure',
        variablePath: 'S',
        fields: [makeField({ fieldPath: 'F', datatype: 'INT', initialValue: 0 })],
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.S.F', type: 'INT_ENUM' }])
    const result = validateOpcUaConfig(cfg, dc, instances)
    expect(result.valid).toBe(true)
  })

  it('validates simple array node successfully (covers line 493 break)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({ nodeType: 'array', variablePath: 'A', arrayLength: 3, elementType: 'INT' }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.A.value.table[0]', type: 'INT_ENUM' }])
    const result = validateOpcUaConfig(cfg, dc, instances)
    expect(result.valid).toBe(true)
  })

  it('validates array with fields successfully (covers line 493 break)', () => {
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [
      makeNode({
        nodeType: 'array',
        variablePath: 'FA',
        fields: [makeField({ fieldPath: 'E', datatype: 'INT', initialValue: 0 })],
      }),
    ]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.FA.E', type: 'INT_ENUM' }])
    const result = validateOpcUaConfig(cfg, dc, instances)
    expect(result.valid).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Validate catches non-OpcUaConfigError via getErrorMessage (line 499)
  // ---------------------------------------------------------------------------

  it('catches non-OpcUaConfigError via getErrorMessage (line 499)', () => {
    const spy = jest.spyOn(resolveIndices, 'resolveVariableIndex').mockImplementation(() => {
      throw new TypeError('unexpected')
    })
    const cfg = baseServerConfig()
    cfg.addressSpace.nodes = [makeNode({ variablePath: 'X', nodeType: 'variable' })]
    const dc = debugContent([{ path: 'RES0__INSTANCE0.X', type: 'INT_ENUM' }])
    const result = validateOpcUaConfig(cfg, dc, instances)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('unexpected')
    spy.mockRestore()
  })
})
