import { GraphicalEditor } from '@root/frontend/components/_features/[workspace]/editor/graphical'
import { registerScopedQueryApi, type ScopedCompletionItem } from '@root/frontend/services/st-lsp/scoped-query'
import type { OpenPLCStore } from '@root/frontend/store'
import { cancelFlowWriteBacks } from '@root/frontend/store/slices/shared/flow-writeback'
import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PLCVariable, RungLadderState } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { type LadderLabelSource, pouLabelSource } from '@root/middleware/shared/utils/ladder-layout'
import { applyRungLayout, layoutRung } from '@root/middleware/shared/utils/ladder-layout/layout'
import type { RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'
import type { WirePoint } from '@root/middleware/shared/utils/ladder-layout/wires'
import { act, cleanup, render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

/** One LD program of a test store: its variables and its rungs before the layout. */
export interface LadderPou {
  name: string
  variables?: readonly PLCVariable[]
  rungs: readonly RungLadderState[]
}

interface ResizeEntry {
  target: Element
  contentRect: {
    x: number
    y: number
    top: number
    left: number
    right: number
    bottom: number
    width: number
    height: number
  }
  borderBoxSize: { inlineSize: number; blockSize: number }[]
  contentBoxSize: { inlineSize: number; blockSize: number }[]
  devicePixelContentBoxSize: { inlineSize: number; blockSize: number }[]
}

type ResizeCallback = (entries: ResizeEntry[], observer: MeasuringResizeObserver) => void

let box = { width: 40, height: 40 }
const liveObservers = new Set<MeasuringResizeObserver>()

/** The entry a browser reports for an element of the current test box size. */
function entryFor(target: Element): ResizeEntry {
  const size = { inlineSize: box.width, blockSize: box.height }
  return {
    target,
    contentRect: { x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, ...box },
    borderBoxSize: [size],
    contentBoxSize: [size],
    devicePixelContentBoxSize: [size],
  }
}

/** A ResizeObserver that reports each observed element once, a microtask later, as a browser does after layout. */
class MeasuringResizeObserver {
  private readonly callback: ResizeCallback
  private readonly targets = new Set<Element>()

  constructor(callback: ResizeCallback) {
    this.callback = callback
    liveObservers.add(this)
  }

  observe(target: Element): void {
    this.targets.add(target)
    queueMicrotask(() => this.report([target]))
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
    liveObservers.delete(this)
  }

  /** Reports every element still observed. */
  reportAll(): void {
    this.report([...this.targets])
  }

  private report(targets: Element[]): void {
    const live = targets.filter((target) => this.targets.has(target))
    if (live.length > 0) this.callback(live.map(entryFor), this)
  }
}

/** Minimal stand-in for the DOMMatrixReadOnly xyflow reads when it measures nodes; jsdom has none. */
class DOMMatrixReadOnlyStub {
  readonly m22 = 1
}

/** No-op stand-in for the `Element.scrollTo` the ladder editor calls; jsdom has none. */
function scrollToStub(): void {}

type Restore = () => void

/** Defines `key` on `target` for one test and returns what puts the previous definition back. */
function override(target: object, key: string, descriptor: PropertyDescriptor): Restore {
  const previous = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, ...descriptor })
  return () => {
    if (previous) Object.defineProperty(target, key, previous)
    else Reflect.deleteProperty(target, key)
  }
}

let restores: Restore[] = []

/** Resolves after the next animation frame, once the node measurements xyflow queued have run. */
const nextFrame = () =>
  typeof requestAnimationFrame === 'function'
    ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    : Promise.resolve()

/**
 * Gives jsdom the layout answers xyflow needs to measure nodes and draw edges (element sizes, a ResizeObserver that
 * reports, DOMMatrixReadOnly, scrollTo) for each test of the calling file, and puts everything back after it.
 */
