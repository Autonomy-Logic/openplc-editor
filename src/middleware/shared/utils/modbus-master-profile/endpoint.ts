import type { ModbusRemoteTcpConfig } from '../../ports/types'
import { DEFAULT_REMOTE_DEVICE_HOST, DEFAULT_REMOTE_DEVICE_PORT } from './default-config'
import type { ModbusMasterProfile } from './profile'

/** The four decimal octets of a dotted IPv4 address, or `null` when the text is not one. */
function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number.parseInt(part, 10)
    if (octet > 255) return null
    octets.push(octet)
  }
  return octets
}

/**
 * The key that groups TCP devices sharing one connection: `host:port`.
 *
 * On an `ipv4-only` target the host is the parsed IPv4 address, so two
 * spellings of one address share a key, and a host that is not IPv4 has none.
 * Elsewhere it is the host text exactly as the Runtime v4 JSON emits it. RTU
 * devices have no key.
 */
export function endpointKey(config: ModbusRemoteTcpConfig, profile: ModbusMasterProfile): string | null {
  if ((config.transport ?? 'tcp') !== 'tcp') return null
  const host = config.host ?? DEFAULT_REMOTE_DEVICE_HOST
  const port = config.port ?? DEFAULT_REMOTE_DEVICE_PORT
  if (profile.hostKind === 'ipv4-or-hostname') return `${host}:${port}`
  const octets = parseIpv4(host)
  return octets ? `${octets.join('.')}:${port}` : null
}
