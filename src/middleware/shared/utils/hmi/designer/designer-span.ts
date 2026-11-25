/**
 * How the designer sizes elements in stacks. An element with AutoSize takes its Span, a percent of the length its
 * stack's pixel-sized children leave (scaled down when the spans add up to more than 100), and fills the stack
 * across; pixel sizes are ignored. Without AutoSize it keeps its natural or preferred size in pixels.
 */
import type { HmiWidgetCatalog } from '../../../ports/hmi-preview-types'
import {
  type CanvasElement,
  isContainerType,
  isSideBySide,
  propertyEnabled,
  propertyText,
  widgetIsA,
} from './designer-canvas'
import { type DesignerEdit, moveElement, setProperties } from './designer-edits'
import { type DesignerElement, type DesignerModel, parseDesignerBlock } from './designer-model'

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** Input that sizes an element by Span in a stack. */
export const AUTO_SIZE = 'AutoSize'
/** Percent of the stack's length an element with AutoSize takes. */
export const SPAN = 'Span'
/** Smallest Span a drop writes. */
const MIN_DROP_SPAN = 5
/** Span a dropped widget gets when its natural size or the stack's room is not known yet. */
const FALLBACK_SPAN = 25

/** Size, in logical units, of a widget or a box. */
export interface Size {
  width: number
  height: number
}

/** A screen as the canvas shows it: its model, the widget catalogue, the elements' boxes and the screen's size. */
export interface StackView {
  model: DesignerModel
  catalog: HmiWidgetCatalog
  boxes: readonly CanvasElement[]
  /** Logical size of the screen, whose own stack holds the containers placed on it. */
  screen: Size
}

/** Padding and gap of the stack every screen lays its containers out in (HmiScreen's Root). */
const SCREEN_PADDING = 12
const SCREEN_GAP = 8

const isTrue = (el: DesignerElement, catalog: HmiWidgetCatalog, property: string): boolean =>
  (propertyText(el, catalog, property) ?? 'FALSE').trim().toUpperCase() === 'TRUE'

const numberOf = (el: DesignerElement, catalog: HmiWidgetCatalog, property: string): number | null => {
  const value = Number((propertyText(el, catalog, property) ?? '').trim())
  return Number.isFinite(value) ? value : null
}

const find = (model: DesignerModel, name: string | null): DesignerElement | undefined =>
  name === null ? undefined : model.elements.find((e) => same(e.name, name))

/** Whether elements under `parent` (null: the screen, which stacks its containers top to bottom) sit in a stack. */
export function inStack(model: DesignerModel, catalog: HmiWidgetCatalog, parent: string | null): boolean {
  if (parent === null) return true
  const container = find(model, parent)
  return container !== undefined && widgetIsA(catalog, container.type, 'HmiStack')
}

/** Whether an element is sized by its Span: AutoSize on, laid out by a stack. */
export function sizedBySpan(model: DesignerModel, catalog: HmiWidgetCatalog, el: DesignerElement): boolean {
  return inStack(model, catalog, el.parent) && isTrue(el, catalog, AUTO_SIZE) && !isTrue(el, catalog, 'Floating')
}

/** Whether a stack lays its children out side by side; the screen stacks them top to bottom. */
const sideBySide = (model: DesignerModel, catalog: HmiWidgetCatalog, parent: string | null): boolean =>
  parent !== null && isSideBySide(catalog, find(model, parent)?.type ?? '')

/** The children a stack lays out: not hidden by a literal FALSE, not floating. */
const laidOut = (model: DesignerModel, catalog: HmiWidgetCatalog, parent: string | null): DesignerElement[] =>
  model.elements.filter(
    (e) =>
      (e.parent === null ? parent === null : parent !== null && same(e.parent, parent)) &&
      !isTrue(e, catalog, 'Floating') &&
      (propertyText(e, catalog, 'Visible') ?? 'TRUE').trim().toUpperCase() !== 'FALSE',
  )

