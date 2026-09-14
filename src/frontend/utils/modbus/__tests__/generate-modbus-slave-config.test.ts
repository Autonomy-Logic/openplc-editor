import type { PLCServer } from '../../../../middleware/shared/ports/types'
import { DEFAULT_BUFFER_MAPPING, generateModbusSlaveConfig } from '../generate-modbus-slave-config'

const makeModbusServer = (overrides?: Partial<PLCServer>): PLCServer => ({
  name: 'ModbusSlave',
  protocol: 'modbus-tcp',
  modbusSlaveConfig: {
    enabled: true,
    networkInterface: '192.168.1.1',
    port: 5020,
  },
  ...overrides,
})

describe('generateModbusSlaveConfig', () => {
  it('returns null for undefined input', () => {
    expect(generateModbusSlaveConfig(undefined)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(generateModbusSlaveConfig([])).toBeNull()
  })

  it('returns null when no modbus-tcp servers exist', () => {
    const servers: PLCServer[] = [{ name: 'S7', protocol: 's7comm' }]
    expect(generateModbusSlaveConfig(servers)).toBeNull()
  })

  it('returns null when modbus-tcp server has no slave config', () => {
    const servers: PLCServer[] = [{ name: 'NoConfig', protocol: 'modbus-tcp' }]
    expect(generateModbusSlaveConfig(servers)).toBeNull()
  })

  /**
   * Enable state is the presence of `conf/modbus_slave.json` — the runtime
   * has no `enabled` key to read.  A disabled server that still emits a
   * config opens port 502 on a device meant to have it closed.
   */
  describe('the enabled switch', () => {
    it('returns null when the only modbus-tcp server is disabled', () => {
      const disabled = makeModbusServer({
        modbusSlaveConfig: { enabled: false, networkInterface: '0.0.0.0', port: 502 },
      })
      expect(generateModbusSlaveConfig([disabled])).toBeNull()
    })

    it('takes the enabled server when a disabled one comes first', () => {
      const disabled = makeModbusServer({
        name: 'Off',
        modbusSlaveConfig: { enabled: false, networkInterface: '10.0.0.1', port: 1502 },
      })
      const result = generateModbusSlaveConfig([disabled, makeModbusServer({ name: 'On' })])

      expect(result).not.toBeNull()
      expect(JSON.parse(result!).network_configuration.port).toBe(5020)
    })

    it('reports the servers it ignores when two are enabled', () => {
      const messages: string[] = []
      const result = generateModbusSlaveConfig(
        [makeModbusServer({ name: 'First' }), makeModbusServer({ name: 'Second' })],
        (message) => messages.push(message),
      )

      expect(result).not.toBeNull()
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain('Using "First"')
      expect(messages[0]).toContain('ignoring Second')
    })

    it('does not log when only one server is enabled', () => {
      const messages: string[] = []
      generateModbusSlaveConfig([makeModbusServer()], (message) => messages.push(message))
      expect(messages).toEqual([])
    })
  })

  /**
   * A partial mapping must survive the round trip: `ModbusBufferMapping`
   * makes every group and count optional, so each missing value falls back
   * to the runtime default rather than reaching the conf as undefined.
   */
  it('defaults every count a partial bufferMapping omits', () => {
    const partial = makeModbusServer({
      modbusSlaveConfig: {
        enabled: true,
        networkInterface: '0.0.0.0',
        port: 502,
        bufferMapping: { coils: { qxBits: 16 } },
      },
    })
    const parsed = JSON.parse(generateModbusSlaveConfig([partial])!)

    expect(parsed.buffer_mapping.coils.qx_bits).toBe(16)
    expect(parsed.buffer_mapping.coils.mx_bits).toBe(DEFAULT_BUFFER_MAPPING.coils.mxBits)
    expect(parsed.buffer_mapping.holding_registers.qw_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount)
    expect(parsed.buffer_mapping.discrete_inputs.ix_bits).toBe(DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits)
    expect(parsed.buffer_mapping.input_registers.iw_count).toBe(DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount)
  })

  it('generates config with correct network configuration', () => {
    const result = generateModbusSlaveConfig([makeModbusServer()])

    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.network_configuration.host).toBe('192.168.1.1')
    expect(parsed.network_configuration.port).toBe(5020)
  })

  it('uses default values when networkInterface and port are falsy', () => {
    const server = makeModbusServer()
    server.modbusSlaveConfig!.networkInterface = ''
    server.modbusSlaveConfig!.port = 0

    const result = generateModbusSlaveConfig([server])
    const parsed = JSON.parse(result!)
    expect(parsed.network_configuration.host).toBe('0.0.0.0')
    expect(parsed.network_configuration.port).toBe(502)
  })

  it('uses default buffer mapping when no bufferMapping is provided', () => {
    const result = generateModbusSlaveConfig([makeModbusServer()])

    const parsed = JSON.parse(result!)
    const bm = parsed.buffer_mapping
    expect(bm.holding_registers.qw_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount)
    expect(bm.holding_registers.mw_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount)
    expect(bm.holding_registers.md_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.mdCount)
    expect(bm.holding_registers.ml_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.mlCount)
    expect(bm.coils.qx_bits).toBe(DEFAULT_BUFFER_MAPPING.coils.qxBits)
    expect(bm.coils.mx_bits).toBe(DEFAULT_BUFFER_MAPPING.coils.mxBits)
    expect(bm.discrete_inputs.ix_bits).toBe(DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits)
    expect(bm.input_registers.iw_count).toBe(DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount)
  })

  it('uses custom buffer mapping when provided', () => {
    const server = makeModbusServer()
    server.modbusSlaveConfig!.bufferMapping = {
      holdingRegisters: { qwCount: 100, mwCount: 200, mdCount: 300, mlCount: 400 },
      coils: { qxBits: 500, mxBits: 600 },
      discreteInputs: { ixBits: 700 },
      inputRegisters: { iwCount: 800 },
    }

    const result = generateModbusSlaveConfig([server])
    const parsed = JSON.parse(result!)
    const bm = parsed.buffer_mapping
    expect(bm.holding_registers.qw_count).toBe(100)
    expect(bm.holding_registers.mw_count).toBe(200)
    expect(bm.holding_registers.md_count).toBe(300)
    expect(bm.holding_registers.ml_count).toBe(400)
    expect(bm.coils.qx_bits).toBe(500)
    expect(bm.coils.mx_bits).toBe(600)
    expect(bm.discrete_inputs.ix_bits).toBe(700)
    expect(bm.input_registers.iw_count).toBe(800)
  })

  it('uses defaults for individual missing fields in partial buffer mapping', () => {
    const server = makeModbusServer()
    server.modbusSlaveConfig!.bufferMapping = {
      holdingRegisters: { qwCount: 50 },
      // coils, discreteInputs, inputRegisters not provided
    }

    const result = generateModbusSlaveConfig([server])
    const parsed = JSON.parse(result!)
    const bm = parsed.buffer_mapping
    expect(bm.holding_registers.qw_count).toBe(50)
    expect(bm.holding_registers.mw_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount)
    expect(bm.coils.qx_bits).toBe(DEFAULT_BUFFER_MAPPING.coils.qxBits)
    expect(bm.discrete_inputs.ix_bits).toBe(DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits)
    expect(bm.input_registers.iw_count).toBe(DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount)
  })

  it('finds first modbus-tcp server in mixed array', () => {
    const servers: PLCServer[] = [
      { name: 'S7', protocol: 's7comm' },
      makeModbusServer(),
      { name: 'OPC-UA', protocol: 'opcua' },
    ]

    const result = generateModbusSlaveConfig(servers)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.network_configuration.host).toBe('192.168.1.1')
  })

  it('generates valid JSON output', () => {
    const result = generateModbusSlaveConfig([makeModbusServer()])
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  it('uses defaults when bufferMapping sub-objects are undefined', () => {
    const server = makeModbusServer()
    server.modbusSlaveConfig!.bufferMapping = {}

    const result = generateModbusSlaveConfig([server])
    const parsed = JSON.parse(result!)
    const bm = parsed.buffer_mapping
    expect(bm.holding_registers.qw_count).toBe(DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount)
    expect(bm.coils.qx_bits).toBe(DEFAULT_BUFFER_MAPPING.coils.qxBits)
    expect(bm.discrete_inputs.ix_bits).toBe(DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits)
    expect(bm.input_registers.iw_count).toBe(DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount)
  })
})
