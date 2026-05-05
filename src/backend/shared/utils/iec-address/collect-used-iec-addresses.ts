/**
 * Canonical collector of IEC addresses currently claimed across every I/O
 * source that shares the Runtime v4 image table:
 *
 *   - Modbus TCP remote-device I/O points (`modbusTcpConfig.ioGroups`)
 *   - EtherCAT remote-device channel mappings (`ethercatConfig.devices`)
 *   - VPP vendor module I/O mappings (`vendorScreenData['io-mapping'].entries`)
 *
 * Auto-allocators (EtherCAT scan, VPP io-table generation) must seed from
 * this set so a device added after another one doesn't land on the same
 * address.
 *
 * Local pin mapping (Arduino) is deliberately excluded — pin-mapped
 * addresses don't reach the Runtime v4 image table and live in a
 * separate namespace.
 *
 * Types are structural so both schema-derived PLC types and the store's
 * inferred types can be passed without conversion.
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

type VendorScreenDataForAddressCollection =
  | {
      'io-mapping'?: {
        entries?: Array<{ iecAddress?: string }>
      }
    }
  | Record<string, unknown>
  | undefined

export function collectUsedIecAddresses(
  remoteDevices: RemoteDeviceForAddressCollection[] | undefined,
  vendorScreenData?: VendorScreenDataForAddressCollection,
): Set<string> {
  const addresses = new Set<string>()

  if (remoteDevices) {
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
  }

  const ioMapping = (vendorScreenData as { 'io-mapping'?: { entries?: Array<{ iecAddress?: string }> } } | undefined)?.[
    'io-mapping'
  ]
  for (const entry of ioMapping?.entries ?? []) {
    if (entry.iecAddress) addresses.add(entry.iecAddress)
  }

  return addresses
}