export function installLadderScreen(): void {
  beforeEach(() => {
    box = { width: 40, height: 40 }
    restores = [
      override(HTMLElement.prototype, 'offsetWidth', { get: () => box.width }),
      override(HTMLElement.prototype, 'offsetHeight', { get: () => box.height }),
      override(globalThis, 'ResizeObserver', { writable: true, value: MeasuringResizeObserver }),
      override(window, 'DOMMatrixReadOnly', { writable: true, value: DOMMatrixReadOnlyStub }),
      override(Element.prototype, 'scrollTo', { writable: true, value: scrollToStub }),
    ]
  })

  afterEach(async () => {
    cleanup()
    cancelFlowWriteBacks()
    registerScopedQueryApi(null)
    await nextFrame()
    liveObservers.clear()
    for (const restore of restores.reverse()) restore()
    restores = []
  })
}

/** Lets queued measurements, effects and store updates run. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 5; round++) await Promise.resolve()
  })
}

/** Gives every observed element a new size and reports it, as a window or panel resize does. */
export async function resizeEverything(width: number, height: number): Promise<void> {
  box = { width, height }
  await act(async () => {
    for (const observer of liveObservers) observer.reportAll()
    window.dispatchEvent(new Event('resize'))
    await Promise.resolve()
  })
  await settle()
}

/** The variables a POU's location labels are read from, as the store holds them. */
export function labelSourceOf(store: OpenPLCStore, pouName: string): LadderLabelSource {
  return pouLabelSource(store.getState().project.data, pouName)
}

/**
 * A fresh store holding each program with its variables and its rungs as the editor stores them: laid out by the
 * engine with the POU's label source. The last program is the open editor.
 * @throws {Error} When a program cannot be created.
 */
export function ladderStore(pous: readonly LadderPou[], globals: readonly PLCVariable[] = []): OpenPLCStore {
  const store = createTestStore()
  if (globals.length > 0) store.getState().projectActions.setGlobalVariables({ variables: [...globals] })
  for (const pou of pous) {
    const created = store.getState().pouActions.create({ type: 'program', name: pou.name, language: 'ld' })
    if (!created.ok) throw new Error(`could not create ${pou.name}: ${created.message ?? ''}`)
    store.getState().projectActions.setPouVariables({ pouName: pou.name, variables: [...(pou.variables ?? [])] })
    const src = labelSourceOf(store, pou.name)
    const rungs = pou.rungs.map((rung) => applyRungLayout(rung, layoutRung(rung, src)))
    store.getState().ladderFlowActions.setRungs({ editorName: pou.name, rungs })
    store.getState().ladderFlowActions.setFlowUpdated({ editorName: pou.name, updated: false })
  }
  return store
}

/** The rungs of a POU as the store holds them. */
export function storedRungs(store: OpenPLCStore, pouName: string): RungLadderState[] {
  return store.getState().ladderFlows.find((flow) => flow.name === pouName)?.rungs ?? []
}

/** The engine layout of a stored rung with the POU's current label source: what the screen must draw. */
export function storedLayout(store: OpenPLCStore, pouName: string, rungIndex: number): RungLayout {
  const rung = storedRungs(store, pouName)[rungIndex]
  if (rung === undefined) throw new Error(`${pouName} has no rung ${rungIndex}`)
  return layoutRung(rung, labelSourceOf(store, pouName))
}

/** Renders `ui` with the store and platform ports (the editor's by default), then lets measurements and effects settle. */
export async function renderWithStore(
  store: OpenPLCStore,
  ui: ReactElement,
  ports: PlatformPorts = createTestPorts({ capabilities: EDITOR_CAPABILITIES }),
): Promise<RenderResult> {
  const view = render(ui, { wrapper: createStoreWrapper(store, ports) })
  await settle()
  return view
}

/** Opens the LD editor of `pouName` as the workspace does for its tab. */
export function renderLadder(store: OpenPLCStore, pouName: string): Promise<RenderResult> {
  return renderWithStore(store, <GraphicalEditor name={pouName} language='ld' isActive />)
}

/** Answers the editor's scoped type queries from the POU variables in the store, as the ST language service does. */
export function answerScopeQueriesFrom(store: OpenPLCStore): void {
  registerScopedQueryApi({
    completeInScope: (pouName, prefix) => {
      if (prefix.includes('.')) return Promise.resolve([])
      const pou = store.getState().project.data.pous.find((candidate) => candidate.name === pouName)
      const items: ScopedCompletionItem[] = (pou?.interface?.variables ?? []).map((variable) => ({
        label: variable.name,
        insertText: variable.name,
        type: variable.type.value,
        kind: 6,
      }))
      return Promise.resolve(items)
    },
  })
}

