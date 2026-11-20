/** Completion items of PLC documents: library POUs a PLC build cannot use are not offered. */
import {
  type LibraryPouRequirements,
  plcUnusablePous,
  unusablePouNames,
  type UnusablePous,
} from '../../../middleware/shared/utils/library/pou-requirements'
import { projectLibraryNames } from '../../../middleware/shared/utils/library/project-libraries'
import { parseHmiFileUri } from '../hmi-code/uris'
import { HMI_GLUE_URI } from './hmi-sync'

/** What the open project's library selection is read from. */
export interface ProjectLibraryState {
  pouRequirements: readonly LibraryPouRequirements[]
  bundledLibraryNames: readonly string[]
  enabledLibraries: readonly string[]
}

/** Names `projectPlcUnusablePous` returned, by the map they came from. */
const namesCache = new WeakMap<UnusablePous, string[]>()

/**
 * Upper-case names of the library POUs a PLC build of the open project cannot use, over the libraries it uses (the
 * bundled ones and those it lists).
 */
export function projectPlcUnusablePous(state: ProjectLibraryState): string[] {
  const unusable = plcUnusablePous(
    state.pouRequirements,
    projectLibraryNames(state.bundledLibraryNames, state.enabledLibraries),
  )
  const cached = namesCache.get(unusable)
  if (cached) return cached
  const names = unusablePouNames(unusable)
  namesCache.set(unusable, names)
  return names
}

/** A completion item's label, plain or with details. */
type CompletionLabel = string | { label: string }

/**
 * `items` without the library POUs `unusable` names (upper case), for any document but an HMI screen, widget block or
 * the HMI glue, which HMI builds compile and which may use them.
 */
export function plcCompletionItems<T extends { label: CompletionLabel }>(
  uri: string,
  items: T[],
  unusable: readonly string[],
): T[] {
  if (unusable.length === 0 || uri === HMI_GLUE_URI || parseHmiFileUri(uri) !== null) return items
  const hidden = new Set(unusable)
  return items.filter((item) => {
    const label = typeof item.label === 'string' ? item.label : item.label.label
    return !hidden.has(label.toUpperCase())
  })
}
