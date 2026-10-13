/**
 * Tests for the shared runtime-v4 conf orchestration step.
 *
 * The atomic generators (`generateModbusSlaveConfig`,
 * `generateOpcUaConfig`, etc.) have their own tests in
 * `frontend/utils/.../__tests__/`.  This suite verifies the
 * orchestration layer: error-handling for OPC-UA, validation gating
 * for EtherCAT, the exact log messages the editor's compile pipeline
 * emits, and the pure assembly of the resulting strings.
 *
 * Atomic generators are mocked so the orchestration can be driven
 * through every branch (success, OpcUaConfigError, generic OPC-UA
 * failure, EtherCAT validation failure) without constructing
 * elaborate project fixtures.
 */

import type { PLCRemoteDevice, PLCServer } from '../../types/PLC/open-plc'

// Hoist mock declarations so they apply before the shared module
// imports its dependencies.  Each generator returns a sentinel by
// default; individual tests override via `.mockReturnValueOnce` /
// `.mockImplementationOnce`.

jest.mock('../../utils/modbus/generate-modbus-master-config', () => ({
  generateModbusMasterConfig: jest.fn(),
}))
jest.mock('../../ethercat/generate-ethercat-config', () => ({
  generateEthercatConfig: jest.fn(),
  generateEtherdogConfigs: jest.fn(),
}))
jest.mock('../../ethercat/validate-ethercat-config', () => ({
  validateEthercatConfig: jest.fn(),
}))
jest.mock('../../../../frontend/utils/modbus/generate-modbus-slave-config', () => ({
  generateModbusSlaveConfig: jest.fn(),
}))
jest.mock('../../../../frontend/utils/opcua', () => {
  // Matches the real 3-arg constructor in
  // `src/frontend/utils/opcua/resolve-indices.ts`.  Only the
  // `message` field is read by the shared module under test.
  class OpcUaConfigError extends Error {
    constructor(
      public readonly variableRef: string,
      public readonly expectedPath: string,
      message: string,
    ) {
      super(message)
      this.name = 'OpcUaConfigError'
    }
  }
  return {
    generateOpcUaConfig: jest.fn(),
    OpcUaConfigError,
  }
})
jest.mock('../../../../frontend/utils/s7comm', () => ({
  generateS7CommConfig: jest.fn(),
}))
jest.mock('../../../../frontend/utils/get-error-message', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

import { generateModbusMasterConfig } from '../../utils/modbus/generate-modbus-master-config'
import { generateEthercatConfig, generateEtherdogConfigs } from '../../ethercat/generate-ethercat-config'
import { validateEthercatConfig } from '../../ethercat/validate-ethercat-config'
import { generateModbusSlaveConfig } from '../../../../frontend/utils/modbus/generate-modbus-slave-config'
import { generateOpcUaConfig, OpcUaConfigError } from '../../../../frontend/utils/opcua'
import { generateS7CommConfig } from '../../../../frontend/utils/s7comm'
import { createDefaultMqttIntegration } from '../../../../frontend/utils/mqtt/project/model'
import { MqttConfigGenerationError } from '../../../../frontend/utils/mqtt/runtime/generate'
import { generateRuntimeConfs, type GenerateConfsInput } from '../steps/generate-confs'

const mockedModbusSlave = generateModbusSlaveConfig as jest.MockedFunction<typeof generateModbusSlaveConfig>
const mockedModbusMaster = generateModbusMasterConfig as jest.MockedFunction<typeof generateModbusMasterConfig>
const mockedS7Comm = generateS7CommConfig as jest.MockedFunction<typeof generateS7CommConfig>
const mockedOpcUa = generateOpcUaConfig as jest.MockedFunction<typeof generateOpcUaConfig>
const mockedEthercatGen = generateEthercatConfig as jest.MockedFunction<typeof generateEthercatConfig>
const mockedEtherdogGen = generateEtherdogConfigs as jest.MockedFunction<typeof generateEtherdogConfigs>
const mockedEthercatValidate = validateEthercatConfig as jest.MockedFunction<typeof validateEthercatConfig>

function makeInput(overrides?: Partial<GenerateConfsInput>): GenerateConfsInput {
  return {
    servers: [] as PLCServer[],
    remoteDevices: [] as PLCRemoteDevice[],
    instances: [],
    debugMapContent: '{}',
    log: jest.fn(),
    runtimeVersion: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Sensible defaults: every generator returns `null` (no config)
  // and EtherCAT validation passes.  Tests override per-case.
  mockedModbusSlave.mockReturnValue(null)
  mockedModbusMaster.mockReturnValue(null)
  mockedS7Comm.mockReturnValue(null)
  mockedOpcUa.mockReturnValue(null)
  mockedEthercatGen.mockReturnValue(null)
  mockedEtherdogGen.mockReturnValue(null)
  mockedEthercatValidate.mockReturnValue([])
})

describe('generateRuntimeConfs — happy path', () => {
  it('assembles all five confs into a single output', () => {
    mockedModbusSlave.mockReturnValue('{"modbus_slave":{}}')
    mockedModbusMaster.mockReturnValue('{"modbus_master":{}}')
    mockedS7Comm.mockReturnValue('{"s7":{}}')
    mockedOpcUa.mockReturnValue('{"opcua":{}}')
    mockedEthercatGen.mockReturnValue('{"ethercat":{}}')

    const result = generateRuntimeConfs(makeInput())
    expect(result).toEqual({
      modbusSlave: '{"modbus_slave":{}}',
      modbusMaster: '{"modbus_master":{}}',
      s7Comm: '{"s7":{}}',
      opcUa: '{"opcua":{}}',
      ethercat: '{"ethercat":{}}',
      ethercatBusconfig: null,
      ethercatIomapping: null,
      mqtt: null,
    })
  })

  it('passes servers + debugMapContent + instances + log to generateOpcUaConfig', () => {
    const servers = [{ name: 'opcua-server' }] as PLCServer[]
    const instances = [{ name: 'i0', task: 't0', program: 'main' }]
    const log = jest.fn()
    generateRuntimeConfs(makeInput({ servers, instances, debugMapContent: '{"k":"v"}', log }))
    expect(mockedOpcUa).toHaveBeenCalledTimes(1)
    expect(mockedOpcUa.mock.calls[0][0]).toBe(servers)
    expect(mockedOpcUa.mock.calls[0][1]).toBe('{"k":"v"}')
    expect(mockedOpcUa.mock.calls[0][2]).toBe(instances)
    expect(typeof mockedOpcUa.mock.calls[0][3]).toBe('function')
  })

  it('forwards OPC-UA info messages through the log callback as level=info', () => {
    const log = jest.fn()
    mockedOpcUa.mockImplementation((_servers, _dbg, _inst, innerLog) => {
      innerLog?.('OPC-UA Address Space: 5 node(s) configured')
      return '{"opcua":{}}'
    })
    generateRuntimeConfs(makeInput({ log }))
    expect(log).toHaveBeenCalledWith('OPC-UA Address Space: 5 node(s) configured', 'info')
  })

  it('forwards Modbus master skip diagnostics through the log callback as level=warning', () => {
    const log = jest.fn()
    mockedModbusMaster.mockImplementation((_devices, innerLog) => {
      innerLog?.('Modbus RTU device "BadRTU" is missing a serial port configuration and will be skipped.')
      return null
    })
    generateRuntimeConfs(makeInput({ log }))
    expect(log).toHaveBeenCalledWith(
      'Modbus RTU device "BadRTU" is missing a serial port configuration and will be skipped.',
      'warning',
    )
  })

  it('returns null for confs whose generator returned null', () => {
    // Default-mock behavior (all null).  Legacy EtherCAT keeps its empty file.
    const result = generateRuntimeConfs(makeInput())
    expect(result).toEqual({
      modbusSlave: null,
      modbusMaster: null,
      s7Comm: null,
      opcUa: null,
      ethercat: '',
      ethercatBusconfig: null,
      ethercatIomapping: null,
      mqtt: null,
    })
  })
})

describe('generateRuntimeConfs — OPC-UA error handling', () => {
  it('logs "OPC-UA Configuration Error:" prefix and rethrows on OpcUaConfigError', () => {
    const log = jest.fn()
    mockedOpcUa.mockImplementation(() => {
      throw new OpcUaConfigError('var0', 'P0.task.var', 'Invalid node id "foo"')
    })

    expect(() => generateRuntimeConfs(makeInput({ log }))).toThrow(OpcUaConfigError)
    expect(log).toHaveBeenCalledWith('OPC-UA Configuration Error:\nInvalid node id "foo"', 'error')
  })

  it('logs "Failed to generate OPC-UA config:" prefix and rethrows on generic Error', () => {
    const log = jest.fn()
    mockedOpcUa.mockImplementation(() => {
      throw new Error('boom')
    })

    expect(() => generateRuntimeConfs(makeInput({ log }))).toThrow('boom')
    expect(log).toHaveBeenCalledWith('Failed to generate OPC-UA config: boom', 'error')
  })

  it('logs "Failed to generate OPC-UA config:" prefix and rethrows on non-Error throws', () => {
    const log = jest.fn()
    mockedOpcUa.mockImplementation(() => {
      throw 'string error'
    })

    expect(() => generateRuntimeConfs(makeInput({ log }))).toThrow()
    expect(log).toHaveBeenCalledWith('Failed to generate OPC-UA config: string error', 'error')
  })

  it('does not run EtherCAT generation/validation when OPC-UA throws', () => {
    mockedOpcUa.mockImplementation(() => {
      throw new OpcUaConfigError('v', 'p', 'x')
    })
    try {
      generateRuntimeConfs(makeInput())
    } catch {
      // expected
    }
    expect(mockedEthercatGen).not.toHaveBeenCalled()
    expect(mockedEthercatValidate).not.toHaveBeenCalled()
  })
})

describe('generateRuntimeConfs — EtherCAT validation gate', () => {
  it('throws with joined error message when validation returns errors', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"bad"}')
    mockedEthercatValidate.mockReturnValue(['slave 0 missing vendor id', 'slave 2 invalid PDO'])

    expect(() => generateRuntimeConfs(makeInput())).toThrow(
      'EtherCAT configuration is invalid: slave 0 missing vendor id; slave 2 invalid PDO',
    )
  })

  it('passes the generated EtherCAT JSON through to validateEthercatConfig', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"x"}')
    generateRuntimeConfs(makeInput())
    expect(mockedEthercatValidate).toHaveBeenCalledWith('{"ethercat":"x"}')
  })

  it('includes the ethercat JSON in the output when validation passes', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"ok"}')
    mockedEthercatValidate.mockReturnValue([])
    const result = generateRuntimeConfs(makeInput())
    expect(result.ethercat).toBe('{"ethercat":"ok"}')
  })

  it("returns ethercat: '' when no remote devices configured (legacy file is always written)", () => {
    mockedEthercatGen.mockReturnValue(null)
    mockedEthercatValidate.mockReturnValue([])
    const result = generateRuntimeConfs(makeInput())
    expect(result.ethercat).toBe('')
    expect(mockedEthercatValidate).toHaveBeenCalledWith(null)
  })

  it('does not log anything for EtherCAT validation failures (caller surfaces the message)', () => {
    const log = jest.fn()
    mockedEthercatValidate.mockReturnValue(['err'])
    try {
      generateRuntimeConfs(makeInput({ log }))
    } catch {
      // expected
    }
    expect(log).not.toHaveBeenCalled()
  })
})

