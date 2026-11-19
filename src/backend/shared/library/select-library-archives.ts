/**
 * Which installed library archives a build compiles against. Pre-installed libraries are always on; a user-installed
 * PLC library is on when the project enables it; an installed widget library (kind `hmi`) is on for every project,
 * since the HMI designer offers every installed widget library.
 */
import { libraryKind } from '@root/middleware/shared/utils/hmi/widget-libraries'

import type { InstalledLibrary } from '../../../middleware/shared/ports/library-types'

/** A user-installed library: its name, and its archive or null when the archive could not be read. */
export interface InstalledLibraryArchive<T> {
  name: string
  archive: T | null
}

/**
 * The archives of a build: the pre-installed ones, the enabled user-installed ones in `enabledNames` order, then the
 * other installed widget libraries. `missing` lists enabled names with no readable archive.
 */
export function selectBuildLibraryArchives<T>(
  preinstalled: readonly T[],
  installed: ReadonlyArray<InstalledLibraryArchive<T>>,
  enabledNames: readonly string[],
): { archives: T[]; missing: string[] } {
  const archives: T[] = [...preinstalled]
  const missing: string[] = []
  const byName = new Map(installed.map((entry) => [entry.name, entry]))
  const taken = new Set<string>()
  for (const name of enabledNames) {
    const archive = byName.get(name)?.archive
    if (archive === undefined || archive === null) {
      missing.push(name)
      continue
    }
    if (taken.has(name)) continue
    taken.add(name)
    archives.push(archive)
  }
  for (const { name, archive } of installed) {
    if (archive === null || taken.has(name) || libraryKind(archive) !== 'hmi') continue
    taken.add(name)
    archives.push(archive)
  }
  return { archives, missing }
}

/** Library manager rows with the kind of each library, read from its archive (`plc` when it has none). */
export function withLibraryKinds(rows: readonly InstalledLibrary[], archives: readonly unknown[]): InstalledLibrary[] {
  const kinds = new Map<string, InstalledLibrary['kind']>()
  for (const archive of archives) {
    const manifest = typeof archive === 'object' && archive !== null && 'manifest' in archive ? archive.manifest : null
    if (typeof manifest === 'object' && manifest !== null && 'name' in manifest && typeof manifest.name === 'string')
      kinds.set(manifest.name, libraryKind(archive))
  }
  return rows.map((row) => ({ ...row, kind: kinds.get(row.name) ?? row.kind ?? 'plc' }))
}
