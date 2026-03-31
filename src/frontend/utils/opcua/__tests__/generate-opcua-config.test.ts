import type { OpcUaServerConfig, PLCServer } from '@root/types/PLC/open-plc'

import { generateOpcUaConfig, parseDebugFile, validateOpcUaConfig } from '../generate-opcua-config'
import { OpcUaConfigError, resolveArrayIndex, resolveStructureIndices, resolveVariableIndex } from '../resolve-indices'
import type { PLCInstanceInfo } from '../types'

// Sample debug.c content for testing
// Uses INSTANCE0 as the instance name (matching the sampleInstances below)
const sampleDebugContent = `
#define VAR_COUNT 18

debug_vars_t debug_vars[] = {
  { &(RES0__INSTANCE0.MOTOR_SPEED), INT_ENUM },
  { &(RES0__INSTANCE0.TEMPERATURE), REAL_ENUM },
  { &(RES0__INSTANCE0.IS_RUNNING), BOOL_ENUM },
  { &(RES0__INSTANCE0.SENSOR.value.TEMP), REAL_ENUM },
  { &(RES0__INSTANCE0.SENSOR.value.PRESSURE), REAL_ENUM },
  { &(RES0__INSTANCE0.TEMPS.value.table[0]), REAL_ENUM },
  { &(RES0__INSTANCE0.TEMPS.value.table[1]), REAL_ENUM },
  { &(RES0__INSTANCE0.TEMPS.value.table[2]), REAL_ENUM },
  { &(CONFIG0__GLOBAL_VAR), INT_ENUM },
  { &(CONFIG0__SYSTEM_STATE), BOOL_ENUM },
  { &(RES0__INSTANCE0.TIMER0.ET), TIME_ENUM },
  { &(RES0__INSTANCE0.TIMER0.Q), BOOL_ENUM },
  { &(RES0__INSTANCE0.NESTED_STRUCT.value.INNER.value.VALUE1), INT_ENUM },
  { &(RES0__INSTANCE0.NESTED_STRUCT.value.INNER.value.VALUE2), REAL_ENUM },
  { &(RES0__INSTANCE0.FB_ARRAY.value.table[0].ET), TIME_ENUM },
  { &(RES0__INSTANCE0.FB_ARRAY.value.table[0].Q), BOOL_ENUM },
  { &(RES0__INSTANCE0.FB_ARRAY.value.table[1].ET), TIME_ENUM },
  { &(RES0__INSTANCE0.FB_ARRAY.value.table[1].Q), BOOL_ENUM },
};
`

// Sample instances array representing the Resources configuration
const sampleInstances: PLCInstanceInfo[] = [
  {
    name: 'INSTANCE0',
    task: 'Task0',
    program: 'main',
  },
]

