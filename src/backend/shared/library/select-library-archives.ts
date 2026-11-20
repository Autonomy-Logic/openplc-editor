/**
 * Which installed library archives a build compiles against: the pre-installed (bundled) libraries, then the
 * user-installed ones the project lists, in its order. A project never uses another installed library. What a build
 * may use of them is decided per POU by STruC++ from what the build provides.
 */
import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import { readStlibArchive } from './stlib-archive-json'

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

/** Names of the libraries a project lists (`project.json` `libraries`), in its order. */
export function listedLibraryNames(refs: ReadonlyArray<{ name: string }> | undefined): string[] {
  return (refs ?? []).map((ref) => ref.name)
}

/** Library archives as received, with STruC++'s manifest defaults; one that is not an archive is logged and left out. */
export function buildLibraryArchives(values: readonly unknown[]): StlibArchiveDTO[] {
  return values.flatMap((value, index) => {
    const read = readStlibArchive(value)
    if (read.ok) return [read.archive]
    console.warn(`[library] archive ${index + 1} of ${values.length} is not loaded: ${read.reason}`)
    return []
  })
}

/** User-installed archives as received, named by their manifests (`buildLibraryArchives`). */
export function installedLibraryArchives(values: readonly unknown[]): Array<InstalledLibraryArchive<StlibArchiveDTO>> {
  return buildLibraryArchives(values).map((archive) => ({ name: archive.manifest.name, archive }))
}

/**
 * The archives of a build of a project listing `listedNames` (`selectBuildLibraryArchives`). `loadInstalled` gives
 * the user-installed archives verbatim and is called only when a listed name is not pre-installed.
 */
export async function loadBuildLibraryArchives(
  preinstalled: readonly StlibArchiveDTO[],
  loadInstalled: () => Promise<readonly unknown[]>,
  listedNames: readonly string[],
): Promise<{ archives: StlibArchiveDTO[]; missing: string[] }> {
  const preinstalledNames = new Set(preinstalled.map((archive) => archive.manifest.name))
  const installed = listedNames.some((name) => !preinstalledNames.has(name))
    ? installedLibraryArchives(await loadInstalled())
    : []
  return selectBuildLibraryArchives(preinstalled, installed, listedNames)
}
