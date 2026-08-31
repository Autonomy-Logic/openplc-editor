/**
 * Compare the libraries a retrieved project carries against this machine's pool.
 *
 * Three outcomes, and the middle one is why this exists:
 *
 *   - `installed` -- same name, same bytes. Nothing to do.
 *   - `differs`   -- same name, DIFFERENT bytes. The project was built against
 *     something this machine does not have. Building it here would silently
 *     produce a different program, so this cannot be reported as "already
 *     installed" -- that phrasing would actively mislead.
 *   - `missing`   -- not here at all.
 *
 * Compared by content hash rather than by version: a version is a label someone
 * types, and two different builds can carry the same one.
 *
 * Takes a reader callback rather than the library manager itself, which is
 * Electron-bound; this keeps the rule testable without standing up an app.
 */

import { hashLibraryArchive, type SnapshotLibrary } from '../../shared/project/project-snapshot-archive'

export type RetrievedLibraryStatus = 'installed' | 'differs' | 'missing'

export interface DescribedLibrary {
  name: string
  version: string
  status: RetrievedLibraryStatus
}

/** Returns the local `.stlib` text for a library, or null when absent. */
export type ReadLocalArchive = (name: string) => Promise<string | null> | (string | null)

export async function describeRetrievedLibraries(
  libraries: SnapshotLibrary[],
  readLocalArchive: ReadLocalArchive,
): Promise<DescribedLibrary[]> {
  const described: DescribedLibrary[] = []

  for (const library of libraries) {
    const local = await readLocalArchive(library.name)
    if (local === null) {
      described.push({ name: library.name, version: library.version, status: 'missing' })
      continue
    }
    const localHash = await hashLibraryArchive(local)
    described.push({
      name: library.name,
      version: library.version,
      status: localHash === library.hash ? 'installed' : 'differs',
    })
  }

  return described
}
