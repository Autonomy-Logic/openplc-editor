/**
 * Transport factory for the license flow (F0). Builds the right
 * `LicenseCapableTransport` from a `connectionType`, so BOTH the connect-probe
 * and the activation step pick the transport identically -- serial (Arduino),
 * TCP, or the runtime-v4 debug WebSocket. Extracted from
 * `handleActivateDeviceLicense` so there is one place that maps params -> client.
 *
 * The runtime-v4 WebSocket is this file's own business (licensing is the only
 * thing that rides it); serial and TCP defer to `buildDeviceModbusTransport`, so
 * a Modbus client is constructed in exactly one place.
 */
import type { LicenseCapableTransport } from '../../shared/debug/types'
import { WebSocketDebugTransport } from '../../shared/debug/websocket-debug-transport'
import { buildDeviceModbusTransport } from '../hardware/device-transport-factory'

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

  // Serial and TCP are plain Modbus device links: build them where every other
  // Modbus client is built. The short timeout is this flow's own concern — the
  // board-id read is retried while a board is still booting.
  return buildDeviceModbusTransport(
    { connectionType, port: params.port, baudRate: params.baudRate, slaveId: params.slaveId, host: params.host },
    { timeoutMs: 2000 },
  )
}