describe('generateRuntimeConfs — EtherCAT format by runtime version', () => {
  const split = { busconfig: '[{"bus":1}]', iomapping: '{"version":1,"masters":[]}' }

  it('emits the legacy single file below MIN_ETHERDOG_RUNTIME_VERSION', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"legacy"}')
    mockedEtherdogGen.mockReturnValue(split)
    const result = generateRuntimeConfs(makeInput({ runtimeVersion: 'v4.2.4' }))
    expect(result.ethercat).toBe('{"ethercat":"legacy"}')
    expect(result.ethercatBusconfig).toBeNull()
    expect(result.ethercatIomapping).toBeNull()
    expect(mockedEtherdogGen).not.toHaveBeenCalled()
  })

  it('emits the busconfig + iomapping pair at MIN_ETHERDOG_RUNTIME_VERSION and above', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"legacy"}')
    mockedEtherdogGen.mockReturnValue(split)
    for (const runtimeVersion of ['v4.3.0', '4.3.0-rc.1', 'v5.0.0']) {
      const result = generateRuntimeConfs(makeInput({ runtimeVersion }))
      expect(result.ethercat).toBeNull()
      expect(result.ethercatBusconfig).toBe(split.busconfig)
      expect(result.ethercatIomapping).toBe(split.iomapping)
    }
    expect(mockedEthercatGen).not.toHaveBeenCalled()
    expect(mockedEthercatValidate).toHaveBeenCalledWith(split.busconfig, split.iomapping)
  })

  it('emits no EtherCAT file at all for an EtherDOG runtime when the project has no EtherCAT', () => {
    const result = generateRuntimeConfs(makeInput({ runtimeVersion: 'v4.3.0' }))
    expect(result.ethercat).toBeNull()
    expect(result.ethercatBusconfig).toBeNull()
    expect(result.ethercatIomapping).toBeNull()
  })

  it('falls back to the legacy single file when the runtime version is unknown', () => {
    mockedEthercatGen.mockReturnValue('{"ethercat":"legacy"}')
    mockedEtherdogGen.mockReturnValue(split)
    for (const runtimeVersion of [null, '', 'dev']) {
      const result = generateRuntimeConfs(makeInput({ runtimeVersion }))
      expect(result.ethercat).toBe('{"ethercat":"legacy"}')
      expect(result.ethercatBusconfig).toBeNull()
    }
    expect(mockedEtherdogGen).not.toHaveBeenCalled()
  })

  it('throws when the EtherDOG pair fails validation', () => {
    mockedEtherdogGen.mockReturnValue(split)
    mockedEthercatValidate.mockReturnValue(['entry %IX0.0 matches 0 channel(s)'])
    expect(() => generateRuntimeConfs(makeInput({ runtimeVersion: 'v4.3.0' }))).toThrow(
      'EtherCAT configuration is invalid: entry %IX0.0 matches 0 channel(s)',
    )
  })
})

