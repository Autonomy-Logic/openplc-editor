import type { ModbusIOGroup, PLCRemoteDevice } from '@root/types/PLC/open-plc'

interface ModbusMasterIOPoint {
  fc: number
  offset: string
  iec_location: string
  len: number
  cycle_time_ms: number
}

interface ModbusMasterDeviceConfig {
  type: 'SLAVE'
  host: string
  port: number
  timeout_ms: number
  slave_id: number
  io_points: ModbusMasterIOPoint[]
}

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
 * Converts a PLCRemoteDevice with Modbus TCP configuration to a ModbusMasterDevice
 * for the runtime configuration.
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

  return {
    name: device.name,
    protocol: 'MODBUS',
    config: {
      type: 'SLAVE',
      host: modbusTcpConfig.host,
      port: modbusTcpConfig.port,
      timeout_ms: modbusTcpConfig.timeout,
      slave_id: modbusTcpConfig.slaveId ?? 1,
      io_points: ioPoints,
    },
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
