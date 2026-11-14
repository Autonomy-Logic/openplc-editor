/**
 * Process diagrams in the designer: the design-mode records a frame carries (element ports, each diagram's frame and
 * each pipe's route), conversions between the canvas and a diagram's design units, snapping, and the pipe edits a
 * diagram needs (bends in `Path`, pipes between ports, the pipes that go with a deleted element).
 */
import type { HmiPreviewBounds, HmiPreviewElementId, HmiWidgetCatalog } from '../../../ports/hmi-preview-types'
import { widgetIsA } from './designer-canvas'
import type { DesignerElement, DesignerModel } from './designer-model'
import { stringLiteralValue } from './designer-model'

/** Port slot a diagram uses to record its frame; elements have ports 0 to 3 (`HMI_PORT`). */
const FRAME_SLOT = 7
/** Pipe route points are recorded as -(PIPE_POINT_BASE + id * ROUTE_SLOTS + index). */
const ROUTE_SLOTS = 32
const PIPE_POINT_BASE = 1000000
/** Bends a pipe's Path holds, as HmiPipe reads it. */
export const MAX_BENDS = 8
/** Snap step of a diagram that does not set Grid, as HmiDiagram declares it. */
export const DEFAULT_GRID = 10
/** Port names in `HMI_PORT` order. */
export const HMI_PORTS = ['Top', 'Right', 'Bottom', 'Left'] as const

export interface Point {
  x: number
  y: number
}

/** A connection port of an element, on the canvas. */
export interface CanvasPort extends Point {
  element: string
  /** `HMI_PORT` value. */
  port: number
}

/** How a diagram maps its design units to the canvas: canvas = origin + design * scale. */
export interface DiagramFrame {
  x: number
  y: number
  scale: number
}

/** What a design-mode frame records besides element boxes. */
export interface DesignRecords {
  ports: CanvasPort[]
  /** By upper-case diagram name. */
  frames: Map<string, DiagramFrame>
  /** Route points on the canvas, by upper-case pipe name. */
  routes: Map<string, Point[]>
}

const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** Reads the ports, diagram frames and pipe routes out of a screen's design-mode bounds. */
export function designRecords(
  bounds: readonly HmiPreviewBounds[],
  elementIds: readonly HmiPreviewElementId[],
  screen: string,
): DesignRecords {
  const names = new Map<number, string>()
  for (const e of elementIds) if (same(e.screen, screen)) names.set(e.id, e.element)
  const records: DesignRecords = { ports: [], frames: new Map(), routes: new Map() }
  const points = new Map<string, Array<{ index: number; point: Point }>>()
  for (const b of bounds) {
    if (b.id >= 0) continue
    if (b.id <= -PIPE_POINT_BASE) {
      const key = -b.id - PIPE_POINT_BASE
      const name = names.get(Math.floor(key / ROUTE_SLOTS))
      if (name === undefined) continue
      const list = points.get(name.toUpperCase()) ?? []
      list.push({ index: key % ROUTE_SLOTS, point: { x: b.x, y: b.y } })
      points.set(name.toUpperCase(), list)
      continue
    }
    const key = -b.id - 1
    const name = names.get(Math.floor(key / 8))
    if (name === undefined) continue
    const slot = key % 8
    if (slot === FRAME_SLOT) records.frames.set(name.toUpperCase(), { x: b.x, y: b.y, scale: b.width / 65536 })
    else if (slot < HMI_PORTS.length) records.ports.push({ element: name, port: slot, x: b.x, y: b.y })
  }
  for (const [name, list] of points)
    records.routes.set(
      name,
      [...list].sort((a, b) => a.index - b.index).map((p) => p.point),
    )
  return records
}

export const toDesign = (frame: DiagramFrame, p: Point): Point => ({
  x: (p.x - frame.x) / frame.scale,
  y: (p.y - frame.y) / frame.scale,
})

export const toCanvas = (frame: DiagramFrame, p: Point): Point => ({
  x: frame.x + p.x * frame.scale,
  y: frame.y + p.y * frame.scale,
})

/** The nearest multiple of `grid`; the value rounded when grid is not positive. */
export const snap = (value: number, grid: number): number =>
  grid > 0 ? Math.round(value / grid) * grid : Math.round(value)

/** The diagram an element is placed in, or null when its parent is not a diagram. */
export function diagramOf(model: DesignerModel, catalog: HmiWidgetCatalog, element: string): DesignerElement | null {
  const parent = model.elements.find((e) => same(e.name, element))?.parent
  const container = parent ? model.elements.find((e) => same(e.name, parent)) : undefined
  return container && widgetIsA(catalog, container.type, 'HmiDiagram') ? container : null
}

const prop = (element: DesignerElement, name: string): string | undefined =>
  element.props.find((p) => same(p.name, name))?.value

