import type { PLCRemoteDevice } from '../../../../../middleware/shared/ports/types'
import { generateModbusMasterConfig } from '../generate-modbus-master-config'

const makeTcpDevice = (overrides?: Partial<PLCRemoteDevice>): PLCRemoteDevice => ({
  name: 'Device1',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    host: '192.168.1.100',
    port: 502,
    slaveId: 1,
    timeout: 1000,
    ioGroups: [
      {
        id: 'g1',
        name: 'Group1',
        functionCode: '3',
        cycleTime: 100,
        offset: '0',
        length: 10,
        errorHandling: 'keep-last-value',
        ioPoints: [{ id: 'p1', name: 'Point1', type: 'WORD', iecLocation: '%MW0' }],
      },
    ],
  },
  ...overrides,
})

const makeRtuDevice = (): PLCRemoteDevice => ({
  name: 'RTUDevice',
  protocol: 'modbus-tcp',
  modbusTcpConfig: {
    transport: 'rtu',
    serialPort: '/dev/ttyUSB0',
    baudRate: 19200,
    parity: 'E',
    stopBits: 1,
    dataBits: 8,
    slaveId: 2,
    timeout: 500,
    ioGroups: [
      {
        id: 'g1',
        name: 'Group1',
        functionCode: '1',
        cycleTime: 200,
        offset: '100',
        length: 16,
        errorHandling: 'set-to-zero',
        ioPoints: [{ id: 'p1', name: 'Coil1', type: 'BOOL', iecLocation: '%QX0.0' }],
      },
    ],
  },
})

