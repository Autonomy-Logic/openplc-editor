/**
 * What the designer's canvas works out from the widget catalogue and the preview's element bounds: which elements
 * contain others, which element is under the pointer, where a drop lands, and whether an edit can apply live.
 */
import type { HmiPreviewBounds, HmiPreviewElementId, HmiWidgetCatalog } from '../../../ports/hmi-preview-types'
import { descendants } from './designer-edits'
import type { DesignerModel } from './designer-model'
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

/** Elements that hold others: stacks and diagrams. */
export const isContainerType = (catalog: HmiWidgetCatalog, type: string): boolean =>
  widgetIsA(catalog, type, 'HmiStack') || widgetIsA(catalog, type, 'HmiDiagram')

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

/**
 * The drop target under a point: the innermost container there, and among its children the first one whose middle
 * lies after the point along the container's direction.
 */
export function dropTarget(
  model: DesignerModel,
  catalog: HmiWidgetCatalog,
  elements: readonly CanvasElement[],
  x: number,
  y: number,
  moving: string | null = null,
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
  const children = model.elements.filter(
    (e) =>
      (parent === null ? e.parent === null : e.parent !== null && same(e.parent, parent)) &&
      (moving === null || !same(e.name, moving)),
  )
  const parentBox = parent === null ? null : boxes.get(parent.toUpperCase())
  const direction =
    parent === null
      ? null
      : model.elements.find((e) => same(e.name, parent))?.props.find((p) => same(p.name, 'Direction'))?.value
  const row =
    direction !== undefined && direction !== null
      ? /row/i.test(direction)
      : parentBox
        ? parentBox.width >= parentBox.height
        : false
  for (const child of children) {
    const box = boxes.get(child.name.toUpperCase())
    if (!box) continue
    const middle = row ? box.x + box.width / 2 : box.y + box.height / 2
    if ((row ? x : y) < middle) return { parent, before: child.name }
  }
  return { parent, before: null }
}
