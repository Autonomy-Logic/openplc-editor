/**
 * Backend-internal package-manager types.
 *
 * The cross-process wire types (`PackageManifest`, `InstalledPackage`,
 * `ImportResult`) live in src/middleware/shared/ports/types.ts so the
 * IPC adapter and the renderer share a single contract. We re-export
 * them here so backend modules can keep their imports local; the
 * `PackageRegistry` shape is purely on-disk and stays backend-only.
 */

import type { ImportResult, InstalledPackage, PackageManifest } from '../../../middleware/shared/ports/types'

type PackageRegistry = {
  formatVersion: string
  packages: Record<string, Omit<InstalledPackage, 'packageId'>>
}

/**
 * Outcome of the build-time integrity gate
 * (`PackageManagerModule.verifyBoardPackageIntegrity`).
 *
 * `ok: true` covers three genuinely different situations that all mean
 * "nothing stands in the way of this build": the board is a built-in
 * hals.json entry with no package behind it, the package still matches its
 * signature, or enforcement is switched off for local development. The
 * caller does not need to tell them apart — it either builds or it does not.
 *
 * The failure arm carries the `packageId` because the message a user can act
 * on has to name the package they must reinstall, and `reason` because
 * "files are missing" and "tampered file detected: hal/pi.cpp" send them to
 * very different places.
 */
type PackageIntegrityResult = { ok: true } | { ok: false; packageId: string; reason: string }

export type { ImportResult, InstalledPackage, PackageIntegrityResult, PackageManifest, PackageRegistry }
