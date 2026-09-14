/**
 * Servers and remote devices as `apply` would accept them back.
 *
 * Two rules decide what is left out.
 *
 * **Secrets are redacted.** `security.serverPrivateKeyCustom` and every
 * `users[].passwordHash` are dropped rather than printed, because `describe`
 * output ends up in logs and diffs. `apply` preserves the stored value when the
 * key is absent, so a round trip keeps them.
 *
 * **Allocated addresses are not part of the spec.** `ioPoints[].iecLocation`
 * and the EtherCAT channel locations are decided by the allocator from the
 * whole project. A spec containing them would stop round-tripping the moment
 * allocation differed, so they go under a sibling `protocolAddresses` key —
 * still answering "what address did my point get", without pretending to be
 * an input.
 */

import type { PLCRemoteDevice, PLCServer } from '@root/middleware/shared/ports/types'

export interface DescribedProtocols {
  servers: Record<string, unknown>[]
  remoteDevices: Record<string, unknown>[]
  /** Read-only: what the allocator decided. Never part of `spec`. */
  protocolAddresses: Record<string, unknown>[]
}

export function describeProtocols(
  servers: readonly PLCServer[],
  remoteDevices: readonly PLCRemoteDevice[],
): DescribedProtocols {
  return {
    servers: servers.map(describeServer),
    remoteDevices: remoteDevices.map(describeRemoteDevice),
    protocolAddresses: describeAddresses(remoteDevices),
  }
}

function describeServer(server: PLCServer): Record<string, unknown> {
  const out: Record<string, unknown> = { name: server.name, protocol: server.protocol }

  if (server.protocol === 'modbus-tcp') {
    const config = server.modbusSlaveConfig
    if (!config) return out
    out.enabled = config.enabled
    out.modbus = {
      networkInterface: config.networkInterface,
      port: config.port,
      ...(config.bufferMapping ? { bufferMapping: config.bufferMapping } : {}),
    }
    return out
  }

  if (server.protocol === 's7comm') {
    const config = server.s7commSlaveConfig
    if (!config) return out
    const { enabled, ...server7 } = config.server
    out.enabled = enabled
    out.s7comm = {
      server: server7,
      ...(config.plcIdentity ? { plcIdentity: config.plcIdentity } : {}),
      dataBlocks: config.dataBlocks,
      ...(config.systemAreas ? { systemAreas: config.systemAreas } : {}),
      ...(config.logging ? { logging: config.logging } : {}),
    }
    return out
  }

  const config = server.opcuaServerConfig
  if (!config) return out
  const { enabled, ...settings } = config.server
  out.enabled = enabled
  out.opcua = {
    server: settings,
    securityProfiles: config.securityProfiles,
    security: {
      serverCertificateStrategy: config.security.serverCertificateStrategy,
      serverCertificateCustom: config.security.serverCertificateCustom,
      trustedClientCertificates: config.security.trustedClientCertificates,
    },
    users: config.users.map(({ passwordHash: _redacted, ...user }) => user),
    cycleTimeMs: config.cycleTimeMs,
    addressSpace: config.addressSpace,
  }
  return out
}

function describeRemoteDevice(device: PLCRemoteDevice): Record<string, unknown> {
  const out: Record<string, unknown> = { name: device.name, protocol: device.protocol }

  if (device.protocol === 'modbus-tcp') {
    const config = device.modbusTcpConfig
    if (!config) return out
    const { ioGroups, ...connection } = config
    out.modbus = {
      ...connection,
      ioGroups: ioGroups.map(({ id: _derived, ioPoints, ...group }) => {
        // Aliases are authored, not allocated, so they belong in the spec —
        // unlike the addresses beside them.
        const aliases = (ioPoints ?? []).map((point) => point.alias ?? '')
        const named = aliases.filter((alias) => alias.length > 0).length
        return { ...group, ...(named > 0 ? { aliases: aliases.slice(0, lastNamed(aliases) + 1) } : {}) }
      }),
    }
    return out
  }

  const config = device.ethercatConfig
  if (!config) return out
  out.ethercat = {
    ...(config.masterConfig ? { master: config.masterConfig } : {}),
    slaves: config.devices.map((slave) => ({
      esiDeviceRef: slave.esiDeviceRef,
      name: slave.name,
      ...(slave.position === undefined ? {} : { position: slave.position }),
      config: slave.config,
      ...(slave.cia402 ? { cia402: slave.cia402 } : {}),
      ...aliasesOf(slave.channelMappings),
    })),
  }
  return out
}

/** Index of the last named point, so trailing unnamed points are not emitted. */
function lastNamed(aliases: readonly string[]): number {
  for (let index = aliases.length - 1; index >= 0; index -= 1) {
    if (aliases[index].length > 0) return index
  }
  return -1
}

function aliasesOf(mappings: readonly { channelId: string; alias?: string }[] | undefined): Record<string, unknown> {
  const aliases: Record<string, string> = {}
  for (const mapping of mappings ?? []) {
    if (mapping.alias) aliases[mapping.channelId] = mapping.alias
  }
  return Object.keys(aliases).length > 0 ? { aliases } : {}
}

/** Every IEC address the allocator handed a remote device's points and channels. */
function describeAddresses(remoteDevices: readonly PLCRemoteDevice[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  for (const device of remoteDevices) {
    for (const group of device.modbusTcpConfig?.ioGroups ?? []) {
      for (const point of group.ioPoints ?? []) {
        rows.push({
          device: device.name,
          group: group.name,
          point: point.name,
          type: point.type,
          iecLocation: point.iecLocation,
          ...(point.alias ? { alias: point.alias } : {}),
        })
      }
    }
    for (const slave of device.ethercatConfig?.devices ?? []) {
      for (const mapping of slave.channelMappings ?? []) {
        rows.push({
          device: device.name,
          slave: slave.name,
          channel: mapping.channelId,
          iecLocation: mapping.iecLocation,
          ...(mapping.alias ? { alias: mapping.alias } : {}),
        })
      }
    }
  }

  return rows
}
