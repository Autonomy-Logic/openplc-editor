/**
 * THE place a Modbus client is built from connection params.
 *
 * There used to be nine: the debug session, two lazy-reconnect paths, a transient
 * one per run/stop command, the md5 verify, the license probe, the connect probe.
 * Each repeated the same option literals and, worse, each decided on its own which
 * transport it would accept — which is how a run/stop command over Modbus TCP came
 * to open a second socket instead of using the connection already open.
 *
 * Building a client is now the only transport-specific step in the whole flow;
 * everything downstream talks to `DeviceModbusTransport`.
 */
import type { DeviceModbusTransport } from '../../shared/debug/types'
import { ModbusTcpClient } from '../modbus/modbus-client'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'

/** Transports that speak Modbus to a device. `websocket` (runtime v4) does not. */
export type DeviceModbusTransportKind = 'rtu' | 'tcp' | 'simulator'

export interface DeviceTransportParams {
  connectionType?: string
  /** RTU: serial port path. TCP: optional numeric port override. */
  port?: string | number
  baudRate?: number
  slaveId?: number
  /** TCP host. `ipAddress` is accepted as an alias, as the debug specs emit that. */
  host?: string
  ipAddress?: string
}

export interface DeviceTransportOptions {
  /**
   * Request timeout. The default suits interactive debug traffic; the license
   * probe passes a shorter one because it retries while a board is still booting.
   */
  timeoutMs?: number
  /**
   * In-process serial port for the simulator target. Required for
   * `connectionType: 'simulator'`, meaningless otherwise.
   */
  virtualSerialPort?: ConstructorParameters<typeof ModbusRtuClient>[0]['serialPort']
}

/** Standard Modbus TCP port. */
const MODBUS_TCP_PORT = 502
const DEFAULT_TIMEOUT_MS = 5000

/** Which Modbus transport do these params describe, if any? */
export function modbusTransportKind(connectionType: string | undefined): DeviceModbusTransportKind | null {
  if (connectionType === 'tcp' || connectionType === 'rtu' || connectionType === 'simulator') return connectionType
  // An absent type means serial, matching the license factory's long-standing default.
  return connectionType === undefined ? 'rtu' : null
}

/**
 * Build an unconnected Modbus client. Returns `{ error }` rather than throwing
 * when the params for the chosen transport are incomplete, so every caller
 * surfaces the same message instead of inventing its own.
 */
export function buildDeviceModbusTransport(
  params: DeviceTransportParams,
  options: DeviceTransportOptions = {},
): { client: DeviceModbusTransport } | { error: string } {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const kind = modbusTransportKind(params.connectionType)

  if (kind === 'simulator') {
    if (!options.virtualSerialPort) return { error: 'The simulator transport needs an in-process serial port' }
    return {
      client: new ModbusRtuClient({
        port: 'simulator',
        baudRate: 115200,
        slaveId: 1,
        timeout,
        serialPort: options.virtualSerialPort,
      }),
    }
  }

  if (kind === 'tcp') {
    const host = params.host ?? params.ipAddress
    if (!host) return { error: 'IP address is required for a Modbus TCP connection' }
    return {
      client: new ModbusTcpClient({
        host,
        port: typeof params.port === 'number' ? params.port : MODBUS_TCP_PORT,
        timeout,
      }),
    }
  }

  if (kind === 'rtu') {
    if (!params.port || typeof params.port !== 'string') {
      return { error: 'A serial port is required for a Modbus RTU connection' }
    }
    return {
      client: new ModbusRtuClient({
        port: params.port,
        baudRate: params.baudRate ?? 115200,
        slaveId: params.slaveId ?? 1,
        timeout,
      }),
    }
  }

  return { error: `Unsupported Modbus transport: ${String(params.connectionType)}` }
}