/** A numeric property as written, else the widget's default, else `fallback`. */
export function numberProp(
  catalog: HmiWidgetCatalog,
  element: DesignerElement,
  name: string,
  fallback: number,
): number {
  const written = prop(element, name)
  const text =
    written ?? catalog.widgets.get(element.type.toUpperCase())?.properties.find((p) => same(p.name, name))?.defaultValue
  const value = text === undefined ? NaN : Number(text.trim())
  return Number.isFinite(value) ? value : fallback
}

/** The snap step of a diagram: its Grid as written or declared, else `DEFAULT_GRID`. */
export const gridOf = (catalog: HmiWidgetCatalog, diagram: DesignerElement): number =>
  numberProp(catalog, diagram, 'Grid', DEFAULT_GRID)

/** The bends in a Path value as HmiPipe reads them: 'x,y;x,y', parts that are not two numbers skipped. */
export function parsePath(text: string): Point[] {
  const points: Point[] = []
  for (const part of text.split(';')) {
    if (points.length >= MAX_BENDS) break
    const [x, y, ...rest] = part.split(',').map((v) => v.trim())
    if (rest.length > 0 || x === undefined || y === undefined || x === '' || y === '') continue
    const px = Number(x)
    const py = Number(y)
    if (Number.isFinite(px) && Number.isFinite(py)) points.push({ x: Math.round(px), y: Math.round(py) })
  }
  return points
}

export const formatPath = (points: readonly Point[]): string =>
  points
    .slice(0, MAX_BENDS)
    .map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)
    .join(';')

/** A pipe's bends, from its Path literal; none when Path is not a string literal. */
export function bendsOf(pipe: DesignerElement): Point[] {
  const written = prop(pipe, 'Path')
  const text = written === undefined ? '' : stringLiteralValue(written)
  return text === null ? [] : parsePath(text)
}

/** A route without repeated points or points in the middle of a straight run. */
function corners(route: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of route) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    const before = out[out.length - 2]
    if (before && last && (before.x - last.x) * (last.y - p.y) === (before.y - last.y) * (last.x - p.x)) out.pop()
    out.push(p)
  }
  return out
}

const manhattan = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/**
 * The bends with `at` added between the two points of the pipe it adds the least right-angle detour to, so a point on
 * the pipe goes where it lies. `route` runs from the source port to the target port in design units; only its ends
 * are used, and its corners when the pipe has no bends yet, which become bends so the pipe keeps its shape.
 */
export function insertBend(bends: readonly Point[], route: readonly Point[], at: Point): Point[] {
  const current = bends.length > 0 ? [...bends] : corners(route).slice(1, -1)
  if (route.length < 2) return [...current, at].slice(0, MAX_BENDS)
  const full = [route[0], ...current, route[route.length - 1]]
  let best = 0
  let bestDetour = Infinity
  for (let k = 0; k < full.length - 1; k++) {
    const detour = manhattan(full[k], at) + manhattan(at, full[k + 1]) - manhattan(full[k], full[k + 1])
    if (detour < bestDetour) {
      best = k
      bestDetour = detour
    }
  }
  const next = [...current]
  next.splice(best, 0, at)
  return next.slice(0, MAX_BENDS)
}

/** The ST properties of a new pipe from one port to another. */
export function pipeProps(from: CanvasPort, to: CanvasPort): Array<[string, string]> {
  return [
    ['Source', `'${from.element}'`],
    ['SourcePort', `HMI_PORT#${HMI_PORTS[from.port]}`],
    ['Target', `'${to.element}'`],
    ['TargetPort', `HMI_PORT#${HMI_PORTS[to.port]}`],
  ]
}

/** `names` and every pipe whose Source or Target names one of them, which goes when they do. */
export function withTheirPipes(model: DesignerModel, catalog: HmiWidgetCatalog, names: readonly string[]): string[] {
  const doomed = new Set(names.map((n) => n.toUpperCase()))
  const out = [...names]
  for (const e of model.elements) {
    if (doomed.has(e.name.toUpperCase()) || !widgetIsA(catalog, e.type, 'HmiPipe')) continue
    const ends = ['Source', 'Target'].map((p) => {
      const written = prop(e, p)
      return written === undefined ? null : stringLiteralValue(written)
    })
    if (ends.some((end) => end !== null && doomed.has(end.toUpperCase()))) out.push(e.name)
  }
  return out
}

/** The port nearest to a canvas point within `radius`, among those `accept` takes. */
export function portAt(
  ports: readonly CanvasPort[],
  p: Point,
  radius: number,
  accept: (port: CanvasPort) => boolean = () => true,
): CanvasPort | null {
  let best: CanvasPort | null = null
  let distance = radius
  for (const port of ports) {
    const d = Math.hypot(port.x - p.x, port.y - p.y)
    if (d <= distance && accept(port)) {
      best = port
      distance = d
    }
  }
  return best
}