/** Total Span of a stack's children sized by Span, `except` left out. */
function otherSpans(model: DesignerModel, catalog: HmiWidgetCatalog, parent: string | null, except?: string): number {
  return laidOut(model, catalog, parent)
    .filter((e) => (except === undefined || !same(e.name, except)) && sizedBySpan(model, catalog, e))
    .reduce((sum, e) => sum + Math.max(numberOf(e, catalog, SPAN) ?? 100, 0), 0)
}

/**
 * The length, in logical units, a stack shares among its children sized by Span: its length along the stack less
 * padding, gaps and the pixel-sized children, from the boxes on the canvas. `adding` counts one more child, for an
 * element about to go in; `except` is the element measured, never counted as pixel-sized. Null when unknown.
 */
export function stackRoom(view: StackView, parent: string | null, adding: boolean, except?: string): number | null {
  const { model, catalog, boxes } = view
  const container = find(model, parent)
  const box = container ? boxes.find((b) => same(b.name, container.name))?.box : view.screen
  if ((parent !== null && !container) || !box) return null
  const across = sideBySide(model, catalog, parent)
  const children = laidOut(model, catalog, parent)
  const counted = children.length + (adding && !children.some((c) => except && same(c.name, except)) ? 1 : 0)
  const padding = container ? (numberOf(container, catalog, 'Padding') ?? 0) : SCREEN_PADDING
  const gap = container ? (numberOf(container, catalog, 'Gap') ?? 0) : SCREEN_GAP
  let room = (across ? box.width : box.height) - 2 * padding - gap * Math.max(counted - 1, 0)
  for (const child of children) {
    if ((except && same(child.name, except)) || sizedBySpan(model, catalog, child)) continue
    const childBox = boxes.find((b) => same(b.name, child.name))?.box
    if (childBox) room -= across ? childBox.width : childBox.height
  }
  return room > 0 ? room : null
}

/**
 * The Span that gives an element `length` logical units in `parent`, given its siblings' spans and the stack's room:
 * its share of the room while the spans fit in 100, else the value that gives that length once they are scaled down.
 */
function spanForLength(
  view: StackView,
  element: string,
  parent: string | null,
  length: number,
  adding: boolean,
): number | null {
  const room = stackRoom(view, parent, adding, element)
  if (room === null || room < 2) return null
  const others = otherSpans(view.model, view.catalog, parent, element)
  const t = Math.min(Math.max(length, 1), room - 1)
  const share = (t / room) * 100
  const span = share + others <= 100 ? share : (others * t) / (room - t)
  return Math.max(1, Math.round(span))
}

/**
 * What a new element placed under `parent` starts with. In a stack it gets AutoSize and a Span: a container takes
 * the room its siblings leave (an equal share when they leave none); a widget takes its natural size's share of the
 * stack, at least 5 and at most the room left, 25 when that is not known. Elsewhere nothing.
 */
export function placementProperties(
  view: StackView,
  parent: string | null,
  type: string,
  natural: Size | undefined,
): Array<[string, string]> {
  const { model, catalog } = view
  if (!inStack(model, catalog, parent)) return []
  const others = otherSpans(model, catalog, parent)
  const rest = 100 - others
  let span: number
  if (isContainerType(catalog, type)) {
    const siblings = laidOut(model, catalog, parent).filter((e) => sizedBySpan(model, catalog, e)).length
    span = rest >= MIN_DROP_SPAN ? rest : Math.round(100 / (siblings + 1))
  } else {
    const room = stackRoom(view, parent, true)
    const length = natural ? (sideBySide(model, catalog, parent) ? natural.width : natural.height) : undefined
    span =
      room !== null && length !== undefined && length > 0
        ? Math.min(Math.max(Math.round((length / room) * 100), MIN_DROP_SPAN), 100)
        : FALLBACK_SPAN
    if (rest >= MIN_DROP_SPAN) span = Math.min(span, rest)
  }
  return [
    [AUTO_SIZE, 'TRUE'],
    [SPAN, String(span)],
  ]
}

