import type { DebugConnectionConfig } from '../ports/types'

/**
 * How a connection endpoint reads to a user: a serial path ("/dev/ttyACM0",
 * "COM5") or an IP address.
 *
 * Shared between the main process (which labels the connection it holds) and the
 * renderer (which names endpoints in dialogs), so "could not reach X" and the
 * status bar always spell X the same way.
 */
export function describeDebugEndpoint(config: DebugConnectionConfig): string {
  if (config.connectionType === 'tcp') return String(config.connectionParams.ipAddress ?? 'the configured IP address')
  if (config.connectionType === 'simulator') return 'simulator'
  return String(config.connectionParams.port ?? 'the selected port')
}