describe('generateRuntimeConfs — ordering invariants', () => {
  it('runs Modbus + S7 + OPC-UA generators before EtherCAT (OPC-UA error short-circuits the rest)', () => {
    const callOrder: string[] = []
    mockedModbusSlave.mockImplementation(() => {
      callOrder.push('modbus-slave')
      return null
    })
    mockedModbusMaster.mockImplementation(() => {
      callOrder.push('modbus-master')
      return null
    })
    mockedS7Comm.mockImplementation(() => {
      callOrder.push('s7')
      return null
    })
    mockedOpcUa.mockImplementation(() => {
      callOrder.push('opcua')
      return null
    })
    mockedEthercatGen.mockImplementation(() => {
      callOrder.push('ethercat-gen')
      return null
    })
    mockedEthercatValidate.mockImplementation(() => {
      callOrder.push('ethercat-validate')
      return []
    })

    generateRuntimeConfs(makeInput())

    // OPC-UA must run BEFORE EtherCAT so an OPC-UA failure aborts
    // before EtherCAT generation runs (matches editor's compile
    // ordering — saves wasted work on bad OPC-UA projects).
    expect(callOrder.indexOf('opcua')).toBeLessThan(callOrder.indexOf('ethercat-gen'))
    expect(callOrder.indexOf('ethercat-gen')).toBeLessThan(callOrder.indexOf('ethercat-validate'))
  })
})

