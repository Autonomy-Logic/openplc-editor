/**
 * Version pinning for VPP boards.
 *
 * A project records which vendor package its board was authored against. When
 * the installed package differs from that pin (a newer version, a republish
 * with different bytes, or another package providing the board) the caller
 * re-pins to the installed package without a warning. The only case reported
 * is a pinned package that is not installed at all, because its driver cannot
 * be packaged.
 */

import type { VppPackagePin } from '../../types/PLC/devices/configuration'

export type { VppPackagePin }

/** What the editor has installed right now for the board's package. */
export interface InstalledVppIdentity {
  packageId: string
  version: string
  contentHash: string
}

export type VppPinDrift =
  | { kind: 'none' }
  /** No pin recorded: an older project, or a board just selected. */
  | { kind: 'unpinned' }
  | { kind: 'package-missing'; message: string }
  /** The installed package differs from the pin; the caller re-pins to it. */
  | { kind: 'moved' }

/** Compare what the project was authored against with what is installed. */
export function resolveVppPinDrift(
  pin: VppPackagePin | undefined,
  installed: InstalledVppIdentity | null,
): VppPinDrift {
  if (!pin) return { kind: 'unpinned' }

  if (!installed) {
    return {
      kind: 'package-missing',
      message:
        `This program was written against ${pin.packageId} ${pin.version}, which is not installed. ` +
        'Install that package before building, or the driver it ships will not be packaged.',
    }
  }

  if (
    installed.packageId === pin.packageId &&
    installed.version === pin.version &&
    installed.contentHash === pin.contentHash
  ) {
    return { kind: 'none' }
  }

  return { kind: 'moved' }
}

/** The one-line warning, or null when there is nothing to say. */
export function describeVppPinDrift(
  pin: VppPackagePin | undefined,
  installed: InstalledVppIdentity | null,
): string | null {
  const drift = resolveVppPinDrift(pin, installed)
  return 'message' in drift ? drift.message : null
}
