/**
 * "A newer version of this board's package exists" — answered from memory.
 *
 * The notice has to appear on EVERY build, and the network must never be on a
 * build's critical path: a user with no connection, a captive portal or a slow
 * proxy compiles exactly as fast as one with fibre. Those two only fit together
 * if asking and answering are separated — so the catalogue is fetched once when
 * the editor starts, and a build reads whatever that fetch left behind.
 *
 * A session that never reached the CDN therefore says nothing at all, which is
 * the intended outcome: the notice is advisory (try a newer package if the board
 * misbehaves), never a gate on building.
 *
 * One fetch covers the whole feature because `catalog.json` is the entire
 * catalogue, not a per-package answer — switching boards mid-session is a lookup
 * in `entries`, not another request. The INSTALLED version is read per build
 * instead, so installing or updating a package is reflected immediately.
 */

import { compareSemver, isCompatibleEditorVersion } from '../../../frontend/utils/semver'
import type { PackagePort } from '../../shared/ports/package-port'
import type { RemoteCatalog } from '../../shared/ports/types'

export interface PackageUpdate {
  packageName: string
  installedVersion: string
  availableVersion: string
}

export interface PackageUpdateNotifier {
  /** Fetch the catalogue once for the session. Never rejects — offline is silence. */
  prime(): Promise<void>
  /** A one-line notice for `packageId`, or `null`. Never rejects. */
  notice(packageId: string): Promise<string | null>
}

/**
 * The newest version of `packageId` this editor can load, when it is newer than
 * what is installed.
 *
 * Compatibility is checked BEFORE recency on purpose: telling a user about a
 * release their editor refuses to install sends them to a dead end, since the
 * same `minEditorVersion` floor blocks the install itself.
 */
export function findPackageUpdate(
  catalog: RemoteCatalog | null,
  packageId: string,
  installedVersion: string,
  editorVersion: string,
): PackageUpdate | null {
  const entry = catalog?.entries.find((candidate) => candidate.packageId === packageId)
  if (!entry) return null

  // `versions` is newest-first by the catalogue's contract, so the first
  // compatible entry is the newest one this editor can load.
  const available = entry.versions.find((version) => isCompatibleEditorVersion(version.minEditorVersion, editorVersion))
  if (!available) return null
  if (compareSemver(available.version, installedVersion) <= 0) return null

  return { packageName: entry.name, installedVersion, availableVersion: available.version }
}

export function formatPackageUpdateNotice(update: PackageUpdate): string {
  return (
    `A newer ${update.packageName} package is available: ${update.installedVersion} -> ${update.availableVersion}. ` +
    'Install it from the Package Manager if this board behaves unexpectedly.'
  )
}

/**
 * `editorVersion` is passed in rather than read from `APP_VERSION` here: an
 * adapter may not import from `frontend/data`, and the platform wiring is where
 * the two already meet.
 */
export function createPackageUpdateNotifier(
  packages: Pick<PackagePort, 'listRemoteCatalog' | 'listInstalled'>,
  editorVersion: string,
): PackageUpdateNotifier {
  let catalog: RemoteCatalog | null = null

  return {
    async prime(): Promise<void> {
      try {
        catalog = await packages.listRemoteCatalog()
      } catch {
        // No network, a proxy in the way, or the CDN down. All three mean the
        // same thing here: no notice this session, and nothing on screen about
        // it — the user did not ask for a catalogue, they asked for a build.
      }
    },

    async notice(packageId: string): Promise<string | null> {
      // Nothing was ever fetched: skip the local read too, so a build on a
      // machine that has never had network does no extra work at all.
      if (!catalog) return null
      try {
        const installed = (await packages.listInstalled()).find((entry) => entry.packageId === packageId)
        if (!installed) return null
        const update = findPackageUpdate(catalog, packageId, installed.version, editorVersion)
        return update ? formatPackageUpdateNotice(update) : null
      } catch {
        return null
      }
    },
  }
}
