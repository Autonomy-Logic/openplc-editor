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

export type { ImportResult, InstalledPackage, PackageManifest, PackageRegistry }
