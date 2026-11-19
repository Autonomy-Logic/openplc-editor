/**
 * Structural edits shown before the next build: how the running preview takes elements off, moves them and adds new
 * ones so its frame matches the build's exactly, from the screen the module shows and the screen after the edit (see
 * `hmi_unit_live_add`, `_detach` and `_attach`).
 */
import type {
  HmiLiveContainer,
  HmiLiveDetach,
  HmiLiveElement,
  HmiPreviewFactory,
  HmiWidgetCatalog,
} from '../../../ports/hmi-preview-types'
import { hmiTextLiteral } from '../block-checks'
import { isContainerType, liveValue, widgetIsA } from './designer-canvas'
import type { DesignerElement, DesignerModel } from './designer-model'

/** What the running module holds of the shown screen, by element name. */
export interface LiveModule {
  /** The id of an element the module lays out and draws. */
  attached: (name: string) => number | undefined
  /**
   * An element the module took off and still holds, to put back: its id and its declaration as the source read when
   * it was taken off (`liveDeclaration`).
   */
  detached: (name: string) => { id: number; declaration: string } | undefined
  /** Whether the module made the element from the factory table, so the build's code does not drive it. */
  created: (name: string) => boolean
}

export interface LiveSyncInput {
  /** The screen as the running module shows it, and its source. */
  shown: DesignerModel
  shownSource: string
  /** The screen as the source reads now, and that source. */
  next: DesignerModel
  nextSource: string
  catalog: HmiWidgetCatalog
  factory: HmiPreviewFactory
  module: LiveModule
}

/**
 * The change, in order: elements to take off (`detached` names them), then elements to add or put back (`names`),
 * in the order the build attaches them, then property values of elements the module keeps, as ST text. Removing an
 * element takes it off; moving one takes it off and puts it back.
 */
export interface LiveSyncPlan {
  detach: HmiLiveDetach[]
  detached: string[]
  elements: HmiLiveElement[]
  names: string[]
  values: Array<{ element: string; property: string; value: string }>
}

const PARENT = 'PARENT'
const upper = (name: string): string => name.toUpperCase()

/** The container each element sits in, as the build reads `Parent`; absent for the screen's own stack. */
function containers(model: DesignerModel, catalog: HmiWidgetCatalog): Map<DesignerElement, DesignerElement> {
  const byName = new Map(model.elements.map((e) => [upper(e.name), e]))
  const parentOf = new Map<DesignerElement, DesignerElement>()
  for (const e of model.elements) {
    const parent = e.parent === null ? undefined : byName.get(upper(e.parent))
    if (parent && isContainerType(catalog, parent.type)) parentOf.set(e, parent)
  }
  return parentOf
}

/** Elements in the order the build attaches them: containers before what they hold, siblings as declared. */
function attachOrder(model: DesignerModel, parentOf: ReadonlyMap<DesignerElement, DesignerElement>): DesignerElement[] {
  const order: DesignerElement[] = []
  const visit = (parent: DesignerElement | undefined, depth: number): void => {
    for (const e of model.elements) {
      if (parentOf.get(e) !== parent || order.includes(e) || depth > model.elements.length) continue
      order.push(e)
      visit(e, depth + 1)
    }
  }
  visit(undefined, 0)
  return order
}

const containerKind = (catalog: HmiWidgetCatalog, type: string): HmiLiveContainer | null =>
  widgetIsA(catalog, type, 'HMIDIAGRAM') ? 'diagram' : widgetIsA(catalog, type, 'HMISTACK') ? 'stack' : null

/** Whether anything in the screen besides its own declaration names the element: code, wiring or a reference. */
function referenced(model: DesignerModel, catalog: HmiWidgetCatalog, element: DesignerElement): boolean {
  const name = upper(element.name)
  if (model.bindings.some((b) => upper(b.element) === name)) return true
  if (model.events.some((e) => upper(e.element) === name)) return true
  if (model.uses.some((u) => u.name === name)) return true
  return model.elements.some((other) =>
    other.props.some((p) => {
      if (upper(p.name) === PARENT) return false
      const kind = catalog.widgets.get(upper(other.type))?.properties.find((d) => upper(d.name) === upper(p.name))?.kind
      return kind === 'elementRef' && upper(hmiTextLiteral(p.value) ?? '') === name
    }),
  )
}

/** The longest common subsequence of two lists of names, as a set. */
function common(a: readonly string[], b: readonly string[]): Set<string> {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const kept = new Set<string>()
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      kept.add(a[i])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) i++
    else j++
  }
  return kept
}

/** A screen's tree by upper-case name: each element, its container and its order. */
interface Tree {
  byName: Map<string, DesignerElement>
  parentOf: Map<DesignerElement, DesignerElement>
  order: DesignerElement[]
  /** The pipe drawn just before each pipe in its container, as the build connects them; null for the first. */
  prior: Map<string, string | null>
}

