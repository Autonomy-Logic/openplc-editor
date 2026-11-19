/**
 * What a running preview module holds of the shown screen, kept beside it: each element's id, whether the module made
 * it or the build compiled it, and whether it is laid out. The designer's preview and the preview test keep it the same
 * way, with these functions.
 */
import type { HmiPreviewBuild, HmiPreviewElementId, HmiPreviewSetter } from '../../../ports/hmi-preview-types'
import { liveDeclaration, type LiveModule, type LiveSyncPlan } from './designer-live'
import type { DesignerModel } from './designer-model'

/** An element of the shown screen in a running module. */
export interface LiveEntry {
  /** Its name as written. */
  name: string
  id: number
  /** Its widget type, upper case, when the module made it. */
  type: string
  /** Made by the module from the factory table, not compiled. */
  created: boolean
  attached: boolean
  /** Its declaration when it was taken off (`liveDeclaration`). */
  declaration?: string
}

/** The entries of a running module, by upper-case element name. */
export type LiveEntries = ReadonlyMap<string, LiveEntry>

type Built = Extract<HmiPreviewBuild, { ok: true }>

const upper = (name: string): string => name.toUpperCase()

/** The shown screen's elements as a freshly started module holds them: compiled and laid out. */
export function compiledEntries(elementIds: readonly HmiPreviewElementId[], screen: string): Map<string, LiveEntry> {
  return new Map(
    elementIds
      .filter((e) => upper(e.screen) === upper(screen))
      .map((e) => [upper(e.element), { name: e.element, id: e.id, type: '', created: false, attached: true }]),
  )
}

/** What the planner reads of the module (`planLiveSync`). */
export function liveModuleOf(entries: LiveEntries): LiveModule {
  return {
    attached: (name) => {
      const entry = entries.get(upper(name))
      return entry?.attached ? entry.id : undefined
    },
    detached: (name) => {
      const entry = entries.get(upper(name))
      return entry && !entry.attached ? { id: entry.id, declaration: entry.declaration ?? '' } : undefined
    },
    created: (name) => entries.get(upper(name))?.created ?? false,
  }
}

/**
 * The entries once the module applied `plan`: taken-off elements keep the declaration `shown` had, and the elements it
 * added or put back get the ids `ids` gives in order.
 */
export function entriesAfter(
  entries: LiveEntries,
  plan: LiveSyncPlan,
  ids: readonly number[],
  shown: { model: DesignerModel; source: string },
  next: DesignerModel,
): Map<string, LiveEntry> {
  const after = new Map(entries)
  for (const name of plan.detached) {
    const entry = after.get(upper(name))
    const declared = shown.model.elements.find((e) => upper(e.name) === upper(name))
    if (entry)
      after.set(upper(name), {
        ...entry,
        attached: false,
        declaration: declared ? liveDeclaration(shown.source, declared) : '',
      })
  }
  plan.names.forEach((name, i) => {
    const before = after.get(upper(name))
    const created = plan.elements[i].element === undefined
    const type = next.elements.find((e) => upper(e.name) === upper(name))?.type ?? ''
    after.set(upper(name), {
      name,
      id: ids[i],
      type: created ? upper(type) : (before?.type ?? ''),
      created: created || (before?.created ?? false),
      attached: true,
    })
  })
  return after
}

/**
 * The live setter of a property of an element of `screen`: an element the module made is set through the factory
 * table, a compiled one through the build's setters.
 */
export function liveSetter(
  entries: LiveEntries,
  built: Built,
  screen: string,
  element: string,
  property: string,
): HmiPreviewSetter | undefined {
  const entry = entries.get(upper(element))
  if (entry?.created) {
    const setter = built.factory.types[entry.type]?.setters[upper(property)]
    const page = built.pages[screen]
    return setter && page !== undefined ? { ...setter, screen: page, element: entry.id } : undefined
  }
  const wanted = upper(`${screen}.${element}.${property}`)
  return Object.entries(built.setters).find(([k]) => upper(k) === wanted)?.[1]
}

/** The element ids of `screen` as the module numbers them, names as written. */
export function liveElementIds(entries: LiveEntries, screen: string): HmiPreviewElementId[] {
  return [...entries.values()].map((e) => ({ id: e.id, screen, element: e.name }))
}
