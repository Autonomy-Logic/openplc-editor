import type { ModbusIOGroup, PLCRemoteDevice } from '@root/types/PLC/open-plc'

interface ModbusMasterIOPoint {
  fc: number
  offset: string
  iec_location: string
  len: number
  cycle_time_ms: number
}

// Base device config with common fields
interface ModbusMasterDeviceConfigBase {
  type: 'SLAVE'
  transport: 'tcp' | 'rtu'
  timeout_ms: number
  slave_id: number
  io_points: ModbusMasterIOPoint[]
}

// TCP-specific config
interface ModbusMasterTcpDeviceConfig extends ModbusMasterDeviceConfigBase {
  transport: 'tcp'
  host: string
  port: number
}

// RTU-specific config
interface ModbusMasterRtuDeviceConfig extends ModbusMasterDeviceConfigBase {
  transport: 'rtu'
  serial_port: string
  baud_rate: number
  parity: string
  stop_bits: number
  data_bits: number
}

type ModbusMasterDeviceConfig = ModbusMasterTcpDeviceConfig | ModbusMasterRtuDeviceConfig

interface ModbusMasterDevice {
  name: string
  protocol: 'MODBUS'
  config: ModbusMasterDeviceConfig
}

type ModbusMasterConfig = ModbusMasterDevice[]

/**
 * Formats an offset value as a hexadecimal string.
 * If the offset is already in hex format (starts with 0x), returns it as-is.
 * Otherwise, converts the decimal number to hex format.
 */
const formatOffsetAsHex = (offset: string): string => {
  const trimmedOffset = offset.trim()
  if (trimmedOffset.toLowerCase().startsWith('0x')) {
    return trimmedOffset
  }
  const numericOffset = parseInt(trimmedOffset, 10)
  if (isNaN(numericOffset)) {
    return '0x0000'
  }
  return `0x${numericOffset.toString(16).padStart(4, '0').toUpperCase()}`
}

/**
 * Converts a ModbusIOGroup to a ModbusMasterIOPoint for the runtime configuration.
 * Uses the first IO point's IEC location as the starting address for the group.
 */
const convertIOGroupToIOPoint = (ioGroup: ModbusIOGroup): ModbusMasterIOPoint => {
  const firstIOPoint = ioGroup.ioPoints[0]
  const iecLocation = firstIOPoint?.iecLocation || '%MW0'

  return {
    fc: parseInt(ioGroup.functionCode, 10),
    offset: formatOffsetAsHex(ioGroup.offset),
    iec_location: iecLocation,
    len: ioGroup.length,
    cycle_time_ms: ioGroup.cycleTime,
  }
}

/**
 * Converts a PLCRemoteDevice with Modbus configuration to a ModbusMasterDevice
 * for the runtime configuration. Supports both TCP and RTU transports.
 */
const convertRemoteDeviceToModbusMaster = (device: PLCRemoteDevice): ModbusMasterDevice | null => {
  if (device.protocol !== 'modbus-tcp' || !device.modbusTcpConfig) {
    return null
  }

  const { modbusTcpConfig } = device
  const ioGroups = modbusTcpConfig.ioGroups || []

  if (ioGroups.length === 0) {
    return null
  }

  const ioPoints: ModbusMasterIOPoint[] = ioGroups.map(convertIOGroupToIOPoint)

  // Determine transport type (defaults to 'tcp' for backward compatibility)
  const transport = modbusTcpConfig.transport || 'tcp'

  if (transport === 'rtu') {
    // RTU configuration
    if (!modbusTcpConfig.serialPort) {
      // RTU requires a serial port
      console.warn(`Modbus RTU device "${device.name}" is missing a serial port configuration and will be skipped.`)
      return null
    }

    return {
      name: device.name,
      protocol: 'MODBUS',
      config: {
        type: 'SLAVE',
        transport: 'rtu',
        serial_port: modbusTcpConfig.serialPort,
        baud_rate: modbusTcpConfig.baudRate ?? 9600,
        parity: modbusTcpConfig.parity ?? 'N',
        stop_bits: modbusTcpConfig.stopBits ?? 1,
        data_bits: modbusTcpConfig.dataBits ?? 8,
        timeout_ms: modbusTcpConfig.timeout,
        slave_id: modbusTcpConfig.slaveId ?? 1,
        io_points: ioPoints,
      },
    }
  } else {
    // TCP configuration (default)
    return {
      name: device.name,
      protocol: 'MODBUS',
      config: {
        type: 'SLAVE',
        transport: 'tcp',
        host: modbusTcpConfig.host ?? '127.0.0.1',
        port: modbusTcpConfig.port ?? 502,
        timeout_ms: modbusTcpConfig.timeout,
        slave_id: modbusTcpConfig.slaveId ?? 1,
        io_points: ioPoints,
      },
    }
  }
}

/**
 * Generates the Modbus Master plugin configuration JSON from the project's remote devices.
 * Returns null if there are no Modbus TCP devices configured.
 *
 * @param remoteDevices - Array of PLCRemoteDevice from the project data
 * @returns The Modbus Master configuration as a JSON string, or null if no devices are configured
 */
export const generateModbusMasterConfig = (remoteDevices: PLCRemoteDevice[] | undefined): string | null => {
  if (!remoteDevices || remoteDevices.length === 0) {
    return null
  }

  const modbusTcpDevices = remoteDevices.filter((device) => device.protocol === 'modbus-tcp' && device.modbusTcpConfig)

  if (modbusTcpDevices.length === 0) {
    return null
  }

  const config: ModbusMasterConfig = modbusTcpDevices
    .map(convertRemoteDeviceToModbusMaster)
    .filter((device): device is ModbusMasterDevice => device !== null)

  if (config.length === 0) {
    return null
  }

  return JSON.stringify(config, null, 2)
}

export type { ModbusMasterConfig, ModbusMasterDevice, ModbusMasterDeviceConfig, ModbusMasterIOPoint }