/**
 * What resizing an element to `size` writes. An element sized by Span changes only its Span, from its length along
 * the stack (it fills the stack across); any other element gets PrefWidth and PrefHeight.
 */
export function resizeProperties(
  view: StackView,
  element: string,
  size: { width?: number; height?: number },
): Array<[string, string]> {
  const { model, catalog } = view
  const el = find(model, element)
  if (el && sizedBySpan(model, catalog, el)) {
    const length = sideBySide(model, catalog, el.parent) ? size.width : size.height
    if (length === undefined) return []
    const span = spanForLength(view, el.name, el.parent, length, false)
    return span === null ? [] : [[SPAN, String(span)]]
  }
  const entries: Array<[string, string]> = []
  if (size.width !== undefined) entries.push(['PrefWidth', String(size.width)])
  if (size.height !== undefined) entries.push(['PrefHeight', String(size.height)])
  return entries
}

/**
 * The Span an element sized by Span gets when it moves to another stack, so it keeps the length it has on the
 * canvas along the new stack; empty for a move within its stack, or an element not sized by Span there.
 */
export function moveProperties(view: StackView, element: string, parent: string | null): Array<[string, string]> {
  const { model, catalog } = view
  const el = find(model, element)
  const box = view.boxes.find((b) => same(b.name, element))?.box
  const sameParent = el?.parent === null ? parent === null : parent !== null && same(el?.parent ?? '', parent)
  if (!el || !box || sameParent || !inStack(model, catalog, parent) || !isTrue(el, catalog, AUTO_SIZE)) return []
  const length = sideBySide(model, catalog, parent) ? box.width : box.height
  const span = spanForLength(view, el.name, parent, length, true)
  return span === null ? [] : [[SPAN, String(span)]]
}

/** Span each child sized by Span is drawn at, once the stack's spans are scaled to fit in 100. */
export function shownSpan(model: DesignerModel, catalog: HmiWidgetCatalog, el: DesignerElement): number | null {
  if (!sizedBySpan(model, catalog, el)) return null
  const own = Math.max(numberOf(el, catalog, SPAN) ?? 100, 0)
  const total = otherSpans(model, catalog, el.parent, el.name) + own
  return total > 100 ? Math.round((own * 100) / total) : own
}

/** Pixel sizes an element sized by Span ignores. */
const PIXEL_SIZES = ['PrefWidth', 'PrefHeight']

/**
 * Why a property of an element takes no effect where it sits, or null when it does: a property enabled by a BOOL
 * that is off, or a pixel size of an element sized by Span.
 */
export function propertyIgnored(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  el: DesignerElement,
  property: string,
): string | null {
  if (PIXEL_SIZES.some((p) => same(p, property)) && sizedBySpan(model, catalog, el))
    return `Ignored while ${AUTO_SIZE} is on: the size comes from ${SPAN}`
  if (propertyEnabled(el, catalog, property)) return null
  const info = catalog.widgets.get(el.type.toUpperCase())
  const switchName = info?.properties.find((p) => same(p.name, property))?.enabledBy
  return switchName ? `Takes effect when ${switchName} is on` : null
}

/** Moves an element to another place, writing the Span that keeps its length on the canvas in a new stack. */
export function moveSized(
  view: StackView,
  source: string,
  element: string,
  parent: string | null,
  before: string | null,
  isWidget: (type: string) => boolean,
): DesignerEdit {
  const moved = moveElement(source, view.model, element, parent, before)
  const entries = moveProperties(view, element, parent)
  if (!moved.ok || entries.length === 0) return moved
  const parsed = parseDesignerBlock(moved.source, isWidget)
  return parsed.ok ? setProperties(moved.source, parsed.model, element, entries, isWidget) : moved
}