function treeOf(model: DesignerModel, catalog: HmiWidgetCatalog): Tree {
  const parentOf = containers(model, catalog)
  const prior = new Map<string, string | null>()
  const last = new Map<string, string>()
  for (const e of model.elements) {
    if (!widgetIsA(catalog, e.type, 'HMIPIPE')) continue
    const parent = upper(e.parent ?? '')
    prior.set(upper(e.name), last.get(parent) ?? null)
    last.set(parent, upper(e.name))
  }
  return {
    byName: new Map(model.elements.map((e) => [upper(e.name), e])),
    parentOf,
    order: attachOrder(model, parentOf),
    prior,
  }
}

const parentName = (tree: Tree, e: DesignerElement): string => upper(tree.parentOf.get(e)?.name ?? '')

/** An element's declaration in `source`, with runs of white space as one: what a module took off still holds. */
export function liveDeclaration(source: string, element: DesignerElement): string {
  return source.slice(element.lines.start, element.lines.end).replace(/\s+/g, ' ').trim()
}

/**
 * A screen's source without its element declarations, nor the wiring and event code of the elements in `gone`, with
 * runs of white space as one: what changes when its code, theme or methods change.
 */
function codeText(source: string, model: DesignerModel, gone: ReadonlySet<string>): string {
  const spans = [
    ...model.elements.map((e) => e.lines),
    ...model.bindings.filter((b) => gone.has(upper(b.element))).map((b) => b.lines),
    ...model.events.filter((e) => gone.has(upper(e.element))).map((e) => e.lines),
  ].sort((a, b) => a.start - b.start)
  let text = ''
  let at = 0
  for (const span of spans) {
    if (span.start > at) text += source.slice(at, span.start)
    at = Math.max(at, span.end)
  }
  return `${text}${source.slice(at)}`.replace(/\s+/g, ' ').trim()
}

/**
 * How the running preview makes the screen it shows into the screen the source now declares, or null when it cannot
 * show the result exactly as the build will. It takes off removed elements and their contents, and takes off and puts
 * back moved ones (a new container or a new place among their siblings) with their contents. It adds new elements
 * from the factory unless code, wiring or another element refers to them or a value cannot be set live. It refuses
 * a type change, an element the module does not hold, a pipe that would be put back or whose preceding pipe changes,
 * an element that still refers to one taken off, and any other change of the screen's code, theme or methods (the
 * wiring and event code of removed elements, and of compiled elements put back, excepted: the build's code has them). Code that still names a removed element does not stop it: the
 * module shows the removal while the build reports the code. Changed property values of kept elements are listed for
 * the caller's live setters; a value removed from the source returns to the type's start value.
 */