describe('generateModbusMasterConfig', () => {
  it('returns null for undefined input', () => {
    expect(generateModbusMasterConfig(undefined)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(generateModbusMasterConfig([])).toBeNull()
  })

  it('returns null when no modbus-tcp devices exist', () => {
    const devices: PLCRemoteDevice[] = [{ name: 'EtherCAT', protocol: 'ethercat' }]
    expect(generateModbusMasterConfig(devices)).toBeNull()
  })

  it('returns null when modbus-tcp device has no config', () => {
    const devices: PLCRemoteDevice[] = [{ name: 'NoConfig', protocol: 'modbus-tcp' }]
    expect(generateModbusMasterConfig(devices)).toBeNull()
  })

  it('returns null when modbus-tcp device has empty IO groups', () => {
    const devices: PLCRemoteDevice[] = [
      {
        name: 'EmptyGroups',
        protocol: 'modbus-tcp',
        modbusTcpConfig: {
          timeout: 1000,
          ioGroups: [],
        },
      },
    ]
    expect(generateModbusMasterConfig(devices)).toBeNull()
  })

  it('generates TCP config with correct structure', () => {
    const result = generateModbusMasterConfig([makeTcpDevice()])

    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Device1')
    expect(parsed[0].protocol).toBe('MODBUS')
    expect(parsed[0].config.type).toBe('SLAVE')
    expect(parsed[0].config.transport).toBe('tcp')
    expect(parsed[0].config.host).toBe('192.168.1.100')
    expect(parsed[0].config.port).toBe(502)
    expect(parsed[0].config.timeout_ms).toBe(1000)
    expect(parsed[0].config.slave_id).toBe(1)
  })

  it('generates IO points with correct function code and hex offset', () => {
    const result = generateModbusMasterConfig([makeTcpDevice()])

    const parsed = JSON.parse(result!)
    const ioPoints = parsed[0].config.io_points
    expect(ioPoints).toHaveLength(1)
    expect(ioPoints[0].fc).toBe(3)
    expect(ioPoints[0].offset).toBe('0x0000')
    expect(ioPoints[0].iec_location).toBe('%MW0')
    expect(ioPoints[0].len).toBe(10)
    expect(ioPoints[0].cycle_time_ms).toBe(100)
  })

  it('generates RTU config with serial port parameters', () => {
    const result = generateModbusMasterConfig([makeRtuDevice()])

    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.transport).toBe('rtu')
    expect(parsed[0].config.serial_port).toBe('/dev/ttyUSB0')
    expect(parsed[0].config.baud_rate).toBe(19200)
    expect(parsed[0].config.parity).toBe('E')
    expect(parsed[0].config.stop_bits).toBe(1)
    expect(parsed[0].config.data_bits).toBe(8)
    expect(parsed[0].config.slave_id).toBe(2)
  })

  it('returns null for RTU device without serial port', () => {
    const device: PLCRemoteDevice = {
      name: 'BadRTU',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        transport: 'rtu',
        timeout: 500,
        ioGroups: [
          {
            id: 'g1',
            name: 'Group1',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'keep-last-value',
            ioPoints: [{ id: 'p1', name: 'P1', type: 'WORD', iecLocation: '%MW0' }],
          },
        ],
      },
    }

    expect(generateModbusMasterConfig([device])).toBeNull()
  })

  it('logs a skip warning for an RTU device without a serial port', () => {
    const device: PLCRemoteDevice = {
      name: 'BadRTU',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        transport: 'rtu',
        timeout: 500,
        ioGroups: [
          {
            id: 'g1',
            name: 'Group1',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'keep-last-value',
            ioPoints: [{ id: 'p1', name: 'P1', type: 'WORD', iecLocation: '%MW0' }],
          },
        ],
      },
    }

    const log = jest.fn()
    expect(generateModbusMasterConfig([device], log)).toBeNull()
    expect(log).toHaveBeenCalledWith(
      'Modbus RTU device "BadRTU" is missing a serial port configuration and will be skipped.',
    )
  })

  it('uses default values for optional TCP fields', () => {
    const device: PLCRemoteDevice = {
      name: 'Defaults',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        timeout: 1000,
        ioGroups: [
          {
            id: 'g1',
            name: 'Group1',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'keep-last-value',
            ioPoints: [{ id: 'p1', name: 'P1', type: 'WORD', iecLocation: '%MW0' }],
          },
        ],
      },
    }

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.host).toBe('127.0.0.1')
    expect(parsed[0].config.port).toBe(502)
    expect(parsed[0].config.slave_id).toBe(1)
  })

  it('uses default values for optional RTU fields', () => {
    const device: PLCRemoteDevice = {
      name: 'RTUDefaults',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        transport: 'rtu',
        serialPort: '/dev/ttyS0',
        timeout: 500,
        ioGroups: [
          {
            id: 'g1',
            name: 'Group1',
            functionCode: '3',
            cycleTime: 100,
            offset: '0',
            length: 1,
            errorHandling: 'keep-last-value',
            ioPoints: [{ id: 'p1', name: 'P1', type: 'WORD', iecLocation: '%MW0' }],
          },
        ],
      },
    }

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.baud_rate).toBe(9600)
    expect(parsed[0].config.parity).toBe('N')
    expect(parsed[0].config.stop_bits).toBe(1)
    expect(parsed[0].config.data_bits).toBe(8)
    expect(parsed[0].config.slave_id).toBe(1)
  })

  it('formats hex offset that is already in hex format', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].offset = '0xABCD'

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].offset).toBe('0xABCD')
  })

  it('formats decimal offset as hex string', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].offset = '256'

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].offset).toBe('0x0100')
  })

  it('handles non-numeric offset by returning 0x0000', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].offset = 'abc'

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].offset).toBe('0x0000')
  })

  it('uses default IEC location when io group has no IO points', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].ioPoints = []

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].iec_location).toBe('%MW0')
  })

  it('uses default IEC location when ioPoints is undefined', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].ioPoints = undefined

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].iec_location).toBe('%MW0')
  })

  it('processes multiple devices', () => {
    const result = generateModbusMasterConfig([makeTcpDevice({ name: 'Dev1' }), makeTcpDevice({ name: 'Dev2' })])

    const parsed = JSON.parse(result!)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('Dev1')
    expect(parsed[1].name).toBe('Dev2')
  })

  it('skips non-modbus devices in mixed array', () => {
    const devices: PLCRemoteDevice[] = [{ name: 'EtherCAT', protocol: 'ethercat' }, makeTcpDevice({ name: 'Modbus1' })]

    const result = generateModbusMasterConfig(devices)
    const parsed = JSON.parse(result!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Modbus1')
  })

  it('handles offset with leading/trailing whitespace', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].offset = '  10  '

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].offset).toBe('0x000A')
  })

  it('handles hex offset case-insensitively', () => {
    const device = makeTcpDevice()
    device.modbusTcpConfig!.ioGroups[0].offset = '0Xff'

    const result = generateModbusMasterConfig([device])
    const parsed = JSON.parse(result!)
    expect(parsed[0].config.io_points[0].offset).toBe('0Xff')
  })

  it('uses default ioGroups as empty when undefined', () => {
    const device: PLCRemoteDevice = {
      name: 'NoGroups',
      protocol: 'modbus-tcp',
      modbusTcpConfig: {
        timeout: 1000,
        ioGroups: undefined as unknown as [],
      },
    }

    // The filter will match (protocol + config present), but convertRemoteDeviceToModbusMaster
    // returns null due to empty ioGroups
    expect(generateModbusMasterConfig([device])).toBeNull()
  })
})
