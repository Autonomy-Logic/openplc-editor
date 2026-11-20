/**
 * Which installed library archives a build compiles against: every one. Pre-installed libraries come first, then the
 * user-installed ones the project enables, in its order, then every other installed library. What a build may use
 * of them is decided per POU by STruC++ from what the build provides.
 */

/** A user-installed library: its name, and its archive or null when the archive could not be read. */
export interface InstalledLibraryArchive<T> {
  name: string
  archive: T | null
}

/**
 * The archives of a build: the pre-installed ones, the enabled user-installed ones in `enabledNames` order, then the
 * other installed libraries. `missing` lists enabled names with no readable archive.
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
    if (archive === null || taken.has(name)) continue
    taken.add(name)
    archives.push(archive)
  }
  return { archives, missing }
}
