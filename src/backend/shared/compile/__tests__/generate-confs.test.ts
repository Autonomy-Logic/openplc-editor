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
import { generateEthercatConfig } from '../../ethercat/generate-ethercat-config'
import { validateEthercatConfig } from '../../ethercat/validate-ethercat-config'
import { generateModbusSlaveConfig } from '../../../../frontend/utils/modbus/generate-modbus-slave-config'
import { generateOpcUaConfig, OpcUaConfigError } from '../../../../frontend/utils/opcua'
import { generateS7CommConfig } from '../../../../frontend/utils/s7comm'
import { generateRuntimeConfs, type GenerateConfsInput } from '../steps/generate-confs'

const mockedModbusSlave = generateModbusSlaveConfig as jest.MockedFunction<typeof generateModbusSlaveConfig>
const mockedModbusMaster = generateModbusMasterConfig as jest.MockedFunction<typeof generateModbusMasterConfig>
const mockedS7Comm = generateS7CommConfig as jest.MockedFunction<typeof generateS7CommConfig>
const mockedOpcUa = generateOpcUaConfig as jest.MockedFunction<typeof generateOpcUaConfig>
const mockedEthercatGen = generateEthercatConfig as jest.MockedFunction<typeof generateEthercatConfig>
const mockedEthercatValidate = validateEthercatConfig as jest.MockedFunction<typeof validateEthercatConfig>

function makeInput(overrides?: Partial<GenerateConfsInput>): GenerateConfsInput {
  return {
    servers: [] as PLCServer[],
    remoteDevices: [] as PLCRemoteDevice[],
    instances: [],
    debugMapContent: '{}',
    log: jest.fn(),
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
    // Default-mock behavior (all null).
    const result = generateRuntimeConfs(makeInput())
    expect(result).toEqual({
      modbusSlave: null,
      modbusMaster: null,
      s7Comm: null,
      opcUa: null,
      ethercat: null,
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

  it('returns ethercat: null when no remote devices configured (generator returns null)', () => {
    mockedEthercatGen.mockReturnValue(null)
    mockedEthercatValidate.mockReturnValue([])
    const result = generateRuntimeConfs(makeInput())
    expect(result.ethercat).toBeNull()
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
