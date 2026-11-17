/**
 * What the designer's canvas works out from the widget catalogue and the preview's element bounds: which elements
 * contain others, which element is under the pointer, where a drop lands, and whether an edit can apply live.
 */
import type { HmiPreviewBounds, HmiPreviewElementId, HmiWidgetCatalog } from '../../../ports/hmi-preview-types'
import { descendants } from './designer-edits'
import type { DesignerElement, DesignerModel } from './designer-model'
import { stringLiteralValue } from './designer-model'

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()
const upper = (name: string): string => name.toUpperCase()

/** Whether `type` is `base` or extends it, through library and project widgets. */
export function widgetIsA(catalog: HmiWidgetCatalog, type: string, base: string): boolean {
  let current: string | undefined = type.toUpperCase()
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current)) {
    if (current === base.toUpperCase()) return true
    seen.add(current)
    current = catalog.widgets.get(current)?.extends.toUpperCase()
  }
  return false
}

/** Elements that hold others: the vertical and horizontal stacks, diagrams and the widgets that extend them. */
export const isContainerType = (catalog: HmiWidgetCatalog, type: string): boolean =>
  widgetIsA(catalog, type, 'HmiStack') || widgetIsA(catalog, type, 'HmiDiagram')

/** Whether a widget lays its children out side by side: a vertical stack or a widget that extends one. */
export const isSideBySide = (catalog: HmiWidgetCatalog, type: string): boolean =>
  widgetIsA(catalog, type, 'HmiVerticalStack')

/** The notice a placement outside every container gets. */
export const OUTSIDE_CONTAINER_NOTICE = 'Place widgets inside a stack or a diagram'

/**
 * Why elements of these types may not go under `parent` (null: the screen), or null when they may: only containers
 * sit directly on a screen.
 */
export function placementRefusal(
  catalog: HmiWidgetCatalog,
  types: readonly string[],
  parent: string | null,
): string | null {
  return parent === null && types.some((t) => !isContainerType(catalog, t)) ? OUTSIDE_CONTAINER_NOTICE : null
}

/**
 * Where a palette add or a paste goes: into the selected container, else the selected element's container, else the
 * screen's first container; null (the screen) when there is none.
 */
export function insertionParent(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  selected: DesignerElement | null,
): string | null {
  if (selected && isContainerType(catalog, selected.type)) return selected.name
  if (selected?.parent) return selected.parent
  return model.elements.find((e) => e.parent === null && isContainerType(catalog, e.type))?.name ?? null
}

/** The value a live setter takes for an ST literal: a number (BOOL as 0/1), a text, or null when a build is needed. */
export function liveValue(text: string): { number: number } | { text: string } | null {
  const trimmed = text.trim()
  if (/^TRUE$/i.test(trimmed)) return { number: 1 }
  if (/^FALSE$/i.test(trimmed)) return { number: 0 }
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return { number: Number(trimmed) }
  const literal = stringLiteralValue(trimmed)
  return literal === null ? null : { text: literal }
}

/** An element as the canvas sees it: its name and its box in logical units. */
export interface CanvasElement {
  name: string
  box: HmiPreviewBounds
}

/** The named elements of one screen among a frame's bounds, ports and other records left out. */
export function canvasElements(
  bounds: readonly HmiPreviewBounds[],
  elementIds: readonly HmiPreviewElementId[],
  screen: string,
  model: DesignerModel,
): CanvasElement[] {
  const names = new Map<number, string>()
  for (const e of elementIds) if (same(e.screen, screen)) names.set(e.id, e.element)
  const declared = new Set(model.elements.map((e) => e.name.toUpperCase()))
  const out: CanvasElement[] = []
  for (const box of bounds) {
    const name = names.get(box.id)
    if (name !== undefined && declared.has(name.toUpperCase()) && !out.some((o) => same(o.name, name)))
      out.push({ name, box })
  }
  return out
}

const contains = (box: HmiPreviewBounds, x: number, y: number): boolean =>
  x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height

/** The innermost element under a point, optionally among those `accept` takes; null over none. */
export function elementAt(
  elements: readonly CanvasElement[],
  x: number,
  y: number,
  accept: (name: string) => boolean = () => true,
): string | null {
  let best: CanvasElement | null = null
  for (const e of elements) {
    if (!contains(e.box, x, y) || !accept(e.name)) continue
    if (!best || e.box.width * e.box.height <= best.box.width * best.box.height) best = e
  }
  return best?.name ?? null
}

/** Where a drop at a point lands: a container (null: the screen) and the sibling it goes before (null: last). */
export interface DropTarget {
  parent: string | null
  before: string | null
}

/** Whether a container lays its children out side by side; the screen lays its containers out top to bottom. */
function isRow(model: DesignerModel, catalog: HmiWidgetCatalog, parent: string | null): boolean {
  const type = parent === null ? undefined : model.elements.find((e) => same(e.name, parent))?.type
  return type !== undefined && isSideBySide(catalog, type)
}

