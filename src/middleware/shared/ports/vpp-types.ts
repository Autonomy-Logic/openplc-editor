/**
 * Wire types for the host VPP store (`/api/vpps` on autonomy-node, `/vpps` on
 * autonomy-edge).
 *
 * Shape-identical to the hosts' own DTOs — autonomy-node
 * `domain/value-objects/vpp-types.ts` and autonomy-edge
 * `domain/types/vpp/vpp-types.ts` — so one adapter reads both.
 * Contract: VPP_CONTRACTS.md C4 §6.2.
 */

export type VppSource = 'user' | 'system'

/**
 * The vendor package a vPLC was created with, as the host reports it.
 *
 * The binding lives on the vPLC, not in a per-user store: the host decided
 * which bytes that vPLC runs, so this is what the IDE loads, gates on and
 * compares a project's pin against.
 */
export interface DeviceVpp {
  packageId: string
  version: string
  contentHash: string
}

export interface InstalledVpp {
  packageId: string
  name: string
  version: string
  /** `"sha256:…"` of the canonical signature payload — the package identity. */
  contentHash: string
  vendorName: string
  devices: string[]
  installedAt: string
  /** `'system'` is a package the device shipped with; it cannot be removed. */
  source: VppSource
  minEditorVersion?: string
  minRuntimeVersion?: string
}

export type VppInstallErrorCode =
  | 'not_a_vpp'
  | 'manifest_invalid'
  | 'signature_invalid'
  | 'untrusted_key'
  | 'quota_reached'
  | 'too_large'

export type VppInstallResult =
  | { success: true; packageId: string; version: string; contentHash: string; replaced: boolean }
  | { success: false; error: string; code: VppInstallErrorCode }

/**
 * What a project records about the package its board came from, so authoring
 * and deploy can warn when the installed package has drifted from the one the
 * program was written against.
 */
export interface VppPackagePin {
  packageId: string
  version: string
  contentHash: string
}