/** Sets debug values and forced variables for the open program, as a debug session polling the PLC does. */
export function debugSession(
  store: OpenPLCStore,
  pouName: string,
  values: Readonly<Record<string, string>>,
  forced: Readonly<Record<string, boolean>> = {},
): void {
  const key = (name: string) => `${pouName}:${name}`
  const boolValues = new Map<string, string>()
  const nonBoolValues = new Map<string, string>()
  for (const [name, value] of Object.entries(values)) {
    if (value === 'TRUE' || value === 'FALSE') boolValues.set(key(name), value)
    else nonBoolValues.set(key(name), value)
  }
  act(() => {
    const actions = store.getState().workspaceActions
    actions.setDebuggerVisible(true)
    actions.setDebugValues({ boolValues, nonBoolValues })
    actions.setDebugForcedVariables(new Map(Object.entries(forced).map(([name, high]) => [key(name), high])))
  })
}

/** The element with `data-testid` `id` under `root`, or null. */
export function queryTestId(root: ParentNode, id: string): HTMLElement | SVGElement | null {
  const found = root.querySelector(`[data-testid="${id.replace(/["\\]/g, '\\$&')}"]`)
  return found instanceof HTMLElement || found instanceof SVGElement ? found : null
}

/**
 * The element with `data-testid` `id` under `root`.
 * @throws {Error} When there is none.
 */
export function getTestId(root: ParentNode, id: string): HTMLElement | SVGElement {
  const found = queryTestId(root, id)
  if (found === null) throw new Error(`no element with data-testid "${id}"`)
  return found
}

/** The xyflow wrapper of node `nodeId` under `root`. */
export function nodeElement(root: ParentNode, nodeId: string): HTMLElement | SVGElement {
  return getTestId(root, `rf__node-${nodeId}`)
}

/**
 * The visible path xyflow draws for edge `edgeId` under `root`: its `ld-wire` path, else its edge path.
 * @throws {Error} When the edge is not drawn.
 */
export function edgePath(root: ParentNode, edgeId: string): SVGElement {
  const edge = root.querySelector(`.react-flow__edge[data-id="${edgeId.replace(/["\\]/g, '\\$&')}"]`)
  if (edge === null) throw new Error(`edge ${edgeId} is not drawn`)
  const path = queryTestId(edge, `ld-wire-${edgeId}`) ?? edge.querySelector('.react-flow__edge-path')
  if (!(path instanceof SVGElement)) throw new Error(`edge ${edgeId} has no visible path`)
  return path
}

/** `#rrggbb` for a hex or `rgb()` colour, lower case; anything else trimmed and lower case. */
export function normaliseColour(value: string): string {
  const text = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(text)
  if (rgb)
    return `#${rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, '0'))
      .join('')}`
  return text
}

/** `var(--name, fallback)` resolved against the custom properties set inline on `el` or its ancestors. */
function resolveVar(el: Element, value: string): string {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim())
  if (!match) return value
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      const custom = node.style.getPropertyValue(match[1])
      if (custom) return resolveVar(node, custom)
    }
  }
  return match[2] ?? ''
}

/** The value of a presentation attribute or inline style property set on `el` itself, or ''. */
function ownValue(el: Element, property: string): string {
  const attribute = el.getAttribute(property) ?? ''
  const style = el instanceof HTMLElement || el instanceof SVGElement ? el.style.getPropertyValue(property) : ''
  const value = style || attribute
  return value ? resolveVar(el, value) : ''
}

const INHERITED: ReadonlySet<string> = new Set(['stroke', 'fill', 'color', 'font-family', 'font-size', 'font-weight'])

/**
 * The colour or font value `el` is drawn with when it is set inline (presentation attribute or style), inherited from
 * an ancestor for inherited properties, or undefined; jsdom applies no stylesheet, so only inline values are seen.
 */
