/**
 * New elements shown before the next build: where the running preview must create them so its frame matches the
 * build's exactly, read from the screen's source after the edit (see `hmi_unit_live_add`).
 */
import type {
  HmiLiveContainer,
  HmiLiveElement,
  HmiPreviewFactory,
  HmiWidgetCatalog,
} from '../../../ports/hmi-preview-types'
import { hmiTextLiteral } from '../block-checks'
import { isContainerType, liveValue, widgetIsA } from './designer-canvas'
import type { DesignerElement, DesignerModel } from './designer-model'

/** The elements to add, in the order the build attaches them, with their names. */
export interface LivePlan {
  names: string[]
  elements: HmiLiveElement[]
}

export interface LivePlanInput {
  /** The screen as the source reads after the edit. */
  model: DesignerModel
  /** Names of the elements the edit added. */
  added: readonly string[]
  catalog: HmiWidgetCatalog
  factory: HmiPreviewFactory
  /** The element id the running module gives an element of the shown screen; undefined when it has none. */
  idOf: (name: string) => number | undefined
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

/**
 * How the running preview adds the elements an edit declared, or null when it cannot show them exactly as the build
 * will: a type it cannot create, a pipe, an element that code, wiring or another element refers to, a value it cannot
 * set live, or a neighbour the running module does not have.
 */
export function planLiveElements(input: LivePlanInput): LivePlan | null {
  const { model, catalog, factory, idOf } = input
  const added = new Set(input.added.map(upper))
  const parentOf = containers(model, catalog)
  const order = attachOrder(model, parentOf)
  const fresh = order.filter((e) => added.has(upper(e.name)))
  if (fresh.length === 0 || fresh.length !== added.size) return null
  const existing = (e: DesignerElement): number | null => (added.has(upper(e.name)) ? null : (idOf(e.name) ?? -1))

  const plan: LivePlan = { names: [], elements: [] }
  for (const element of fresh) {
    const info = catalog.widgets.get(upper(element.type))
    const made = factory.types[upper(element.type)]
    if (!info || !made || widgetIsA(catalog, element.type, 'HMIPIPE') || referenced(model, catalog, element))
      return null

    const container = parentOf.get(element)
    let parent: HmiLiveElement['parent']
    let parentKind: HmiLiveContainer | null
    if (!container) {
      if (!isContainerType(catalog, element.type)) return null
      parent = { id: 0 }
      parentKind = 'stack'
    } else {
      const index = plan.names.findIndex((n) => upper(n) === upper(container.name))
      const id = index >= 0 ? undefined : idOf(container.name)
      if (index < 0 && id === undefined) return null
      parent = index >= 0 ? { added: index } : { id: id ?? 0 }
      parentKind = containerKind(catalog, container.type)
    }
    if (parentKind === null) return null

    const siblings = model.elements.filter((e) => parentOf.get(e) === container)
    const nextSibling = siblings.slice(siblings.indexOf(element) + 1).find((e) => existing(e) !== null)
    const before = nextSibling ? existing(nextSibling) : 0
    const nextDrawn = order
      .slice(order.indexOf(element) + 1)
      .find((e) => existing(e) !== null && !widgetIsA(catalog, e.type, 'HMIPIPE'))
    const drawBefore = nextDrawn ? existing(nextDrawn) : 0
    if (before === null || before < 0 || drawBefore === null || drawBefore < 0) return null

    const values = element.props.filter((p) => upper(p.name) !== PARENT).map((p) => ({ name: p.name, value: p.value }))
    for (const d of info.typeDefaults ?? [])
      if (!element.props.some((p) => upper(p.name) === upper(d.name))) values.push(d)
    const numbers: Array<{ setter: number; value: number }> = []
    const texts: Array<{ setter: number; value: string }> = []
    for (const { name, value } of values) {
      const setter = made.setters[upper(name)]
      const live = liveValue(value)
      if (setter?.kind === 'num' && live && 'number' in live) numbers.push({ setter: setter.index, value: live.number })
      else if (setter?.kind === 'str' && live && 'text' in live) texts.push({ setter: setter.index, value: live.text })
      else return null
    }
    plan.names.push(element.name)
    plan.elements.push({ type: made.type, parent, parentKind, before, drawBefore, numbers, texts })
  }
  return plan
}
