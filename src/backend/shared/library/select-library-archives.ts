/**
 * Which installed library archives a build compiles against: the pre-installed (bundled) libraries, then the
 * user-installed ones the project lists, in its order. A project never uses another installed library. What a build
 * may use of them is decided per POU by STruC++ from what the build provides.
 */

/** A user-installed library: its name, and its archive or null when the archive could not be read. */
export interface InstalledLibraryArchive<T> {
  name: string
  archive: T | null
}

/**
 * The archives of a build: the pre-installed ones, then the user-installed ones the project lists, in `listedNames`
 * order. `missing` lists listed names with no readable archive.
 */
export function selectBuildLibraryArchives<T>(
  preinstalled: readonly T[],
  installed: ReadonlyArray<InstalledLibraryArchive<T>>,
  listedNames: readonly string[],
): { archives: T[]; missing: string[] } {
  const archives: T[] = [...preinstalled]
  const missing: string[] = []
  const byName = new Map(installed.map((entry) => [entry.name, entry]))
  const taken = new Set<string>()
  for (const name of listedNames) {
    const archive = byName.get(name)?.archive
    if (archive === undefined || archive === null) {
      missing.push(name)
      continue
    }
    if (taken.has(name)) continue
    taken.add(name)
    archives.push(archive)
  }
  return { archives, missing }
}
