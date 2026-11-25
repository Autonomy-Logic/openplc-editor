/**
 * Copy and paste of designer elements, within a screen and between screens and widget blocks: an element travels
 * with everything under it, its bindings and its event handlers.
 */
import {
  bindingStatement,
  descendants,
  type DesignerEdit,
  eventStatement,
  nextElementName,
  pasteDeclarations,
} from './designer-edits'
import type { DesignerModel } from './designer-model'

export interface CopiedElement {
  name: string
  type: string
  /** A copied element it sits in; null for the elements the copy was made of. */
  parent: string | null
  /** Properties other than Parent, as ST values. */
  props: Array<[string, string]>
}

export interface DesignerClipboard {
  kind: 'openplc-hmi-elements'
  version: 1
  elements: CopiedElement[]
  bindings: Array<{ element: string; property: string; variable: string }>
  events: Array<{ element: string; event: string; code: string }>
}

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isString = (value: unknown): value is string => typeof value === 'string'

/** The elements named, with everything under them; null when none of them can be copied. */
export function copyElements(model: DesignerModel, names: readonly string[]): DesignerClipboard | null {
  const picked = new Map<string, CopiedElement>()
  for (const name of names) {
    const top = model.elements.find((e) => same(e.name, name))
    if (!top || top.locked) continue
    for (const e of [top, ...descendants(model, name)]) {
      if (picked.has(e.name.toUpperCase()) || e.locked) continue
      picked.set(e.name.toUpperCase(), {
        name: e.name,
        type: e.type,
        parent: e === top ? null : e.parent,
        props: e.props.filter((p) => !same(p.name, 'Parent')).map((p) => [p.name, p.value]),
      })
    }
  }
  if (picked.size === 0) return null
  const copied = (element: string) => picked.has(element.toUpperCase())
  const order = new Map(model.elements.map((e, i) => [e.name.toUpperCase(), i]))
  return {
    kind: 'openplc-hmi-elements',
    version: 1,
    elements: [...picked.values()].sort(
      (a, b) => (order.get(a.name.toUpperCase()) ?? 0) - (order.get(b.name.toUpperCase()) ?? 0),
    ),
    bindings: model.bindings
      .filter((b) => copied(b.element))
      .map(({ element, property, variable }) => ({ element, property, variable })),
    events: model.events.filter((e) => copied(e.element)).map(({ element, event, code }) => ({ element, event, code })),
  }
}

/** Reads a clipboard payload that came from outside, such as the system clipboard; null when it is not one. */
export function parseDesignerClipboard(value: unknown): DesignerClipboard | null {
  if (!isRecord(value) || value.kind !== 'openplc-hmi-elements' || value.version !== 1) return null
  const { elements, bindings, events } = value
  if (!Array.isArray(elements) || !Array.isArray(bindings) || !Array.isArray(events)) return null
  const parsed: DesignerClipboard = { kind: 'openplc-hmi-elements', version: 1, elements: [], bindings: [], events: [] }
  for (const e of elements) {
    if (!isRecord(e) || !isString(e.name) || !isString(e.type) || !(e.parent === null || isString(e.parent)))
      return null
    if (!Array.isArray(e.props)) return null
    const props: Array<[string, string]> = []
    for (const p of e.props) {
      if (!Array.isArray(p) || p.length !== 2 || !isString(p[0]) || !isString(p[1])) return null
      props.push([p[0], p[1]])
    }
    parsed.elements.push({ name: e.name, type: e.type, parent: e.parent, props })
  }
  for (const b of bindings) {
    if (!isRecord(b) || !isString(b.element) || !isString(b.property) || !isString(b.variable)) return null
    parsed.bindings.push({ element: b.element, property: b.property, variable: b.variable })
  }
  for (const e of events) {
    if (!isRecord(e) || !isString(e.element) || !isString(e.event) || !isString(e.code)) return null
    parsed.events.push({ element: e.element, event: e.event, code: e.code })
  }
  return parsed.elements.length > 0 ? parsed : null
}

/**
 * Pastes copied elements under `parent` (null: the screen), before a sibling or last. A copied name that is free
 * stays; otherwise the element gets the next free one, and the properties, bindings and handlers follow.
 */
export function pasteElements(
  source: string,
  model: DesignerModel,
  clipboard: DesignerClipboard,
  parent: string | null,
  before: string | null = null,
  refersToElement: (type: string, property: string) => boolean = () => false,
): DesignerEdit & { names?: string[] } {
  const taken = new Set(model.members)
  const names = new Map<string, string>()
  for (const e of clipboard.elements) {
    let name = e.name
    if (taken.has(name.toUpperCase())) {
      name = nextElementName({ ...model, members: taken }, e.name.replace(/\d+$/, ''))
    }
    taken.add(name.toUpperCase())
    names.set(e.name.toUpperCase(), name)
  }
  const renamed = (name: string): string => names.get(name.toUpperCase()) ?? name
  const elements = clipboard.elements.map((e) => ({
    name: renamed(e.name),
    type: e.type,
    parent: e.parent === null ? parent : renamed(e.parent),
    props: e.props.map(([k, v]): [string, string] => {
      if (!refersToElement(e.type, k)) return [k, v]
      const target = /^'((?:[^'$]|\$.)*)'$/s.exec(v.trim())?.[1]
      return target !== undefined && names.has(target.toUpperCase()) ? [k, `'${renamed(target)}'`] : [k, v]
    }),
  }))
  const result = pasteDeclarations(source, model, elements, parent, before, [
    ...clipboard.bindings.map((b) => bindingStatement(model, renamed(b.element), b.property, b.variable)),
    ...clipboard.events.map((e) => eventStatement(model, renamed(e.element), e.event, e.code)),
  ])
  return result.ok ? { ...result, names: elements.map((e) => e.name) } : result
}