describe('generateRuntimeConfs — MQTT', () => {
  const debugMap = JSON.stringify({
    version: 2,
    md5: '0123456789abcdef0123456789abcdef',
    leaves: [{ arrayIdx: 0, elemIdx: 3, path: 'INSTANCE0.COUNTER', type: 'DINT', size: 4 }],
  })
  const instances = [{ name: 'instance0', task: 'task0', program: 'Main' }]
  const mqttServer = (enabled: boolean, variable = 'Counter') =>
    ({
      name: 'broker',
      protocol: 'mqtt',
      mqttConfig: {
        ...createDefaultMqttIntegration('plc1'),
        enabled,
        connection: { host: 'broker.local', port: 1883, clientId: 'plc1', tls: { enabled: false } },
        selections: [
          {
            source: {
              tokens: [
                { role: 'instance', name: 'instance0' },
                { role: 'program', name: 'Main' },
                { role: 'variable', name: variable },
              ],
            },
          },
        ],
      },
    }) as PLCServer

  it('emits null without an enabled integration so conf/mqtt.json stays absent', () => {
    expect(generateRuntimeConfs(makeInput({ servers: [mqttServer(false)] })).mqtt).toBeNull()
  })

  it('emits conf/mqtt.json resolved against the debug map and logs a summary', () => {
    const log = jest.fn()
    const result = generateRuntimeConfs(
      makeInput({
        servers: [mqttServer(true)],
        instances,
        debugMapContent: debugMap,
        log,
        mqtt: { target: { mqttClient: true } },
      }),
    )
    expect(JSON.parse(result.mqtt ?? '')).toMatchObject({
      program: { md5: '0123456789abcdef0123456789abcdef' },
      leaves: [{ address: { arr: 0, elem: 3 }, destination: 'openplc/plc1/instance0/Main/Counter' }],
    })
    expect(log).toHaveBeenCalledWith('Generated conf/mqtt.json for "broker": 1 leaves, mode generic', 'info')
  })

  it('logs every structured issue and rethrows, aborting the build', () => {
    const log = jest.fn()
    expect(() =>
      generateRuntimeConfs(
        makeInput({
          servers: [mqttServer(true, 'Removed')],
          instances,
          debugMapContent: debugMap,
          log,
          mqtt: { target: { mqttClient: true } },
        }),
      ),
    ).toThrow(MqttConfigGenerationError)
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^MQTT Configuration Error:\n.*project_selection_unresolved\/leaf_missing/),
      'error',
    )
  })

  it('refuses an enabled integration when the caller does not vouch for the target', () => {
    const log = jest.fn()
    expect(() =>
      generateRuntimeConfs(makeInput({ servers: [mqttServer(true)], instances, debugMapContent: debugMap, log })),
    ).toThrow(/project_target_unsupported/)
  })

  const withPassword = (variable = 'Counter') => {
    const server = mqttServer(true, variable)
    if (!server.mqttConfig) throw new Error('fixture')
    return { ...server, mqttConfig: { ...server.mqttConfig, authMethod: 'username_password' as const } }
  }

  it('defers a password integration to the deploy: validated, no file, plan returned', () => {
    const log = jest.fn()
    const result = generateRuntimeConfs(
      makeInput({
        servers: [withPassword()],
        instances,
        debugMapContent: debugMap,
        log,
        mqtt: { target: { mqttClient: true }, credentialRef: 'deferred' },
      }),
    )
    expect(result.mqtt).toBeNull()
    expect(result.mqttDeferred).toMatchObject({
      server: 'broker',
      programMd5: '0123456789abcdef0123456789abcdef',
      leafCount: 1,
      credentialRequired: true,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('conf/mqtt.json is written when uploading'), 'info')
  })

  it('still refuses a broken password integration when deferring, before any credential is involved', () => {
    expect(() =>
      generateRuntimeConfs(
        makeInput({
          servers: [withPassword('Removed')],
          instances,
          debugMapContent: debugMap,
          mqtt: { target: { mqttClient: true }, credentialRef: 'deferred' },
        }),
      ),
    ).toThrow(/project_selection_unresolved/)
  })

  it('generates an anonymous integration directly even when deferring', () => {
    const result = generateRuntimeConfs(
      makeInput({
        servers: [mqttServer(true)],
        instances,
        debugMapContent: debugMap,
        mqtt: { target: { mqttClient: true }, credentialRef: 'deferred' },
      }),
    )
    expect(result.mqtt).not.toBeNull()
    expect('mqttDeferred' in result).toBe(false)
  })
})
