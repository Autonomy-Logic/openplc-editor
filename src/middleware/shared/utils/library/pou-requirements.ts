/**
 * Which library POUs a build can use, from the requirements STruC++ records on each chunk (headers its code needs and
 * libraries it reaches), the libraries the project uses and what the build provides. Nothing here compiles.
 */
import {
  findUnmetRequirements,
  formatUnmetRequirement,
  type PouRequirements,
  resolvePouRequirements,
  type StlibArchive,
} from 'strucpp'

import { PLC_PROVIDED_HEADERS, type ProvidedHeader } from '../hmi/widget-libraries'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a library archive carries what requirement resolution reads: a named manifest, chunks and dependencies. */
export function isRequirementArchive(value: unknown): value is StlibArchive {
  if (!isRecord(value) || !isRecord(value.manifest)) return false
  const { name, version, headers, functionBlocks, functions, types } = value.manifest
  return (
    typeof name === 'string' &&
    typeof version === 'string' &&
    Array.isArray(headers) &&
    Array.isArray(functionBlocks) &&
    Array.isArray(functions) &&
    Array.isArray(types) &&
    Array.isArray(value.chunks) &&
    Array.isArray(value.dependencies)
  )
}

/** One library's POUs, each with every requirement it has, transitively. */
export interface LibraryPouRequirements {
  name: string
  version: string
  pous: PouRequirements[]
}

/**
 * The POU requirements of every library among `archives` (the installed ones, verbatim), walked across all of them;
 * the first archive of a name wins. Archives that do not carry chunks are left out (nothing to check).
 */
export function libraryPouRequirements(archives: readonly unknown[]): LibraryPouRequirements[] {
  const usable = archives.filter(isRequirementArchive)
  const result: LibraryPouRequirements[] = []
  for (const archive of usable) {
    const { name, version } = archive.manifest
    if (result.some((library) => library.name === name)) continue
    result.push({ name, version, pous: resolvePouRequirements(archive, usable) })
  }
  return result
}

/** Library POUs a build cannot use, by library name, then by upper-case POU name, with STruC++'s reasons. */
export type UnusablePous = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>

/**
 * The POUs of the libraries named in `libraryNames` that a build supplying exactly those libraries and providing
 * `providedHeaders` cannot use, each with the reasons STruC++ gives.
 */
export function unusablePous(
  requirements: readonly LibraryPouRequirements[],
  libraryNames: readonly string[],
  providedHeaders: readonly ProvidedHeader[],
): UnusablePous {
  const names = new Set(libraryNames)
  const supplied = requirements.filter((library) => names.has(library.name))
  const environment = {
    libraries: supplied.map(({ name, version }) => ({ name, version })),
    providedHeaders: [...providedHeaders],
  }
  const result = new Map<string, Map<string, string[]>>()
  for (const library of supplied) {
    const pous = new Map<string, string[]>()
    for (const pou of library.pous) {
      const unmet = findUnmetRequirements(pou.requirements, environment)
      if (unmet.length === 0) continue
      const name = pou.name.startsWith('Program_') ? pou.name.slice('Program_'.length) : pou.name
      pous.set(
        name.toUpperCase(),
        unmet.map((u) => formatUnmetRequirement(pou, u)),
      )
    }
    result.set(library.name, pous)
  }
  return result
}

/** Whether `name` of `library` is among the POUs a build cannot use. */
export function isUnusablePou(unusable: UnusablePous, library: string, name: string): boolean {
  return unusable.get(library)?.has(name.toUpperCase()) ?? false
}

/** Upper-case names of every POU `unusable` lists, sorted. */
export function unusablePouNames(unusable: UnusablePous): string[] {
  const names = new Set<string>()
  for (const pous of unusable.values()) for (const name of pous.keys()) names.add(name)
  return [...names].sort()
}

/** The PLC-unusable POUs `plcUnusablePous` computed, by requirement list, for the last library names asked. */
const plcUnusableCache = new WeakMap<readonly LibraryPouRequirements[], { key: string; unusable: UnusablePous }>()

/** The POUs of the libraries named in `libraryNames` that a PLC build of a project using exactly them cannot use. */
export function plcUnusablePous(
  requirements: readonly LibraryPouRequirements[],
  libraryNames: readonly string[],
): UnusablePous {
  const key = libraryNames.join('\u0000')
  const cached = plcUnusableCache.get(requirements)
  if (cached?.key === key) return cached.unusable
  const unusable = unusablePous(requirements, libraryNames, PLC_PROVIDED_HEADERS)
  plcUnusableCache.set(requirements, { key, unusable })
  return unusable
}
