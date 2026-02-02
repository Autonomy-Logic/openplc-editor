/**
 * Utility functions for building remote device IO point options
 * Used in location dropdowns for variable tables
 */

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

  for (const ioPoint of remoteIOPoints) {
    if (!ioPoint.alias) continue // Only show points with aliases

    let deviceGroup = groupsByDevice.get(ioPoint.deviceName)
    if (!deviceGroup) {
      deviceGroup = []
      groupsByDevice.set(ioPoint.deviceName, deviceGroup)
    }

    deviceGroup.push({
      id: `${cellId}-remote-${ioPoint.ioPointId}`,
      value: ioPoint.iecLocation,
      label: `${ioPoint.iecLocation} (${ioPoint.alias})`,
    })
  }

  return Array.from(groupsByDevice.entries()).map(([deviceName, options]) => ({
    label: `Remote: ${deviceName}`,
    options,
  }))
}
