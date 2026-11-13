import type { VppPackagePin } from '../../types/PLC/devices/configuration'

export type { VppPackagePin }

/**
 * The warning for a board whose pinned vendor package is not installed, or null.
 * A different installed package is not reported: the board screen re-pins to it.
 */
export function describeMissingVppPackage(
  pin: VppPackagePin | undefined,
  installed: VppPackagePin | null,
): string | null {
  if (!pin || installed) return null
  return (
    `This program was written against ${pin.packageId} ${pin.version}, which is not installed. ` +
    'Install that package before building, or the driver it ships will not be packaged.'
  )
}
