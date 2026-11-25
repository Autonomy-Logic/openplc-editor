/**
 * The libraries a project uses: the pre-installed (bundled) ones and the ones it lists. Every build, the PLC library
 * tree, completions and the HMI palette see these and no other installed library.
 */

/** Names of the libraries a project uses: the pre-installed ones, then those it lists, each once. */
export function projectLibraryNames(bundledNames: readonly string[], listedNames: readonly string[]): string[] {
  return [...new Set([...bundledNames, ...listedNames])]
}

/** The manifest name of a library archive, or null when it has none. */
function archiveName(archive: unknown): string | null {
  if (typeof archive !== 'object' || archive === null || !('manifest' in archive)) return null
  const { manifest } = archive
  return typeof manifest === 'object' && manifest !== null && 'name' in manifest && typeof manifest.name === 'string'
    ? manifest.name
    : null
}

/**
 * The archives among `archives` (installed libraries, verbatim) named in `libraryNames`, in that order; the first
 * archive of a name wins and a name with no archive is skipped.
 */
export function selectProjectLibraryArchives<T>(archives: readonly T[], libraryNames: readonly string[]): T[] {
  const byName = new Map<string, T>()
  for (const archive of archives) {
    const name = archiveName(archive)
    if (name !== null && !byName.has(name)) byName.set(name, archive)
  }
  return libraryNames.flatMap((name) => {
    const archive = byName.get(name)
    return archive === undefined ? [] : [archive]
  })
}
