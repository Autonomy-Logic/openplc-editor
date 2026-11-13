import type { ModbusRemoteTcpConfig } from '../../ports/types'
import { hostOf, parseIpv4, tcpPortOf, transportOf } from './fields'
import type { ModbusMasterProfile } from './profile'

/**
 * The key that groups TCP devices sharing one connection: `host:port`.
 *
 * On an `ipv4-only` target the host is the parsed IPv4 address of the trimmed
 * host, so two spellings of one address share a key, and a host that is not
 * IPv4 has none. Elsewhere it is the host text exactly as the Runtime v4 JSON
 * emits it. RTU devices have no key.
 */
export function endpointKey(config: ModbusRemoteTcpConfig, profile: ModbusMasterProfile): string | null {
  if (transportOf(config) !== 'tcp') return null
  const host = hostOf(config)
  const port = String(tcpPortOf(config))
  if (profile.hostKind === 'ipv4-or-hostname') return `${host}:${port}`
  const octets = parseIpv4(host)
  return octets ? `${octets.join('.')}:${port}` : null
}
