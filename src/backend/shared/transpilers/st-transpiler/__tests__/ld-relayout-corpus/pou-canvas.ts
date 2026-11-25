import { MIME_TYPES } from '@root/frontend/utils/graphical/drag-detection'
import { getShortcutModifier } from '@root/frontend/utils/graphical/placement-elements'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { DEFAULT_PLACEHOLDER_HEIGHT, DEFAULT_PLACEHOLDER_WIDTH } from '@root/middleware/shared/utils/ladder-layout'
import { act, fireEvent } from '@testing-library/react'

import { nodeElement, resizeEverything, settle } from './ladder-screen'

/** A point in px, in rung canvas (flow) coordinates unless a name says screen. */
export interface Point {
  x: number
  y: number
}

const CANVAS = '[data-testid="ld-pou-canvas"]'
const DEFAULT_WIDTH = 40

/**
 * The screen box every React Flow pane reports: wide enough that no pointer of a test comes near its edge, where
 * xyflow would pan the canvas during a drag. A flow point is drawn on screen at itself plus the box's corner.
 */
const FLOW_PANE = { left: -1000, top: -1000, width: 100000, height: 100000 }

/** The screen point where the rung canvas point `flow` is drawn. */
export function screenPoint(flow: Point): Point {
  return { x: flow.x + FLOW_PANE.left, y: flow.y + FLOW_PANE.top }
}

/** A DOMRect-shaped box. */
function box(left: number, top: number, width: number, height: number): DOMRect {
  const rect = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }
  return { ...rect, toJSON: () => rect }
}

let editorWidth = DEFAULT_WIDTH
let editorHeight = 400
let restores: (() => void)[] = []

/** True for the xyflow wrapper of a ladder placeholder node. */
function isPlaceholderNode(el: Element): boolean {
  return (
    el.classList.contains('react-flow__node-placeholder') ||
    el.classList.contains('react-flow__node-parallelPlaceholder')
  )
}

/** The getter `key` has on `HTMLElement.prototype` right now, or Element's. */
function currentGetter(key: string): ((this: HTMLElement) => unknown) | undefined {
  return (
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key) ??
    Object.getOwnPropertyDescriptor(Element.prototype, key)
  )?.get
}

/** A size getter that answers `size` for the elements `matches` picks and asks `previous` for every other one. */
function sizeGetter(
  matches: (el: HTMLElement) => number | undefined,
  previous: ((this: HTMLElement) => unknown) | undefined,
): PropertyDescriptor {
  return {
    get(this: HTMLElement): number {
      const size = matches(this)
      if (size !== undefined) return size
      const value: unknown = previous?.call(this)
      return typeof value === 'number' ? value : 0
    },
  }
}

/** A px size set inline, or undefined when there is none. */
function styledSize(value: string): number | undefined {
  const size = Number.parseFloat(value)
  return Number.isFinite(size) ? size : undefined
}

/** True for the POU canvas and for every element that holds it. */
function holdsCanvas(el: Element): boolean {
  return el.matches(CANVAS) || el.querySelector(CANVAS) !== null
}

/** Defines `key` on `HTMLElement.prototype` for one test and returns what puts the previous definition back. */
function override(key: string, descriptor: PropertyDescriptor): () => void {
  const target = HTMLElement.prototype
  const previous = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, ...descriptor })
  return () => {
    if (previous) Object.defineProperty(target, key, previous)
    else Reflect.deleteProperty(target, key)
  }
}

/**
 * Lets each test of the calling file set the LD editor's visible width: the POU canvas and the elements that hold it
 * report it through `clientWidth`, `offsetWidth` and `getBoundingClientRect`, on top of what `installLadderScreen`
 * reports. A React Flow pane reports the `FLOW_PANE` box, so a drag never pans it; a node measures the size it is given
 * inline, a placeholder its real 10 px box and a handle none, so wires do not change with the editor width. Call it
 * after `installLadderScreen()`.
 */