// Sample OPC-UA server configuration
const createSampleConfig = (): OpcUaServerConfig => ({
  server: {
    enabled: true,
    name: 'Test OPC-UA Server',
    applicationUri: 'urn:test:opcua:server',
    productUri: 'urn:test:runtime',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/test/opcua',
  },
  cycleTimeMs: 100,
  securityProfiles: [
    {
      id: 'profile-1',
      name: 'insecure',
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
  users: [
    {
      id: 'user-1',
      type: 'password',
      username: 'admin',
      passwordHash: '$2b$12$test',
      certificateId: null,
      role: 'engineer',
    },
  ],
  addressSpace: {
    namespaceUri: 'urn:test:opcua:namespace',
    nodes: [],
  },
})

describe('parseDebugFile', () => {
  it('should parse debug variables from debug.c content', () => {
    const variables = parseDebugFile(sampleDebugContent)

    expect(variables).toHaveLength(18)
    expect(variables[0]).toEqual({
      name: 'RES0__INSTANCE0.MOTOR_SPEED',
      type: 'INT_ENUM',
      index: 0,
    })
    expect(variables[8]).toEqual({
      name: 'CONFIG0__GLOBAL_VAR',
      type: 'INT_ENUM',
      index: 8,
    })
  })

  it('should return empty array for invalid content', () => {
    const variables = parseDebugFile('no debug vars here')
    expect(variables).toHaveLength(0)
  })

  it('should handle empty content', () => {
    const variables = parseDebugFile('')
    expect(variables).toHaveLength(0)
  })
})

describe('resolveVariableIndex', () => {
  const debugVariables = parseDebugFile(sampleDebugContent)

  it('should resolve simple program variable', () => {
    const node = {
      id: 'test-1',
      pouName: 'main',
      variablePath: 'MOTOR_SPEED',
      variableType: 'INT',
      nodeId: 'PLC.Main.MotorSpeed',
      browseName: 'MotorSpeed',
      displayName: 'Motor Speed',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'variable' as const,
    }

    const index = resolveVariableIndex(node, debugVariables, sampleInstances)
    expect(index).toBe(0)
  })

  it('should resolve global variable', () => {
    const node = {
      id: 'test-2',
      pouName: 'GVL',
      variablePath: 'GLOBAL_VAR',
      variableType: 'INT',
      nodeId: 'PLC.GVL.GlobalVar',
      browseName: 'GlobalVar',
      displayName: 'Global Variable',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'variable' as const,
    }

    const index = resolveVariableIndex(node, debugVariables, sampleInstances)
    expect(index).toBe(8)
  })

  it('should throw error for non-existent variable', () => {
    const node = {
      id: 'test-3',
      pouName: 'main',
      variablePath: 'NON_EXISTENT',
      variableType: 'INT',
      nodeId: 'PLC.Main.NonExistent',
      browseName: 'NonExistent',
      displayName: 'Non Existent',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'variable' as const,
    }

    expect(() => resolveVariableIndex(node, debugVariables, sampleInstances)).toThrow(OpcUaConfigError)
  })

  it('should throw error when program has no instance in Resources', () => {
    const node = {
      id: 'test-4',
      pouName: 'unknown_program',
      variablePath: 'SOME_VAR',
      variableType: 'INT',
      nodeId: 'PLC.Unknown.SomeVar',
      browseName: 'SomeVar',
      displayName: 'Some Var',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'variable' as const,
    }

    expect(() => resolveVariableIndex(node, debugVariables, sampleInstances)).toThrow(OpcUaConfigError)
  })
})

describe('resolveArrayIndex', () => {
  const debugVariables = parseDebugFile(sampleDebugContent)

  it('should resolve array starting index', () => {
    const node = {
      id: 'test-4',
      pouName: 'main',
      variablePath: 'TEMPS',
      variableType: 'ARRAY[0..2] OF REAL',
      nodeId: 'PLC.Main.Temps',
      browseName: 'Temps',
      displayName: 'Temperatures',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'array' as const,
      arrayLength: 3,
      elementType: 'REAL',
    }

    const index = resolveArrayIndex(node, debugVariables, sampleInstances)
    expect(index).toBe(5) // First element [0] is at index 5
  })
})

describe('resolveStructureIndices', () => {
  const debugVariables = parseDebugFile(sampleDebugContent)

  it('should resolve structure field indices', () => {
    const node = {
      id: 'test-5',
      pouName: 'main',
      variablePath: 'SENSOR',
      variableType: 'SensorData',
      nodeId: 'PLC.Main.Sensor',
      browseName: 'Sensor',
      displayName: 'Sensor Data',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'structure' as const,
      fields: [
        {
          fieldPath: 'TEMP',
          displayName: 'Temperature',
          datatype: 'REAL',
          initialValue: 0.0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: 'PRESSURE',
          displayName: 'Pressure',
          datatype: 'REAL',
          initialValue: 0.0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    const resolvedFields = resolveStructureIndices(node, debugVariables, sampleInstances)
    expect(resolvedFields).toHaveLength(2)
    expect(resolvedFields[0].index).toBe(3) // SENSOR.value.TEMP
    expect(resolvedFields[0].datatype).toBe('REAL') // Converted from REAL_ENUM
    expect(resolvedFields[1].index).toBe(4) // SENSOR.value.PRESSURE
    expect(resolvedFields[1].datatype).toBe('REAL') // Converted from REAL_ENUM
  })

  it('should convert debug.c type enums to IEC types', () => {
    // This test verifies that types like "INT_ENUM", "BOOL_ENUM" are converted to "INT", "BOOL"
    const node = {
      id: 'test-fb-types',
      pouName: 'main',
      variablePath: 'TIMER0',
      variableType: 'TON',
      nodeId: 'PLC.Main.Timer0',
      browseName: 'Timer0',
      displayName: 'Timer 0',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'structure' as const,
      fields: [
        {
          fieldPath: 'ET',
          displayName: 'Elapsed Time',
          datatype: 'TIME',
          initialValue: 0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: 'Q',
          displayName: 'Output',
          datatype: 'BOOL',
          initialValue: false,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    const resolvedFields = resolveStructureIndices(node, debugVariables, sampleInstances)
    // TIME_ENUM should be converted to TIME
    expect(resolvedFields[0].datatype).toBe('TIME')
    // BOOL_ENUM should be converted to BOOL
    expect(resolvedFields[1].datatype).toBe('BOOL')
  })

  it('should resolve function block with expanded leaf fields', () => {
    // FB instance with its leaf variables expanded (like TON with ET and Q)
    const node = {
      id: 'test-fb-1',
      pouName: 'main',
      variablePath: 'TIMER0',
      variableType: 'TON',
      nodeId: 'PLC.Main.Timer0',
      browseName: 'Timer0',
      displayName: 'Timer 0',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'structure' as const, // FBs use 'structure' nodeType
      fields: [
        {
          fieldPath: 'ET',
          displayName: 'Elapsed Time',
          datatype: 'TIME',
          initialValue: 0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: 'Q',
          displayName: 'Output',
          datatype: 'BOOL',
          initialValue: false,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    const resolvedFields = resolveStructureIndices(node, debugVariables, sampleInstances)
    expect(resolvedFields).toHaveLength(2)
    expect(resolvedFields[0].index).toBe(10) // TIMER0.ET (FB-style path, no .value.)
    expect(resolvedFields[1].index).toBe(11) // TIMER0.Q
  })

  it('should resolve nested structure with deep field paths', () => {
    // Nested structure: NESTED_STRUCT.INNER.VALUE1, NESTED_STRUCT.INNER.VALUE2
    const node = {
      id: 'test-nested-1',
      pouName: 'main',
      variablePath: 'NESTED_STRUCT',
      variableType: 'OuterStruct',
      nodeId: 'PLC.Main.NestedStruct',
      browseName: 'NestedStruct',
      displayName: 'Nested Structure',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'structure' as const,
      fields: [
        {
          fieldPath: 'INNER.VALUE1',
          displayName: 'Inner Value 1',
          datatype: 'INT',
          initialValue: 0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: 'INNER.VALUE2',
          displayName: 'Inner Value 2',
          datatype: 'REAL',
          initialValue: 0.0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    const resolvedFields = resolveStructureIndices(node, debugVariables, sampleInstances)
    expect(resolvedFields).toHaveLength(2)
    expect(resolvedFields[0].index).toBe(12) // NESTED_STRUCT.value.INNER.value.VALUE1
    expect(resolvedFields[1].index).toBe(13) // NESTED_STRUCT.value.INNER.value.VALUE2
  })

  it('should resolve array of FBs with expanded leaf fields', () => {
    // Array of FBs: FB_ARRAY[0].ET, FB_ARRAY[0].Q, FB_ARRAY[1].ET, FB_ARRAY[1].Q
    const node = {
      id: 'test-fb-array-1',
      pouName: 'main',
      variablePath: 'FB_ARRAY',
      variableType: 'ARRAY[0..1] OF TON',
      nodeId: 'PLC.Main.FbArray',
      browseName: 'FbArray',
      displayName: 'FB Array',
      description: '',
      initialValue: 0,
      permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
      nodeType: 'array' as const,
      arrayLength: 2,
      elementType: 'TON',
      fields: [
        {
          fieldPath: '[0].ET',
          displayName: '[0] Elapsed Time',
          datatype: 'TIME',
          initialValue: 0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: '[0].Q',
          displayName: '[0] Output',
          datatype: 'BOOL',
          initialValue: false,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: '[1].ET',
          displayName: '[1] Elapsed Time',
          datatype: 'TIME',
          initialValue: 0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: '[1].Q',
          displayName: '[1] Output',
          datatype: 'BOOL',
          initialValue: false,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    // Arrays with fields are treated like structures for resolution
    const resolvedFields = resolveStructureIndices(node, debugVariables, sampleInstances)
    expect(resolvedFields).toHaveLength(4)
    expect(resolvedFields[0].index).toBe(14) // FB_ARRAY[0].ET
    expect(resolvedFields[1].index).toBe(15) // FB_ARRAY[0].Q
    expect(resolvedFields[2].index).toBe(16) // FB_ARRAY[1].ET
    expect(resolvedFields[3].index).toBe(17) // FB_ARRAY[1].Q
  })
})

describe('generateOpcUaConfig', () => {
  it('should return null when no servers configured', () => {
    const result = generateOpcUaConfig(undefined, sampleDebugContent, sampleInstances)
    expect(result).toBeNull()
  })

  it('should return null when no OPC-UA server configured', () => {
    const servers: PLCServer[] = [
      {
        name: 'modbus-server',
        protocol: 'modbus-tcp',
      },
    ]
    const result = generateOpcUaConfig(servers, sampleDebugContent, sampleInstances)
    expect(result).toBeNull()
  })

  it('should return null when OPC-UA server is disabled', () => {
    const config = createSampleConfig()
    config.server.enabled = false

    const servers: PLCServer[] = [
      {
        name: 'opcua-server',
        protocol: 'opcua',
        opcuaServerConfig: config,
      },
    ]

    const result = generateOpcUaConfig(servers, sampleDebugContent, sampleInstances)
    expect(result).toBeNull()
  })

  it('should generate valid JSON for enabled OPC-UA server', () => {
    const config = createSampleConfig()
    config.addressSpace.nodes = [
      {
        id: 'node-1',
        pouName: 'main',
        variablePath: 'MOTOR_SPEED',
        variableType: 'INT',
        nodeId: 'PLC.Main.MotorSpeed',
        browseName: 'MotorSpeed',
        displayName: 'Motor Speed',
        description: 'Motor speed in RPM',
        initialValue: 0,
        permissions: { viewer: 'r', operator: 'rw', engineer: 'rw' },
        nodeType: 'variable',
      },
    ]

    const servers: PLCServer[] = [
      {
        name: 'opcua-server',
        protocol: 'opcua',
        opcuaServerConfig: config,
      },
    ]

    const result = generateOpcUaConfig(servers, sampleDebugContent, sampleInstances)
    expect(result).not.toBeNull()

    const parsed = JSON.parse(result!)
    expect(parsed).toBeInstanceOf(Array)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('opcua_server')
    expect(parsed[0].protocol).toBe('OPC-UA')
    expect(parsed[0].config.server.endpoint_url).toBe('opc.tcp://0.0.0.0:4840/test/opcua')
    expect(parsed[0].config.address_space.variables).toHaveLength(1)
    expect(parsed[0].config.address_space.variables[0].index).toBe(0)
  })
})

describe('validateOpcUaConfig', () => {
  it('should return valid when config is correct', () => {
    const config = createSampleConfig()
    config.addressSpace.nodes = [
      {
        id: 'node-1',
        pouName: 'main',
        variablePath: 'MOTOR_SPEED',
        variableType: 'INT',
        nodeId: 'PLC.Main.MotorSpeed',
        browseName: 'MotorSpeed',
        displayName: 'Motor Speed',
        description: '',
        initialValue: 0,
        permissions: { viewer: 'r', operator: 'r', engineer: 'rw' },
        nodeType: 'variable',
      },
    ]

    const result = validateOpcUaConfig(config, sampleDebugContent, sampleInstances)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return errors when no security profiles enabled', () => {
    const config = createSampleConfig()
    config.securityProfiles[0].enabled = false

    const result = validateOpcUaConfig(config, sampleDebugContent, sampleInstances)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('At least one security profile must be enabled')
  })

  it('should return errors when username auth enabled without users', () => {
    const config = createSampleConfig()
    config.securityProfiles[0].authMethods = ['Username']
    config.users = []

    const result = validateOpcUaConfig(config, sampleDebugContent, sampleInstances)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Username authentication is enabled but no users are configured')
  })
})
