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

  // NFR02. `ModbusSlaveConfig` gained the RTU wiring so one screen can configure
  // baremetal and Runtime v4 alike, but the v4 plugin's config file is a
  // contract with software already in the field: a key it does not expect is a
  // change to that contract. The generator builds an explicit shape rather than
  // spreading the config, and this is what keeps it that way.
  it('does not leak the serial transport fields into the runtime plugin config', () => {
    const server = makeModbusServer()
    Object.assign(server.modbusSlaveConfig!, {
      transports: ['rtu', 'tcp'],
      slaveId: 7,
      serialPort: 'Serial1',
      baudRate: 19200,
      parity: 'N',
      stopBits: 1,
      dataBits: 8,
    })

    const withSerial = generateModbusSlaveConfig([server])
    const withoutSerial = generateModbusSlaveConfig([makeModbusServer()])

    expect(withSerial).toBe(withoutSerial)
    expect(Object.keys(JSON.parse(withSerial!))).toEqual(['network_configuration', 'buffer_mapping'])
  })
})

/**
 * The master switch has to mean something on Runtime v4 too.
 *
 * The runtime's plugin has no switch of its own: it comes up if and only if
 * `conf/modbus_slave.json` is in the bundle. So a disabled server producing a
 * config is a server the user turned off and the runtime served anyway -- the
 * same toggle working on baremetal and lying here.
 */
describe('generateModbusSlaveConfig — a disabled server is not served', () => {
  const server = (name: string, enabled: boolean, port: number): PLCServer => ({
    name,
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled, networkInterface: '0.0.0.0', port },
  })

  it('emits nothing at all for a server the user switched off', () => {
    // `null` is what keeps the file out of the bundle, and keeping the file out
    // is the only way to express "off" to this plugin.
    expect(generateModbusSlaveConfig([server('Off', false, 502)])).toBeNull()
  })

  it('emits nothing when every server in the project is off', () => {
    expect(generateModbusSlaveConfig([server('A', false, 502), server('B', false, 5020)])).toBeNull()
  })

  it('skips a disabled server to reach the enabled one behind it', () => {
    // A project may carry several. Taking the first with a config regardless of
    // `enabled` handed the runtime the wrong one.
    const result = generateModbusSlaveConfig([server('Off', false, 502), server('On', true, 5020)])

    expect(result).not.toBeNull()
    expect(JSON.parse(result!).network_configuration.port).toBe(5020)
  })

  it('still serves an enabled server, unchanged', () => {
    const result = generateModbusSlaveConfig([server('On', true, 502)])
    expect(JSON.parse(result!).network_configuration.port).toBe(502)
  })
})