export function drawnValue(el: Element, property: string): string | undefined {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const value = ownValue(node, property)
    if (value) return value
    if (!INHERITED.has(property)) return undefined
  }
  return undefined
}

/** The colour `el` is drawn with for `property`, normalised, or undefined. */
export function drawnColour(el: Element, property: 'stroke' | 'fill' | 'color'): string | undefined {
  const value = drawnValue(el, property)
  return value === undefined ? undefined : normaliseColour(value)
}

/** The colour of a text element: its SVG fill, else its CSS colour. */
export function textColour(el: Element): string | undefined {
  return el instanceof SVGElement ? (drawnColour(el, 'fill') ?? drawnColour(el, 'color')) : drawnColour(el, 'color')
}

const SHAPES = 'rect, path, line, polyline, polygon, circle, ellipse'
const BORDER_COLOURS = [
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
]

/** Every outline colour drawn inside `root`: SVG shape strokes and inline border colours, `none` excluded. */
export function outlineColours(root: Element): string[] {
  const colours: string[] = []
  for (const shape of Array.from(root.querySelectorAll(SHAPES))) {
    const stroke = drawnColour(shape, 'stroke')
    if (stroke !== undefined && stroke !== 'none' && stroke !== 'transparent') colours.push(stroke)
  }
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const property of BORDER_COLOURS) {
      const value = ownValue(el, property)
      if (value) colours.push(normaliseColour(value))
    }
  }
  return colours
}

/** The font family, size in px and weight `el` is drawn with, from inline values on it or its ancestors. */
export function drawnFont(el: Element): { family?: string; sizePx?: number; weight?: number } {
  const family = drawnValue(el, 'font-family')
  const size = drawnValue(el, 'font-size')
  const weight = drawnValue(el, 'font-weight')
  return {
    family: family === undefined ? undefined : fontFamilyKey(family),
    sizePx: size === undefined ? undefined : Number.parseFloat(size),
    weight: weight === undefined ? undefined : weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight),
  }
}

/** A font-family list without quotes or spaces, for comparing two spellings of the same list. */
export function fontFamilyKey(family: string): string {
  return family.replace(/["'\s]/g, '').toLowerCase()
}

/** The points of an SVG `points` list or path `d` (M, L, H and V, absolute or relative), repeated points dropped. */
export function drawnPoints(el: Element): WirePoint[] {
  const points: WirePoint[] = []
  const push = (point: WirePoint) => {
    const last = points[points.length - 1]
    if (last === undefined || Math.abs(last.x - point.x) > 1e-6 || Math.abs(last.y - point.y) > 1e-6) points.push(point)
  }
  const list = el.getAttribute('points')
  if (list !== null) {
    const numbers = list
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    for (let index = 0; index + 1 < numbers.length; index += 2) push({ x: numbers[index], y: numbers[index + 1] })
    return points
  }
  const tokens = (el.getAttribute('d') ?? '').match(/[MLHVZmlhvz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  let command = ''
  let at: WirePoint = { x: 0, y: 0 }
  let index = 0
  const next = (): number => Number(tokens[index++])
  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      index++
      if (command === 'Z' || command === 'z') continue
    }
    switch (command) {
      case 'M':
      case 'L':
        at = { x: next(), y: next() }
        if (command === 'M') command = 'L'
        break
      case 'm':
      case 'l':
        at = { x: at.x + next(), y: at.y + next() }
        if (command === 'm') command = 'l'
        break
      case 'H':
        at = { x: next(), y: at.y }
        break
      case 'h':
        at = { x: at.x + next(), y: at.y }
        break
      case 'V':
        at = { x: at.x, y: next() }
        break
      case 'v':
        at = { x: at.x, y: at.y + next() }
        break
      default:
        throw new Error(`unsupported path command "${command}" in ${el.getAttribute('d') ?? ''}`)
    }
    push(at)
  }
  return points
}

/** Points rounded to 1/1000 px, so drawn and expected routes compare exactly. */
export function rounded(points: readonly WirePoint[]): WirePoint[] {
  const round = (value: number) => Math.round(value * 1000) / 1000 + 0
  return points.map((point) => ({ x: round(point.x), y: round(point.y) }))
}
