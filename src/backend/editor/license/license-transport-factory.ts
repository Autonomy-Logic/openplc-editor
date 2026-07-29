/**
 * Transport factory for the license flow (F0). Builds the right
 * `LicenseCapableTransport` from a `connectionType`, so BOTH the connect-probe
 * and the activation step pick the transport identically -- serial (Arduino),
 * TCP, or the runtime-v4 debug WebSocket. Extracted from
 * `handleActivateDeviceLicense` so there is one place that maps params -> client.
 */
import type { LicenseCapableTransport } from '../../shared/debug/types'
import { WebSocketDebugTransport } from '../../shared/debug/websocket-debug-transport'
import { ModbusTcpClient } from '../modbus/modbus-client'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'

export interface LicenseTransportParams {
  connectionType?: 'rtu' | 'tcp' | 'websocket'
  /** RTU: serial port path (string). TCP/WS: optional numeric port override. */
  port?: string | number
  baudRate?: number
  slaveId?: number
  /** Required for tcp/websocket. */
  host?: string
  /** Required for websocket (runtime JWT). */
  token?: string
}

/**
 * Build the transient transport for a license operation. Returns `{ error }`
 * (never throws) when required params for the chosen transport are missing, so
 * callers surface it as a best-effort failure. `defaultRuntimePort` is the
 * runtime API port used when a websocket target gives no explicit port.
 */
export function buildLicenseTransport(
  params: LicenseTransportParams,
  defaultRuntimePort: number,
): { client: LicenseCapableTransport } | { error: string } {
  const connectionType = params.connectionType ?? 'rtu'

  if (connectionType === 'websocket') {
    if (!params.host || !params.token) {
      return { error: 'host and token are required for websocket activation' }
    }
    return {
      client: new WebSocketDebugTransport({
        host: params.host,
        port: typeof params.port === 'number' ? params.port : defaultRuntimePort,
        token: params.token,
      }),
    }
  }

  if (connectionType === 'tcp') {
    if (!params.host) {
      return { error: 'host is required for tcp activation' }
    }
    return {
      client: new ModbusTcpClient({
        host: params.host,
        port: typeof params.port === 'number' ? params.port : 502,
        timeout: 2000,
      }),
    }
  }

  // rtu (default): Arduino over serial.
  if (!params.port || typeof params.port !== 'string') {
    return { error: 'Port is required for license activation' }
  }
  return {
    client: new ModbusRtuClient({
      port: params.port,
      baudRate: params.baudRate ?? 115200,
      slaveId: params.slaveId ?? 1,
      timeout: 2000, // short: the id read is retried while the board boots
    }),
  }
}
