/**
 * The one way to answer "which installed VPP provides this board?".
 *
 * `boardTarget` travels through the compile pipeline as a plain device
 * *name* — the string the user picked in the board dropdown. Four call
 * sites needed to turn it back into the package and manifest entry it
 * came from (board build info, VPP plugin packaging, module config
 * screens, the runtime-version floor), and each had grown its own copy
 * of the same loop.
 *
 * They agreed, which is the only reason this was a latent bug and not
 * an open one: four copies of "first package whose `devices` contains a
 * matching name wins" that nothing forced to stay in agreement. Change
 * the tie-break, add a namespacing rule, start matching on `id` as well
 * as `name` — and three of the four would keep the old behaviour, in a
 * codebase where the symptom is a board that compiles against the wrong
 * package's HAL.
 *
 * Lives in `backend/shared` because `board-info-resolver` (also shared)
 * is one of the callers and cannot reach into `backend/editor`. It takes
 * the same narrow `PackageManagerPort` the resolver already injects, so
 * editor and web both satisfy it without new plumbing.
 */

import type { InstalledPackage, PackageManifest } from '../../../middleware/shared/ports/types'
import type { PackageManagerPort } from './board-info-resolver'

/** An installed VPP device, with the package and manifest it came from. */
export interface VppDeviceMatch {
  /** Registry entry — carries `packageId` and the on-disk `path`. */
  pkg: InstalledPackage
  /** The full manifest, for package-level fields (`minRuntimeVersion`, …). */
  manifest: PackageManifest
  /** The matched `devices[]` entry. */
  device: PackageManifest['devices'][number]
}

/**
 * Find the installed VPP device whose name is `boardName`, or null when
 * no installed package provides it (the ordinary case for a built-in
 * hals.json board).
 *
 * **First match wins**, in `listInstalled()` order. Two packages
 * shipping a device of the same name is an authoring collision, not a
 * situation with a right answer; resolving it consistently everywhere
 * matters more than which one is picked. Packages whose manifest cannot
 * be read are skipped rather than treated as empty, so a single corrupt
 * install cannot hide a board another package provides.
 */
export function findVppDeviceByBoardName(packageManager: PackageManagerPort, boardName: string): VppDeviceMatch | null {
  for (const pkg of packageManager.listInstalled()) {
    const manifest = packageManager.getInstalledPackageManifest(pkg.packageId)
    if (!manifest) continue
    const device = manifest.devices.find((d) => d.name === boardName)
    if (device) return { pkg, manifest, device }
  }
  return null
}
