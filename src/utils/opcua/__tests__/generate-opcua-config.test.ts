import type { OpcUaServerConfig, PLCServer } from '@root/types/PLC/open-plc'

import { generateOpcUaConfig, parseDebugFile, validateOpcUaConfig } from '../generate-opcua-config'
import { OpcUaConfigError, resolveArrayIndex, resolveStructureIndices, resolveVariableIndex } from '../resolve-indices'

// Sample debug.c content for testing
const sampleDebugContent = `
#define VAR_COUNT 10

debug_vars_t debug_vars[] = {
  { &(RES0__MAIN.MOTOR_SPEED), INT_ENUM },
  { &(RES0__MAIN.TEMPERATURE), REAL_ENUM },
  { &(RES0__MAIN.IS_RUNNING), BOOL_ENUM },
  { &(RES0__MAIN.SENSOR.value.TEMP), REAL_ENUM },
  { &(RES0__MAIN.SENSOR.value.PRESSURE), REAL_ENUM },
  { &(RES0__MAIN.TEMPS.value.table[0]), REAL_ENUM },
  { &(RES0__MAIN.TEMPS.value.table[1]), REAL_ENUM },
  { &(RES0__MAIN.TEMPS.value.table[2]), REAL_ENUM },
  { &(CONFIG0__GLOBAL_VAR), INT_ENUM },
  { &(CONFIG0__SYSTEM_STATE), BOOL_ENUM },
};
`

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

    expect(variables).toHaveLength(10)
    expect(variables[0]).toEqual({
      name: 'RES0__MAIN.MOTOR_SPEED',
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

    const index = resolveVariableIndex(node, debugVariables)
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

    const index = resolveVariableIndex(node, debugVariables)
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

    expect(() => resolveVariableIndex(node, debugVariables)).toThrow(OpcUaConfigError)
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

    const index = resolveArrayIndex(node, debugVariables)
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
          initialValue: 0.0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
        {
          fieldPath: 'PRESSURE',
          displayName: 'Pressure',
          initialValue: 0.0,
          permissions: { viewer: 'r' as const, operator: 'r' as const, engineer: 'rw' as const },
        },
      ],
    }

    const resolvedFields = resolveStructureIndices(node, debugVariables)
    expect(resolvedFields).toHaveLength(2)
    expect(resolvedFields[0].index).toBe(3) // SENSOR.value.TEMP
    expect(resolvedFields[1].index).toBe(4) // SENSOR.value.PRESSURE
  })
})

describe('generateOpcUaConfig', () => {
  it('should return null when no servers configured', () => {
    const result = generateOpcUaConfig(undefined, sampleDebugContent)
    expect(result).toBeNull()
  })

  it('should return null when no OPC-UA server configured', () => {
    const servers: PLCServer[] = [
      {
        name: 'modbus-server',
        protocol: 'modbus-tcp',
      },
    ]
    const result = generateOpcUaConfig(servers, sampleDebugContent)
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

    const result = generateOpcUaConfig(servers, sampleDebugContent)
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

    const result = generateOpcUaConfig(servers, sampleDebugContent)
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

    const result = validateOpcUaConfig(config, sampleDebugContent)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return errors when no security profiles enabled', () => {
    const config = createSampleConfig()
    config.securityProfiles[0].enabled = false

    const result = validateOpcUaConfig(config, sampleDebugContent)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('At least one security profile must be enabled')
  })

  it('should return errors when username auth enabled without users', () => {
    const config = createSampleConfig()
    config.securityProfiles[0].authMethods = ['Username']
    config.users = []

    const result = validateOpcUaConfig(config, sampleDebugContent)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Username authentication is enabled but no users are configured')
  })
})
