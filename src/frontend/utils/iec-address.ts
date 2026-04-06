/**
 * IEC 61131-3 address utilities for global address allocation.
 *
 * Manages IEC address allocation across all IO sources: local pin mapping,
 * remote devices (Modbus TCP IO groups), and vendor module IO mappings.
 * This prevents address collisions when multiple IO sources coexist.
 *
 * Pure frontend utility — no backend or platform dependencies.
 */

import type { DevicePin, VendorIoMapping } from '../../middleware/shared/ports/types'

/**
 * Collects all used IEC addresses across the entire project:
 * local pin mapping, remote devices, and vendor module IO mappings.
 */
export function collectUsedIecAddresses(
  pinMapping: DevicePin[],
  remoteDevices: Array<{ modbusTcpConfig?: { ioGroups?: Array<{ ioPoints: Array<{ iecLocation: string }> }> } }>,
  vendorIoMapping?: VendorIoMapping,
): Set<string> {
  const used = new Set<string>()

  for (const pin of pinMapping) {
    if (pin.address) used.add(pin.address)
  }

  for (const device of remoteDevices) {
    if (device.modbusTcpConfig?.ioGroups) {
      for (const group of device.modbusTcpConfig.ioGroups) {
        for (const point of group.ioPoints) {
          used.add(point.iecLocation)
        }
      }
    }
  }

  if (vendorIoMapping?.entries) {
    for (const entry of vendorIoMapping.entries) {
      if (entry.iecAddress) used.add(entry.iecAddress)
    }
  }

  return used
}

/**
 * Generates the next available IEC address for a given prefix,
 * skipping any addresses in the usedAddresses set.
 *
 * @param prefix - Address prefix (e.g., '%IX', '%QX', '%IW', '%QW')
 * @param isBit - Whether to use bit addressing (prefix + byte.bit format)
 * @param usedAddresses - Set of already-used addresses to skip
 * @param startFrom - Optional starting offset
 */
export function generateIecAddress(
  prefix: string,
  isBit: boolean,
  usedAddresses: Set<string>,
  startFrom?: number,
): string {
  let current = startFrom ?? 0

  while (true) {
    const addr = isBit ? `${prefix}${Math.floor(current / 8)}.${current % 8}` : `${prefix}${current}`
    if (!usedAddresses.has(addr)) return addr
    current++
  }
}
