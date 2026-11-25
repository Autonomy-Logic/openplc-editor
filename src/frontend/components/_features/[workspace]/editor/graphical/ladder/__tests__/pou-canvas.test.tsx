/**
 * The LD POU canvas (AC06, BDD-21, BDD-22 store part): one horizontal scroll for the POU, one right rail shared by
 * every rung that follows the editor's width, trailing outputs right-justified on screen, and nothing of it saved.
 */
import {
  drawnAt,
  installEditorWidth,
  pouCanvas,
  scrollsSideways,
  setEditorWidth,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/pou-canvas'
import {
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { OpenPLCStore } from '@root/frontend/store'
import { act, fireEvent } from '@testing-library/react'

import {
  edgePath,
  drawnPoints,
  installLadderScreen,
  ladderStore,
  queryTestId,
  renderLadder,
  settle,
  storedLayout,
  storedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()
installEditorWidth()

const POU = 'main'

const contact = (id: string, name = id): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name = id): SeriesElement => ({ kind: 'coil', id, name })

/** A name of exactly `length` characters starting with `prefix`. */
const nameOf = (prefix: string, length: number): string => `${prefix}${'_'.repeat(length)}`.slice(0, length)

/** BDD-21's POU: a widest rung of 900 px, a trailing coil, and a block at the end of its rung. */
const RUNGS = [
  seriesRung('rung_wide', [
    contact('W1', nameOf('Line_Start_Permissive', 55)),
    contact('W2', nameOf('Conveyor_Infeed_Ready', 55)),
    coil('WM', 'Motor'),
  ]),
  seriesRung('rung_coil', [contact('S', 'Start'), coil('M', 'Motor')]),
  seriesRung('rung_block', [
    contact('S2', 'Start'),
    { kind: 'block', id: 'T', template: 'TON', instance: 'Timer1', pins: { PT: 'T#1s', ET: 'Elapsed' } },
  ]),
]

/** A store holding the POU as a project saved by this editor and not marked modified. */
function savedStore(): OpenPLCStore {
  const store = ladderStore([{ name: POU, rungs: RUNGS }])
  act(() => {
    store.getState().fileActions.setAllToSaved()
    store.getState().workspaceActions.setEditingState('saved')
  })
  return store
}

/** Everything a save writes or reads for the POU: its flow, its POU body, its file state and the editing state. */
function savedState(store: OpenPLCStore) {
  const state = store.getState()
  const flow = state.ladderFlows.find((candidate) => candidate.name === POU)
  const pou = state.project.data.pous.find((candidate) => candidate.name === POU)
  return structuredClone({
    updated: flow?.updated,
    rungs: flow?.rungs ?? [],
    body: pou?.body ?? null,
    file: state.files[POU] ?? null,
    editingState: state.workspace.editingState,
  })
}

/** The id of a stored rung's right rail. */
function rightRailOf(store: OpenPLCStore, rungIndex: number): string {
  const rail = storedRungs(store, POU)[rungIndex]?.nodes.find(
    (node) => node.type === 'powerRail' && node.data.variant === 'right',
  )
  if (rail === undefined) throw new Error(`rung ${rungIndex} has no right rail`)
  return rail.id
}

/** Where each rung's right rail is drawn. */
function drawnRails(store: OpenPLCStore, root: ParentNode): number[] {
  return RUNGS.map((_rung, index) => drawnAt(root, rightRailOf(store, index)).x)
}

async function open(): Promise<{ store: OpenPLCStore; container: HTMLElement }> {
  const store = savedStore()
  const { container } = await renderLadder(store, POU)
  return { store, container }
}

describe('one canvas per POU', () => {
  it('scrolls the whole POU sideways in one container, ld-pou-canvas, that holds every rung body', async () => {
    const { container } = await open()
    const canvases = container.querySelectorAll('[data-testid="ld-pou-canvas"]')
    const canvas = pouCanvas(container)
    const bodies = Array.from(container.querySelectorAll('[aria-label="Rung body"]'))
    expect({
      canvases: canvases.length,
      scrolls: scrollsSideways(canvas),
      bodies: bodies.length,
      outside: bodies.filter((body) => !canvas.contains(body)).length,
    }).toEqual({ canvases: 1, scrolls: true, bodies: RUNGS.length, outside: 0 })
  })

  it('lets no rung body, nor anything else inside the canvas, scroll sideways on its own', async () => {
    const { container } = await open()
    const canvas = pouCanvas(container)
    const scrolling = Array.from(canvas.querySelectorAll('*'))
      .filter(scrollsSideways)
      .map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.className.toString())
    expect(scrolling).toEqual([])
  })

  it('keeps aria-label "Rung body" on the element that holds each rung\'s React Flow', async () => {
    const { container } = await open()
    const bodies = Array.from(container.querySelectorAll('[aria-label="Rung body"]'))
    expect(bodies.map((body) => body.querySelectorAll('.react-flow').length)).toEqual(RUNGS.map(() => 1))
  })

  it('marks the right rail of every rung with ld-right-rail-<rungId>', async () => {
    const { container } = await open()
    expect(RUNGS.map((rung) => queryTestId(container, `ld-right-rail-${rung.id}`) !== null)).toEqual(
      RUNGS.map(() => true),
    )
  })
})

describe('BDD-21: one right rail for every rung, following the editor width', () => {
  it("draws every rung's right rail at one x, right after the widest rung, while the editor is narrow", async () => {
    const { store, container } = await open()
    const widest = Math.max(...RUNGS.map((_rung, index) => storedLayout(store, POU, index).size.width))
    expect(widest).toBeCloseTo(900, 6)
    for (const x of drawnRails(store, container)) expect(x).toBeCloseTo(widest, 6)
  })

  it('1,200 px wide, then resized to 1,000 px: one x for every rail, moving 200 px left with the edge', async () => {
    const { store, container } = await open()
    await setEditorWidth(1200)
    const wide = drawnRails(store, container)
    await setEditorWidth(1000)
    const narrower = drawnRails(store, container)
    expect(wide[0]).toBeGreaterThan(900)
    for (const x of wide) expect(x).toBeCloseTo(wide[0], 6)
    for (const x of narrower) expect(x).toBeCloseTo(wide[0] - 200, 6)
  })

  it('700 px wide: every rail right after the widest rung, at one x', async () => {
    const { store, container } = await open()
    await setEditorWidth(1200)
    await setEditorWidth(700)
    for (const x of drawnRails(store, container)) expect(x).toBeCloseTo(900, 6)
  })
})

describe('AC06: trailing outputs sit against the rail, a block at the end stays in flow', () => {
  it("draws the trailing coil Motor shifted with its rung's rail and Start where the layout puts it", async () => {
    const { store, container } = await open()
    await setEditorWidth(1200)
    const layout = storedLayout(store, POU, 1)
    const railShift = drawnAt(container, rightRailOf(store, 1)).x - layout.size.width
    const canonical = (id: string) => layout.nodes.get(id)?.position.x ?? NaN
    expect(railShift).toBeGreaterThan(0)
    expect({
      start: drawnAt(container, 'S').x - canonical('S'),
      motor: drawnAt(container, 'M').x - canonical('M'),
    }).toEqual({ start: 0, motor: railShift })
  })

  it('draws the TON at the end of its rung where the layout puts it, right after Start', async () => {
    const { store, container } = await open()
    await setEditorWidth(1200)
    const layout = storedLayout(store, POU, 2)
    expect(drawnAt(container, 'T').x).toBeCloseTo(layout.nodes.get('T')?.position.x ?? NaN, 6)
    expect(drawnAt(container, rightRailOf(store, 2)).x).toBeGreaterThan(layout.size.width)
  })

  it('stretches the wire from Start to Motor with the rail, so the filler wire still joins them', async () => {
    const { store, container } = await open()
    const wire = storedRungs(store, POU)[1].edges.find((edge) => edge.source === 'S' && edge.target === 'M')
    if (wire === undefined) throw new Error('no wire from Start to Motor')
    await setEditorWidth(1000)
    const before = drawnPoints(edgePath(container, wire.id))
    await setEditorWidth(1200)
    const after = drawnPoints(edgePath(container, wire.id))
    expect({
      startX: after[0].x - before[0].x,
      endX: after[after.length - 1].x - before[before.length - 1].x,
    }).toEqual({ startX: 0, endX: 200 })
  })
})

describe('BDD-22 (store): rail position and right-justification are never saved', () => {
  it('resizing to 700 px, scrolling sideways and resizing back to 1,200 px leaves the project saved and unchanged', async () => {
    const store = savedStore()
    await setEditorWidth(1200)
    const before = savedState(store)
    const { container } = await renderLadder(store, POU)
    await setEditorWidth(700)
    fireEvent.scroll(pouCanvas(container), { target: { scrollLeft: 240 } })
    await settle()
    await setEditorWidth(1200)
    expect(savedState(store)).toEqual(before)
  })

  it('re-rendering the POU at each width leaves the project saved and unchanged', async () => {
    const store = savedStore()
    const before = savedState(store)
    for (const width of [1200, 1000, 700, 1200]) {
      const view = await renderLadder(store, POU)
      await setEditorWidth(width)
      expect(pouCanvas(view.container).querySelectorAll('[aria-label="Rung body"]').length).toBe(RUNGS.length)
      view.unmount()
      await settle()
    }
    expect(savedState(store)).toEqual(before)
  })
})
