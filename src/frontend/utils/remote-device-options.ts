/**
 * Utility functions for building remote device and vendor module IO point options.
 * Used in location dropdowns for variable tables.
 *
 * Dropdown asymmetry — by design:
 *   - Pin-mapping options (see `location-dropdown-options.ts`) list
 *     **every pin**, aliased or not.  Pin addresses on Arduino-style
 *     targets are stable (pin 13 = `%QX0.3` on Arduino Uno, always),
 *     so addressing by raw IEC location stays meaningful even without
 *     a user-supplied alias.
 *   - VPP module + remote-device options (this file) list **only
 *     aliased entries**.  Their IEC addresses are allocator-assigned
 *     and can shift when the user changes slot layout, adds modules,
 *     etc.  Variables that bind to an alias survive those shifts
 *     (the sync engine refreshes their `location` via the registry);
 *     variables that bound to a raw address would silently break.
 *     Requiring an alias makes the rebind-on-shift contract explicit.
 *
 * Dedupe contract: each address can appear at most once across all
 * options this file produces.  The address pool enforces one-claim-
 * per-address at registry-build time, so authoring through the live
 * UI never produces duplicates.  Legacy projects authored before the
 * write-time `validateAliasEdit` check existed may have drifted into
 * a state where two entries claim the same `iecAddress` — for those,
 * we skip later occurrences (first-iterated wins, matching the
 * pool's first-wins reservation order) so the picker can never offer
 * an ambiguous pick.
 */

import type { IoMappingEntry } from '../../middleware/shared/ports/types'

export type RemoteDeviceIOPoint = {
  deviceName: string
  ioGroupName: string
  ioPointId: string
  ioPointName: string
  ioPointType: string
  iecLocation: string
  alias: string | undefined
}

type DropdownOption = {
  id: string
  value: string
  label: string
}

type DropdownGroup = {
  label: string
  options: DropdownOption[]
}

/**
 * Builds dropdown option groups from remote device IO points.
 * Groups IO points by device name and only includes points with aliases.
 *
 * @param cellId - Unique identifier for the cell (used to generate unique option IDs)
 * @param remoteIOPoints - Array of remote device IO points from the store
 * @returns Array of dropdown groups, one per remote device with aliased IO points
 */
export function buildRemoteDeviceOptionGroups(cellId: string, remoteIOPoints: RemoteDeviceIOPoint[]): DropdownGroup[] {
  const groupsByDevice = new Map<string, DropdownOption[]>()
  const seenAddresses = new Set<string>() // see file-level "Dedupe contract"

  for (const ioPoint of remoteIOPoints) {
    if (!ioPoint.alias) continue // Only show points with aliases
    if (seenAddresses.has(ioPoint.iecLocation)) continue
    seenAddresses.add(ioPoint.iecLocation)

    let deviceGroup = groupsByDevice.get(ioPoint.deviceName)
    if (!deviceGroup) {
      deviceGroup = []
      groupsByDevice.set(ioPoint.deviceName, deviceGroup)
    }

    deviceGroup.push({
      // Single-field model: binding a variable to this channel stores the
      // ALIAS NAME in `location` (resolved to the address at compile). The
      // label shows the address for context.
      id: `${cellId}-remote-${ioPoint.ioPointId}`,
      value: ioPoint.alias,
      label: `${ioPoint.alias} (${ioPoint.iecLocation})`,
    })
  }

  return Array.from(groupsByDevice.entries()).map(([deviceName, options]) => ({
    label: `Remote: ${deviceName}`,
    options,
  }))
}

/**
 * Builds dropdown option groups from vendor module IO mapping entries.
 * Groups entries by slot/module and only includes entries with aliases.
 *
 * @param cellId - Unique identifier for the cell (used to generate unique option IDs)
 * @param entries - Array of vendor IO mapping entries from vendorScreenData
 * @returns Array of dropdown groups, one per slot with aliased IO entries
 */
export function buildVendorIoOptionGroups(cellId: string, entries: IoMappingEntry[]): DropdownGroup[] {
  const groupsBySlot = new Map<string, DropdownOption[]>()
  const seenAddresses = new Set<string>() // see file-level "Dedupe contract"

  for (const entry of entries) {
    if (!entry.alias) continue
    if (seenAddresses.has(entry.iecAddress)) continue
    seenAddresses.add(entry.iecAddress)

    const groupKey = `Slot ${entry.slot}: ${entry.moduleName}`
    let group = groupsBySlot.get(groupKey)
    if (!group) {
      group = []
      groupsBySlot.set(groupKey, group)
    }

    group.push({
      // Single-field model: bind by ALIAS NAME (resolved at compile); the
      // label shows the address for context.
      id: `${cellId}-vendor-${entry.slot}-${entry.channelName}`,
      value: entry.alias,
      label: `${entry.alias} (${entry.iecAddress})`,
    })
  }

  return Array.from(groupsBySlot.entries()).map(([slotLabel, options]) => ({
    label: slotLabel,
    options,
  }))
}
