/**
 * IEC 61131-3 address utilities for global address allocation.
 *
 * Manages IEC address allocation across IO sources that share the runtime's
 * image table: remote devices (Modbus TCP IO groups) and VPP vendor module
 * IO mappings. These live on Runtime v4 targets and must not collide.
 *
 * Local pin mapping is deliberately NOT included here — pin mapping is an
 * Arduino-target-only concern and its addresses don't reach the same image
 * table that runtime plugins / remote devices write to, so sharing the
 * namespace with them would produce false conflicts when the user switches
 * targets.
 *
 * Pure frontend utility — no backend or platform dependencies.
 */

import type { VendorIoMapping } from '../../middleware/shared/ports/types'

/**
 * Collects all used IEC addresses from sources that share the Runtime v4
 * image table: remote devices and vendor module IO mappings.
 */
export function collectUsedIecAddresses(
  remoteDevices: Array<{ modbusTcpConfig?: { ioGroups?: Array<{ ioPoints: Array<{ iecLocation: string }> }> } }>,
  vendorIoMapping?: VendorIoMapping,
): Set<string> {
  const used = new Set<string>()

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