export function planLiveSync(input: LiveSyncInput): LiveSyncPlan | null {
  const { catalog, factory, module } = input
  const shown = treeOf(input.shown, catalog)
  const next = treeOf(input.next, catalog)
  const isPipe = (e: DesignerElement): boolean => widgetIsA(catalog, e.type, 'HMIPIPE')

  const roots = new Set<string>()
  for (const [name, e] of shown.byName) {
    const now = next.byName.get(name)
    if (!now) roots.add(name)
    else if (upper(now.type) !== upper(e.type)) return null
    else if (parentName(shown, e) !== parentName(next, now)) roots.add(name)
  }
  const stays = (tree: Tree, parent: string) =>
    input[tree === shown ? 'shown' : 'next'].elements
      .map((e) => upper(e.name))
      .filter((n) => {
        const a = shown.byName.get(n)
        const b = next.byName.get(n)
        return a && b && !roots.has(n) && parentName(shown, a) === parent && parentName(next, b) === parent
      })
  for (const parent of new Set([...shown.byName.values()].map((e) => parentName(shown, e)))) {
    const before = stays(shown, parent)
    const kept = common(before, stays(next, parent))
    for (const n of before) if (!kept.has(n)) roots.add(n)
  }

  const off = new Set<string>()
  const close = (e: DesignerElement): void => {
    off.add(upper(e.name))
    for (const child of input.shown.elements) if (shown.parentOf.get(child) === e) close(child)
  }
  for (const name of roots) {
    const e = shown.byName.get(name)
    if (e) close(e)
  }

  /** Whether an element the source declares again is one the module holds as it was taken off. */
  const returning = (name: string): boolean => {
    const held = module.detached(name)
    const now = next.byName.get(name)
    return held !== undefined && now !== undefined && liveDeclaration(input.nextSource, now) === held.declaration
  }
  const gone = new Set([...shown.byName.keys()].filter((n) => !next.byName.has(n)))
  for (const name of next.byName.keys())
    if (!shown.byName.has(name) && returning(name) && !module.created(name)) gone.add(name)
  if (codeText(input.shownSource, input.shown, gone) !== codeText(input.nextSource, input.next, gone)) return null

  for (const [name, e] of next.byName) {
    if (isPipe(e) && !off.has(name) && shown.byName.has(name) && next.prior.get(name) !== shown.prior.get(name))
      return null
    for (const p of e.props) {
      if (upper(p.name) === PARENT) continue
      const kind = catalog.widgets.get(upper(e.type))?.properties.find((d) => upper(d.name) === upper(p.name))?.kind
      const target = upper(hmiTextLiteral(p.value) ?? '')
      if (kind === 'elementRef' && off.has(target) && !next.byName.has(target)) return null
    }
  }

  const plan: LiveSyncPlan = { detach: [], detached: [], elements: [], names: [], values: [] }
  for (const e of [...shown.order].reverse()) {
    if (!off.has(upper(e.name))) continue
    const id = module.attached(e.name)
    const container = shown.parentOf.get(e)
    const parent = container ? module.attached(container.name) : 0
    const kind = container ? containerKind(catalog, container.type) : 'stack'
    if (id === undefined || parent === undefined || kind === null) return null
    plan.detach.push({ element: id, parent, parentKind: kind })
    plan.detached.push(e.name)
  }

  const batch = next.order.filter((e) => off.has(upper(e.name)) || !shown.byName.has(upper(e.name)))
  const inBatch = new Set(batch.map((e) => upper(e.name)))
  const existing = (e: DesignerElement): number | null =>
    inBatch.has(upper(e.name)) ? null : (module.attached(e.name) ?? -1)
  for (const element of batch) {
    const name = upper(element.name)
    const back = off.has(name)
      ? module.attached(element.name)
      : returning(name)
        ? module.detached(element.name)?.id
        : undefined
    if (back === undefined && module.attached(element.name) !== undefined) return null
    if (back === undefined && module.detached(element.name) !== undefined && !module.created(element.name)) return null
    const info = catalog.widgets.get(upper(element.type))
    const made = factory.types[upper(element.type)]
    if (!info || isPipe(element)) return null
    if (back === undefined && (!made || referenced(input.next, catalog, element))) return null

    const container = next.parentOf.get(element)
    let parent: HmiLiveElement['parent']
    let parentKind: HmiLiveContainer | null
    if (!container) {
      if (!isContainerType(catalog, element.type)) return null
      parent = { id: 0 }
      parentKind = 'stack'
    } else {
      const index = plan.names.findIndex((n) => upper(n) === upper(container.name))
      const id = index >= 0 ? undefined : module.attached(container.name)
      if (index < 0 && (id === undefined || off.has(upper(container.name)))) return null
      parent = index >= 0 ? { added: index } : { id: id ?? 0 }
      parentKind = containerKind(catalog, container.type)
    }
    if (parentKind === null) return null

    const siblings = input.next.elements.filter((e) => next.parentOf.get(e) === container)
    const nextSibling = siblings.slice(siblings.indexOf(element) + 1).find((e) => existing(e) !== null)
    const before = nextSibling ? existing(nextSibling) : 0
    const nextDrawn = next.order.slice(next.order.indexOf(element) + 1).find((e) => existing(e) !== null && !isPipe(e))
    const drawBefore = nextDrawn ? existing(nextDrawn) : 0
    if (before === null || before < 0 || drawBefore === null || drawBefore < 0) return null

    plan.names.push(element.name)
    if (back !== undefined) {
      plan.elements.push({ type: 0, element: back, parent, parentKind, before, drawBefore, numbers: [], texts: [] })
      continue
    }
    if (!made) return null
    const values = element.props.filter((p) => upper(p.name) !== PARENT).map((p) => ({ name: p.name, value: p.value }))
    for (const d of info.typeDefaults ?? [])
      if (!element.props.some((p) => upper(p.name) === upper(d.name))) values.push(d)
    const numbers: Array<{ setter: number; value: number }> = []
    const texts: Array<{ setter: number; value: string }> = []
    for (const { name: property, value } of values) {
      const setter = made.setters[upper(property)]
      const live = liveValue(value)
      if (setter?.kind === 'num' && live && 'number' in live) numbers.push({ setter: setter.index, value: live.number })
      else if (setter?.kind === 'str' && live && 'text' in live) texts.push({ setter: setter.index, value: live.text })
      else return null
    }
    plan.elements.push({ type: made.type, parent, parentKind, before, drawBefore, numbers, texts })
  }

  for (const [name, now] of next.byName) {
    const was = shown.byName.get(name)
    if (!was) continue
    const info = catalog.widgets.get(upper(now.type))
    const valueOf = (e: DesignerElement) => new Map(e.props.map((p) => [upper(p.name), p.value.trim()]))
    const before = valueOf(was)
    const after = valueOf(now)
    for (const property of new Set([...before.keys(), ...after.keys()])) {
      if (property === PARENT || before.get(property) === after.get(property)) continue
      const declared = info?.properties.find((p) => upper(p.name) === property)
      const start =
        info?.typeDefaults?.find((d) => upper(d.name) === property)?.value ?? declared?.defaultValue ?? undefined
      const value = after.get(property) ?? start
      if (!declared || value === undefined) return null
      plan.values.push({ element: now.name, property: declared.name, value })
    }
  }
  return plan
}
