/**
 * A library's own translation unit, generated from its archive and the archives it depends on, never from a project:
 * every chunk of the library, whatever a project reaches, so the same library gives the same C++, and so the same
 * compiled object, in every project. A build takes the library's code out of its generated files and compiles this
 * unit in its place.
 */
import type { ProvidedHeader } from '@root/middleware/shared/utils/hmi/widget-libraries'
import type { StlibArchive } from 'strucpp'

import { loadStrucpp } from './strucpp-runtime'

const LIBRARY_LINE = /^\/\/ Library: (.+)$/m

/** The library a STruC++ `lib_*.cpp` file holds, from its `// Library:` line; null for any other file. */
export function libraryOfFile(name: string, content: string): string | null {
  if (!/^lib_\w+\.cpp$/.test(name)) return null
  return LIBRARY_LINE.exec(content.slice(0, 512))?.[1] ?? null
}

/** A file and folder name for a library: its name with anything but letters, digits and `_` replaced. */
export const libraryFileName = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_')

export interface LibraryUnitOptions {
  /** Folder of library units in the build's request; each library gets its own subfolder. */
  dir: string
  /** C++ namespace the build's own code declares the libraries in; STruC++'s default when absent. */
  namespace?: string
  /** Headers the build provides to library code. */
  providedHeaders: readonly ProvidedHeader[]
}

export interface LibraryUnit {
  /** The library's name, as its manifest gives it. */
  name: string
  /** Request path of the unit's source. */
  source: string
  /** Request path of the header declaring the library and its dependencies. */
  header: string
  /** The source and the header by request path. */
  files: Record<string, string>
}

export type LibraryUnitResult = { ok: true; unit: LibraryUnit } | { ok: false; error: string }

const kept = new WeakMap<
  StlibArchive,
  Array<{ dependencies: readonly StlibArchive[]; key: string; result: LibraryUnitResult }>
>()

const optionsKey = (options: LibraryUnitOptions): string =>
  JSON.stringify([options.dir, options.namespace ?? null, options.providedHeaders])

const sameArchives = (a: readonly StlibArchive[], b: readonly StlibArchive[]): boolean =>
  a.length === b.length && a.every((archive, i) => archive === b[i])

/**
 * The unit of `archive`, whole; only declarations of `dependencies` are emitted. Each file is named after the library,
 * so no two libraries' files share a name in a request. Kept per archive, dependencies and options for the session.
 */
export function libraryUnit(
  archive: StlibArchive,
  dependencies: readonly StlibArchive[],
  options: LibraryUnitOptions,
): LibraryUnitResult {
  const key = optionsKey(options)
  const known = kept.get(archive) ?? []
  const hit = known.find((k) => k.key === key && sameArchives(k.dependencies, dependencies))
  if (hit) return hit.result
  const name = archive.manifest.name
  const file = libraryFileName(name)
  const compiled = loadStrucpp().compile('', {
    fileName: `${file}.st`,
    libraries: [...dependencies, archive],
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    headerFileName: `${file}.hpp`,
    separateLibraryFiles: true,
    providedHeaders: [...options.providedHeaders],
    wholeLibraries: [name],
  })
  const code = compiled.cppFiles.find((f) => libraryOfFile(f.name, f.content) === name)
  const folder = `${options.dir}/${file}`
  const result: LibraryUnitResult =
    compiled.errors.length > 0
      ? { ok: false, error: `${name}: ${compiled.errors.map((e) => e.message).join('; ')}` }
      : !code || !compiled.libraryHeader
        ? { ok: false, error: `${name}: the library has no code of its own` }
        : {
            ok: true,
            unit: {
              name,
              source: `${folder}/${file}.cpp`,
              header: `${folder}/${compiled.libraryHeader.name}`,
              files: {
                [`${folder}/${compiled.libraryHeader.name}`]: compiled.libraryHeader.content,
                [`${folder}/${file}.cpp`]: code.content,
              },
            },
          }
  kept.set(archive, [...known, { dependencies: [...dependencies], key, result }])
  return result
}

/** A library and its archive, by the name its manifest gives. */
export interface NamedArchive {
  name: string
  archive: StlibArchive
}

/** The archives `library` depends on, directly or through another, among `available`, each once, in `available` order. */
export function libraryDependencies<T extends NamedArchive>(library: T, available: readonly T[]): T[] {
  const byName = new Map(available.map((l) => [l.name, l]))
  const needed = new Set<string>()
  const visit = (archive: StlibArchive): void => {
    for (const dependency of archive.dependencies ?? []) {
      const found = byName.get(dependency.name)
      if (!found || found === library || needed.has(found.name)) continue
      needed.add(found.name)
      visit(found.archive)
    }
  }
  visit(library.archive)
  return available.filter((l) => needed.has(l.name))
}

/** Names of the libraries whose code `files` (STruC++ output by file name) hold. */
export function librariesInFiles(files: Readonly<Record<string, string>>): Set<string> {
  const found = new Set<string>()
  for (const [name, content] of Object.entries(files)) {
    const library = libraryOfFile(name, content)
    if (library !== null) found.add(library)
  }
  return found
}

/** `files` without the `lib_*.cpp` files of `libraries`. */
export function withoutLibraryFiles(
  files: Readonly<Record<string, string>>,
  libraries: ReadonlySet<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([name, content]) => {
      const library = libraryOfFile(name, content)
      return library === null || !libraries.has(library)
    }),
  )
}
