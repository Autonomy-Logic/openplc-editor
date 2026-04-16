/**
 * Collect every IEC address (e.g. `%QX0.0`, `%IW2`) currently in use across
 * all remote devices in the project — Modbus TCP I/O points and EtherCAT
 * channel mappings. Used to seed `generateDefaultChannelMappings` so newly
 * added devices receive non-conflicting IEC locations.
 *
 * Typed structurally to accept both the schema-derived `PLCRemoteDevice`
 * type and the store's slightly looser inferred type without coupling.
 */

type RemoteDeviceForAddressCollection = {
  modbusTcpConfig?: {
    ioGroups?: Array<{
      ioPoints?: Array<{ iecLocation: string }>
    }>
  }
  ethercatConfig?: {
    devices?: Array<{
      channelMappings?: Array<{ iecLocation: string }>
    }>
  }
}

export function collectUsedIecAddresses(remoteDevices: RemoteDeviceForAddressCollection[] | undefined): Set<string> {
  const addresses = new Set<string>()
  if (!remoteDevices) return addresses

  for (const rd of remoteDevices) {
    for (const group of rd.modbusTcpConfig?.ioGroups ?? []) {
      for (const point of group.ioPoints ?? []) {
        addresses.add(point.iecLocation)
      }
    }
    for (const dev of rd.ethercatConfig?.devices ?? []) {
      for (const mapping of dev.channelMappings ?? []) {
        addresses.add(mapping.iecLocation)
      }
    }
  }
  return addresses
}