export function installEditorWidth(): void {
  beforeEach(() => {
    editorWidth = DEFAULT_WIDTH
    editorHeight = 400
    const getRect = Element.prototype.getBoundingClientRect
    const width = (el: HTMLElement): number | undefined => {
      if (isPlaceholderNode(el)) return DEFAULT_PLACEHOLDER_WIDTH
      if (el.classList.contains('react-flow__node')) return styledSize(el.style.width)
      if (el.classList.contains('react-flow__handle')) return 0
      return holdsCanvas(el) ? editorWidth : undefined
    }
    const height = (el: HTMLElement): number | undefined => {
      if (isPlaceholderNode(el)) return DEFAULT_PLACEHOLDER_HEIGHT
      if (el.classList.contains('react-flow__node')) return styledSize(el.style.height)
      if (el.classList.contains('react-flow__handle')) return 0
      return undefined
    }
    restores = [
      override('clientWidth', sizeGetter(width, currentGetter('clientWidth'))),
      override('offsetWidth', sizeGetter(width, currentGetter('offsetWidth'))),
      override('offsetHeight', sizeGetter(height, currentGetter('offsetHeight'))),
      override('getBoundingClientRect', {
        writable: true,
        value(this: HTMLElement): DOMRect {
          if (this.classList.contains('react-flow'))
            return box(FLOW_PANE.left, FLOW_PANE.top, FLOW_PANE.width, FLOW_PANE.height)
          if (holdsCanvas(this)) return box(0, 0, editorWidth, editorHeight)
          return getRect.call(this)
        },
      }),
    ]
  })

  afterEach(() => {
    for (const restore of restores.reverse()) restore()
    restores = []
  })
}

/**
 * Lets xyflow hand each rung its React Flow instance: it does so from a timer once the viewport is ready, and the
 * rung's hit-tests need the instance. Resolves on the next timer turn, after that timer.
 */
export async function flowsReady(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
  await settle()
}

/** Makes the LD editor `width` px wide, as a window or panel resize does, and lets the screen settle. */
export async function setEditorWidth(width: number, height = 400): Promise<void> {
  editorWidth = width
  editorHeight = height
  await resizeEverything(width, height)
}

/** The element that scrolls the POU canvas sideways, by its `data-testid`. */
export function pouCanvas(root: ParentNode): HTMLElement {
  const found = root.querySelector(CANVAS)
  if (!(found instanceof HTMLElement)) throw new Error('no element with data-testid "ld-pou-canvas"')
  return found
}

const SCROLL_CLASSES: ReadonlySet<string> = new Set([
  'overflow-auto',
  'overflow-scroll',
  'overflow-x-auto',
  'overflow-x-scroll',
])
const SCROLL_VALUES: ReadonlySet<string> = new Set(['auto', 'scroll'])

/**
 * True when `el` scrolls its content sideways: a Tailwind overflow class or an inline `overflow` / `overflow-x` of
 * auto or scroll; jsdom applies no stylesheet, so only these are seen.
 */
export function scrollsSideways(el: Element): boolean {
  if (Array.from(el.classList).some((name) => SCROLL_CLASSES.has(name))) return true
  if (!(el instanceof HTMLElement)) return false
  const { overflow, overflowX } = el.style
  const x = overflowX || overflow.split(/\s+/)[0] || ''
  return SCROLL_VALUES.has(x)
}

