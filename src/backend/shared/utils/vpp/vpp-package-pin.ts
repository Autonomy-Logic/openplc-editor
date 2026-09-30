/**
 * Version pinning for VPP boards, and the drift it exists to catch.
 *
 * A project records which vendor package its board was authored against. The
 * installed package can then move underneath it — a newer version, or the same
 * version republished with different bytes — and the program would be built
 * against something other than what the slots, channels and addresses were
 * laid out for. The pin is what lets the editor say so, at authoring and again
 * before the upload.
 *
 * `contentHash` is the identity that matters: a republished package keeps its
 * version string, so a version-only comparison would miss exactly the case
 * that is hardest to diagnose on the device.
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
  /** No pin recorded — an older project, or a board just selected. */
  | { kind: 'unpinned' }
  | { kind: 'package-missing'; message: string }
  | { kind: 'version-changed'; message: string }
  | { kind: 'content-changed'; message: string }
  | { kind: 'package-replaced'; message: string }

/**
 * Compare what the project was authored against with what is installed.
 *
 * Deliberately returns a discriminated result rather than a boolean: the four
 * ways a package can drift need four different sentences, and a caller that
 * only wants "is something wrong" can check `kind !== 'none'`.
 */
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

  if (installed.packageId !== pin.packageId) {
    return {
      kind: 'package-replaced',
      message:
        `This program was written against ${pin.packageId} ${pin.version}, but the board now comes from ` +
        `${installed.packageId} ${installed.version}. Check the slot and channel configuration before building.`,
    }
  }

  if (installed.contentHash === pin.contentHash) return { kind: 'none' }

  if (installed.version !== pin.version) {
    return {
      kind: 'version-changed',
      message:
        `This program was written against ${pin.packageId} ${pin.version}; ${installed.version} is installed. ` +
        'Check the slot and channel configuration before building.',
    }
  }

  return {
    kind: 'content-changed',
    message:
      `${pin.packageId} ${pin.version} has been republished since this program was written against it. ` +
      'Check the slot and channel configuration before building.',
  }
}

/** The one-line warning, or null when there is nothing to say. */
export function describeVppPinDrift(
  pin: VppPackagePin | undefined,
  installed: InstalledVppIdentity | null,
): string | null {
  const drift = resolveVppPinDrift(pin, installed)
  return 'message' in drift ? drift.message : null
}
