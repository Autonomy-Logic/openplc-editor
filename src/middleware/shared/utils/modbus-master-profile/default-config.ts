import type { ModbusRemoteTcpConfig } from '../../ports/types'
import type { ModbusMasterProfile } from './profile'

/** Host a TCP device gets when none is stored, and the one the Runtime v4 JSON falls back to. */
export const DEFAULT_REMOTE_DEVICE_HOST = '127.0.0.1'

/** Port a TCP device gets when none is stored, and the one the Runtime v4 JSON falls back to. */
export const DEFAULT_REMOTE_DEVICE_PORT = 502

const DEFAULT_REMOTE_DEVICE_TIMEOUT_MS = 1000

const DEFAULT_REMOTE_DEVICE_SLAVE_ID = 1

/** The first board UART an RTU device can use, or `undefined` where the ports come from the runtime. */
export function firstBoardRtuPort(profile: ModbusMasterProfile): string | undefined {
  return profile.rtuPorts.source === 'board' ? profile.rtuPorts.ports[0] : undefined
}

/**
 * The Modbus configuration of a newly created remote device: the first
 * transport the target offers, Reconnect unchecked, and on a baremetal RTU
 * device the first spare board UART.
 */
export function createDefaultRemoteDeviceConfig(profile: ModbusMasterProfile): ModbusRemoteTcpConfig {
  const transport = profile.transports[0]
  const serialPort = transport === 'rtu' ? firstBoardRtuPort(profile) : undefined

  return {
    ...(transport ? { transport } : {}),
    host: DEFAULT_REMOTE_DEVICE_HOST,
    port: DEFAULT_REMOTE_DEVICE_PORT,
    ...(serialPort ? { serialPort } : {}),
    slaveId: DEFAULT_REMOTE_DEVICE_SLAVE_ID,
    timeout: DEFAULT_REMOTE_DEVICE_TIMEOUT_MS,
    ioGroups: [],
    reconnect: false,
  }
}