/** Where xyflow draws node `nodeId`: the translate of its wrapper, in rung canvas px. */
export function drawnAt(root: ParentNode, nodeId: string): Point {
  const el = nodeElement(root, nodeId)
  const match = /translate\(\s*(-?[\d.e+-]+)px\s*,\s*(-?[\d.e+-]+)px\s*\)/.exec(el.style.transform)
  if (match === null) throw new Error(`node ${nodeId} is drawn with no translate: "${el.style.transform}"`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/**
 * The placeholder drawn on the `side` of node `relatedId` and the centre of its drawn box, where a user points at it;
 * xyflow names a placeholder `placeholder_<related node id>_<uuid>`.
 * @throws {Error} When none is drawn for the node.
 */
export function drawnPlaceholder(
  root: ParentNode,
  relatedId: string,
  side: 'left' | 'right',
): { id: string; at: Point } {
  const prefix = `placeholder_${relatedId}_`
  const drawn = Array.from(root.querySelectorAll('.react-flow__node'))
    .filter(
      (el): el is HTMLElement => el instanceof HTMLElement && (el.getAttribute('data-id') ?? '').startsWith(prefix),
    )
    .map((el) => {
      const id = el.getAttribute('data-id') ?? ''
      const corner = drawnAt(root, id)
      return { id, at: { x: corner.x + el.offsetWidth / 2, y: corner.y + el.offsetHeight / 2 } }
    })
    .sort((a, b) => a.at.x - b.at.x)
  const found = side === 'left' ? drawn[0] : drawn[drawn.length - 1]
  if (found === undefined) throw new Error(`no placeholder is drawn next to ${relatedId}`)
  return found
}

/** Ids of the nodes xyflow draws as selected. */
export function drawnSelection(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('.react-flow__node.selected')).map((el) => el.getAttribute('data-id') ?? '')
}

/** xyflow starts a node drag only after the pointer moves this far, the editor's `nodeDragThreshold` plus a margin. */
const DRAG_START_PX = 30

/**
 * A mouse-shaped event of `type` at the screen point of flow point `at`, with the window as its view. The view is set
 * after construction: under Vitest the global `window` is not a jsdom Window, which the constructor would refuse, and
 * xyflow's drag handler listens on the view. Pointer and drag events are built this way too, since jsdom may lack them.
 */
function eventAt(type: string, at: Point): MouseEvent {
  const screen = screenPoint(at)
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: screen.x,
    clientY: screen.y,
  })
  Object.defineProperty(event, 'view', { value: window })
  return event
}

/** A node drag in progress, driven with mouse events as xyflow's drag handler reads them; points in flow px. */
export interface NodeDrag {
  /** Where the press was made. */
  readonly from: Point
  /** Moves the pointer to `to` and lets the screen settle. */
  moveTo(to: Point): Promise<void>
  /** Releases the pointer at `at` and lets the screen settle. */
  release(at: Point): Promise<void>
}

/**
 * Presses on node `nodeId` where it is drawn and moves past the drag threshold, so the drag starts; xyflow moves the
 * node only from the next move on.
 */
export async function startNodeDrag(root: ParentNode, nodeId: string): Promise<NodeDrag> {
  const at = drawnAt(root, nodeId)
  const from = { x: at.x + 4, y: at.y + 4 }
  const moveTo = async (to: Point) => {
    act(() => {
      fireEvent(window, eventAt('mousemove', to))
    })
    await settle()
  }
  const release = async (point: Point) => {
    act(() => {
      fireEvent(window, eventAt('mouseup', point))
    })
    await settle()
  }
  act(() => {
    fireEvent(nodeElement(root, nodeId), eventAt('mousedown', from))
  })
  await moveTo({ x: from.x, y: from.y + DRAG_START_PX })
  return { from, moveTo, release }
}

/** Drags node `nodeId` and drops it on the point `target` gives once the drag has drawn its placeholders. */
export async function dragNodeTo(root: ParentNode, nodeId: string, target: () => Point): Promise<void> {
  const drag = await startNodeDrag(root, nodeId)
  const to = target()
  await drag.moveTo(to)
  await drag.release(to)
}

/** What a library drag of a ladder element carries, as the editor's library sets it. */
function libraryTransfer(element: 'contact' | 'coil') {
  return {
    types: [MIME_TYPES.LADDER_BLOCKS],
    effectAllowed: 'move',
    dropEffect: 'none',
    getData: (format: string): string => (format === MIME_TYPES.LADDER_BLOCKS ? element : ''),
    setData: (): void => {},
  }
}

