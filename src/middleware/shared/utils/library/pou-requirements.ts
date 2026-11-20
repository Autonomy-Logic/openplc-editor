/**
 * Which library POUs a build can use, from the requirements STruC++ records on each chunk (headers its code needs and
 * libraries it reaches) and what the build provides. Nothing here compiles.
 */
import { findUnmetRequirements, formatUnmetRequirement, resolvePouRequirements, type StlibArchive } from 'strucpp'

import type { ProvidedHeader } from '../hmi/widget-libraries'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a library archive carries what requirement resolution reads: a named manifest, chunks and dependencies. */
export function isRequirementArchive(value: unknown): value is StlibArchive {
  if (!isRecord(value) || !isRecord(value.manifest)) return false
  const { name, headers, functionBlocks, functions, types } = value.manifest
  return (
    typeof name === 'string' &&
    Array.isArray(headers) &&
    Array.isArray(functionBlocks) &&
    Array.isArray(functions) &&
    Array.isArray(types) &&
    Array.isArray(value.chunks) &&
    Array.isArray(value.dependencies)
  )
}

/** Library POUs a build cannot use, by library name, then by upper-case POU name, with STruC++'s reasons. */
export type UnusablePous = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>

/**
 * The POUs of `archives` a build providing `providedHeaders` and supplying `archives` cannot use, each with the
 * reasons STruC++ gives. Archives that do not carry chunks are left out (nothing to check).
 */
export function unusablePous(archives: readonly unknown[], providedHeaders: readonly ProvidedHeader[]): UnusablePous {
  const usable = archives.filter(isRequirementArchive)
  const environment = { libraries: usable, providedHeaders: [...providedHeaders] }
  const result = new Map<string, Map<string, string[]>>()
  for (const archive of usable) {
    const library = archive.manifest.name
    if (result.has(library)) continue
    const pous = new Map<string, string[]>()
    for (const pou of resolvePouRequirements(archive, usable)) {
      const unmet = findUnmetRequirements(pou.requirements, environment)
      if (unmet.length === 0) continue
      const name = pou.name.startsWith('Program_') ? pou.name.slice('Program_'.length) : pou.name
      pous.set(
        name.toUpperCase(),
        unmet.map((u) => formatUnmetRequirement(pou, u)),
      )
    }
    result.set(library, pous)
  }
  return result
}

/** Whether `name` of `library` is among the POUs a build cannot use. */
export function isUnusablePou(unusable: UnusablePous, library: string, name: string): boolean {
  return unusable.get(library)?.has(name.toUpperCase()) ?? false
}