/** Where a drop shows: the container it goes into (null: the screen) and a bar where it is inserted, if any. */
export interface DropIndicator {
  box: HmiPreviewBounds | null
  line: { x: number; y: number; width: number; height: number } | null
}

/**
 * The marks of a drop target: its container, and a bar across the gap before the sibling it goes before, or after the
 * last sibling; none in an empty container.
 */
export function dropIndicator(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  elements: readonly CanvasElement[],
  target: DropTarget,
  moving: string | null = null,
): DropIndicator {
  const boxes = new Map(elements.map((e) => [e.name.toUpperCase(), e.box]))
  const box = target.parent === null ? null : (boxes.get(target.parent.toUpperCase()) ?? null)
  const row = isRow(model, catalog, target.parent)
  const siblings = model.elements
    .filter(
      (e) =>
        (target.parent === null ? e.parent === null : e.parent !== null && same(e.parent, target.parent)) &&
        (moving === null || !same(e.name, moving)),
    )
    .flatMap((e) => {
      const b = boxes.get(e.name.toUpperCase())
      return b ? [b] : []
    })
  const before = target.before === null ? undefined : boxes.get(target.before.toUpperCase())
  const last = siblings.at(-1)
  const BAR = 3
  const line = before
    ? row
      ? { x: before.x - BAR - 1, y: before.y, width: BAR, height: before.height }
      : { x: before.x, y: before.y - BAR - 1, width: before.width, height: BAR }
    : last
      ? row
        ? { x: last.x + last.width + 1, y: last.y, width: BAR, height: last.height }
        : { x: last.x, y: last.y + last.height + 1, width: last.width, height: BAR }
      : null
  return { box, line }
}

/** Width of the edge bands of a container, in CSS pixels on screen. */
export const EDGE_BAND_PX = 12

/**
 * A drop in an edge band of a container goes into the container's parent, before it (leading band) or after it
 * (trailing band), along the parent's direction; null when the point is in no band. A diagram's children have none.
 */
function edgeBandTarget(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  container: string,
  box: HmiPreviewBounds,
  x: number,
  y: number,
  band: number,
  moving: string | null,
): DropTarget | null {
  const element = model.elements.find((e) => same(e.name, container))
  if (!element || band <= 0) return null
  const parent = element.parent !== null && element.parent !== '' ? element.parent : null
  const parentType = parent === null ? undefined : model.elements.find((e) => same(e.name, parent))?.type
  if (parentType !== undefined && widgetIsA(catalog, parentType, 'HmiDiagram')) return null
  const row = isRow(model, catalog, parent)
  const [at, start, size] = row ? [x, box.x, box.width] : [y, box.y, box.height]
  const width = Math.min(band, size / 4)
  const leading = at < start + width
  const trailing = at >= start + size - width
  if (!leading && !trailing) return null
  if (leading) return { parent, before: element.name }
  const siblings = model.elements.filter(
    (e) =>
      (parent === null ? e.parent === null || e.parent === '' : e.parent !== null && same(e.parent, parent)) &&
      (moving === null || !same(e.name, moving)),
  )
  const index = siblings.findIndex((e) => same(e.name, element.name))
  return { parent, before: siblings[index + 1]?.name ?? null }
}

/**
 * The drop target under a point: the innermost container there, and among its children the first one whose middle
 * lies after the point along the container's direction. Within `band` logical units of the container's edges along
 * its parent's direction, the drop goes into the parent instead, beside the container (`edgeBandTarget`).
 */
export function dropTarget(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  elements: readonly CanvasElement[],
  x: number,
  y: number,
  moving: string | null = null,
  band = 0,
): DropTarget {
  const typeOf = (name: string): string => model.elements.find((e) => same(e.name, name))?.type ?? ''
  const excluded =
    moving === null ? new Set<string>() : new Set([moving, ...descendants(model, moving).map((e) => e.name)].map(upper))
  const parent = elementAt(
    elements,
    x,
    y,
    (name) => isContainerType(catalog, typeOf(name)) && !excluded.has(upper(name)),
  )
  const boxes = new Map(elements.map((e) => [e.name.toUpperCase(), e.box]))
  const parentBox = parent === null ? undefined : boxes.get(parent.toUpperCase())
  const beside = parent && parentBox ? edgeBandTarget(model, catalog, parent, parentBox, x, y, band, moving) : null
  if (beside) return beside
  const children = model.elements.filter(
    (e) =>
      (parent === null ? e.parent === null : e.parent !== null && same(e.parent, parent)) &&
      (moving === null || !same(e.name, moving)),
  )
  const row = isRow(model, catalog, parent)
  for (const child of children) {
    const box = boxes.get(child.name.toUpperCase())
    if (!box) continue
    const middle = row ? box.x + box.width / 2 : box.y + box.height / 2
    if ((row ? x : y) < middle) return { parent, before: child.name }
  }
  return { parent, before: null }
}