/** A drag event of `type` at flow point `at` carrying `transfer`. */
function dragAt(type: 'dragenter' | 'dragover' | 'drop', at: Point, transfer: ReturnType<typeof libraryTransfer>) {
  const event = eventAt(type, at)
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  return event
}

/**
 * Drags a ladder `element` from the library into the React Flow pane `pane`, and drops it on the point `target` gives
 * once the drag has drawn its placeholders.
 */
export async function dropFromLibrary(pane: Element, element: 'contact' | 'coil', target: () => Point): Promise<void> {
  const transfer = libraryTransfer(element)
  act(() => {
    fireEvent(pane, dragAt('dragenter', { x: 0, y: 0 }, transfer))
  })
  await settle()
  const to = target()
  act(() => {
    fireEvent(pane, dragAt('dragover', to, transfer))
  })
  await settle()
  act(() => {
    fireEvent(pane, dragAt('drop', to, transfer))
  })
  await settle()
}

/** Arms the ladder element `digit` of the placement shortcuts (1 contact, 2 coil, 3 block), as the keyboard does. */
export function armPlacement(digit: 1 | 2 | 3): void {
  const meta = getShortcutModifier(navigator.platform) === 'meta'
  act(() => {
    fireEvent.keyDown(document.body, { key: String(digit), code: `Digit${digit}`, altKey: !meta, metaKey: meta })
  })
}

/** Moves the pointer over `target` at flow point `point`, as hovering the canvas with an armed element does. */
export async function hoverAt(target: Element, point: Point): Promise<void> {
  act(() => {
    fireEvent(target, eventAt('pointermove', point))
  })
  await settle()
}

/** A left press on `target` at flow point `point`, as placing an armed element does. */
export async function pressAt(target: Element, point: Point): Promise<void> {
  act(() => {
    fireEvent(target, eventAt('pointerdown', point))
  })
  await settle()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `<type>:<variable name>` of node `nodeId`, the name empty when it has none. */
function elementLabel(rung: RungLadderState, nodeId: string): string {
  const node = rung.nodes.find((candidate) => candidate.id === nodeId)
  const variable: unknown = node?.data.variable
  const name = isRecord(variable) && typeof variable.name === 'string' ? variable.name : ''
  return `${node?.type ?? '?'}:${name}`
}

/**
 * The elements of a series rung from the left rail to the right rail, as `<type>:<variable name>`, following the wire
 * out of each element's output.
 * @throws {Error} When the wire does not reach the right rail.
 */
export function seriesOf(rung: RungLadderState): string[] {
  const left = rung.nodes.find((node) => node.type === 'powerRail' && node.data.variant === 'left')
  const labels: string[] = []
  let at = left?.id
  for (let step = 0; at !== undefined && step <= rung.nodes.length; step++) {
    const from = at
    const wire = rung.edges.find((edge) => edge.source === from)
    if (wire === undefined) break
    const next = rung.nodes.find((node) => node.id === wire.target)
    if (next?.type === 'powerRail') return labels
    labels.push(elementLabel(rung, wire.target))
    at = wire.target
  }
  throw new Error(`the wire of rung ${rung.id} does not reach the right rail: ${labels.join(', ')}`)
}

/**
 * What the store saves of a rung's nodes and edges: ids, kinds and geometry in node order, and the wires as a set
 * (sorted), without selection state.
 */
export function savedShape(rung: RungLadderState) {
  return {
    nodes: rung.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      width: node.width,
      height: node.height,
    })),
    edges: rung.edges
      .map((edge) => `${edge.source}.${edge.sourceHandle ?? ''} -> ${edge.target}.${edge.targetHandle ?? ''}`)
      .sort(),
  }
}
