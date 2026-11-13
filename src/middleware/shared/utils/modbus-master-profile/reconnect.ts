import type { ModbusMasterTransport } from './profile'

/**
 * Whether the master reconnects to a device after a failed or lost connection.
 * TCP only: an RTU device answers `false`. A TCP device saved before the
 * option existed carries no value and resolves to `true`.
 */
export function resolveReconnect(config: { transport?: ModbusMasterTransport; reconnect?: boolean }): boolean {
  if ((config.transport ?? 'tcp') !== 'tcp') return false
  return config.reconnect ?? true
}
