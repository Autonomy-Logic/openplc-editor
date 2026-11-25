/**
 * Hit-tests next to right-justified outputs (AC11, R3): the placeholder search, the drop and the positions xyflow
 * reports while dragging compare in one space, so dragging or placing an element next to shifted outputs gives the
 * rung today's editor gives with no shift.
 */
import {
  armPlacement,
  dragNodeTo,
  drawnAt,
  drawnPlaceholder,
  drawnSelection,
  dropFromLibrary,
  flowsReady,
  hoverAt,
  installEditorWidth,
  type Point,
  pressAt,
  savedShape,
  seriesOf,
  startNodeDrag,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/pou-canvas'
import {
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { OpenPLCStore } from '@root/frontend/store'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { presentPou } from '@root/middleware/shared/utils/ladder-layout'

import {
  installLadderScreen,
  ladderStore,
  renderLadder,
  storedLayout,
  storedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()
installEditorWidth()

const POU = 'main'

const contact = (id: string, name = id): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name = id): SeriesElement => ({ kind: 'coil', id, name })

/** A rung far wider than the rung under test, so its outputs are drawn far to the right of where they are stored. */
const WIDE = seriesRung('rung_wide', [
  contact('W1', 'Line_Start_Permissive_From_Upstream_Conveyor_Section_A'),
  contact('W2', 'Conveyor_Infeed_Photoeye_Blocked_Longer_Than_Limit_X'),
  coil('WM', 'Wide_Motor'),
])

/** The rung under test: contacts Start and Stop, then the trailing coils Lamp and Motor. */
const TARGET = seriesRung('rung_target', [
  contact('S', 'Start'),
  contact('T', 'Stop'),
  coil('L', 'Lamp'),
  coil('M', 'Motor'),
])

/** The POU with the rung under test, and with the wide rung first when `shifted`; returns the rung index under test. */
async function open(
  shifted: boolean,
): Promise<{ store: OpenPLCStore; container: HTMLElement; index: number; unmount: () => void }> {
  const rungs = shifted ? [WIDE, TARGET] : [TARGET]
  const store = ladderStore([{ name: POU, rungs }])
  const { container, unmount } = await renderLadder(store, POU)
  await flowsReady()
  return { store, container, index: rungs.length - 1, unmount }
}

/** The shift the presentation gives node `nodeId` of the stored POU for the narrow test editor. */
function shiftOf(store: OpenPLCStore, rungCount: number, nodeId: string): number {
  const layouts = Array.from({ length: rungCount }, (_unused, index) => storedLayout(store, POU, index))
  return presentPou(layouts, 0).dxByNode.get(nodeId) ?? 0
}

/** The rung under test as the store holds it. */
function target(store: OpenPLCStore, index: number): RungLadderState {
  const rung = storedRungs(store, POU)[index]
  if (rung === undefined) throw new Error(`no rung ${index}`)
  return rung
}

/** Checks the precondition of every shifted case: Motor is drawn shifted by its presentation dx, which is not 0. */
function expectMotorShifted(store: OpenPLCStore, container: HTMLElement): number {
  const shift = shiftOf(store, 2, 'M')
  const stored = storedLayout(store, POU, 1).nodes.get('M')?.position.x ?? NaN
  expect({ shifted: shift > 0, drawn: drawnAt(container, 'M').x - stored }).toEqual({ shifted: true, drawn: shift })
  return shift
}

/** The React Flow pane of the last rung, the rung under test. */
function lastPane(container: HTMLElement): Element {
  const panes = container.querySelectorAll('[aria-label="Rung body"] .react-flow')
  const pane = panes[panes.length - 1]
  if (pane === undefined) throw new Error('no React Flow pane')
  return pane
}

/** Runs `gesture` on the POU with and without the wide rung; returns the rung under test after each. */
async function withAndWithoutShift(
  gesture: (container: HTMLElement) => Promise<void>,
): Promise<{ shifted: RungLadderState; plain: RungLadderState; shift: number }> {
  const plain = await open(false)
  await gesture(plain.container)
  const plainRung = target(plain.store, plain.index)
  plain.unmount()

  const moved = await open(true)
  const shift = expectMotorShifted(moved.store, moved.container)
  await gesture(moved.container)
  return { shifted: target(moved.store, moved.index), plain: plainRung, shift }
}

describe('AC11: dragging an element next to right-justified outputs places it as today', () => {
  it('Start dropped on the placeholder drawn left of Lamp lands between Stop and Lamp', async () => {
    const { shifted, plain } = await withAndWithoutShift((container) =>
      dragNodeTo(container, 'S', () => drawnPlaceholder(container, 'L', 'left').at),
    )
    expect(seriesOf(plain)).toEqual(['contact:Stop', 'contact:Start', 'coil:Lamp', 'coil:Motor'])
    expect(seriesOf(shifted)).toEqual(seriesOf(plain))
    expect(savedShape(shifted)).toEqual(savedShape(plain))
  })

  it('the right-justified coil Motor dropped on the placeholder drawn left of Lamp lands before Lamp', async () => {
    const { shifted, plain } = await withAndWithoutShift((container) =>
      dragNodeTo(container, 'M', () => drawnPlaceholder(container, 'L', 'left').at),
    )
    expect(seriesOf(plain)).toEqual(['contact:Start', 'contact:Stop', 'coil:Motor', 'coil:Lamp'])
    expect(seriesOf(shifted)).toEqual(seriesOf(plain))
    expect(savedShape(shifted)).toEqual(savedShape(plain))
  })

  it('the right-justified coil Motor dropped back where it is drawn leaves the rung as it was', async () => {
    const { shifted, plain } = await withAndWithoutShift(async (container) => {
      const home = drawnAt(container, 'M')
      const drag = await startNodeDrag(container, 'M')
      await drag.moveTo(home)
      await drag.release(home)
    })
    expect(seriesOf(shifted)).toEqual(['contact:Start', 'contact:Stop', 'coil:Lamp', 'coil:Motor'])
    expect(savedShape(shifted)).toEqual(savedShape(plain))
  })
})

describe('R3: the placeholder search and the dragged position use one space', () => {
  it('selects the placeholder drawn under the pointer while a contact is dragged next to the shifted coils', async () => {
    const { store, container } = await open(true)
    expectMotorShifted(store, container)
    const drag = await startNodeDrag(container, 'S')
    const wanted = drawnPlaceholder(container, 'M', 'left')
    await drag.moveTo(wanted.at)
    expect(drawnSelection(container).filter((id) => id.startsWith('placeholder_'))).toEqual([wanted.id])
    await drag.release(wanted.at)
  })

  it('draws the dragged right-justified coil where the pointer takes it, not shifted a second time', async () => {
    const { store, container } = await open(true)
    expectMotorShifted(store, container)
    const drag = await startNodeDrag(container, 'M')
    const drawn = drawnAt(container, 'M')
    const to: Point = { x: drag.from.x - 60, y: drag.from.y + 30 }
    await drag.moveTo(to)
    const after = drawnAt(container, 'M')
    expect({ dx: after.x - drawn.x, dy: after.y - drawn.y }).toEqual({ dx: -60, dy: 0 })
    await drag.release(to)
  })
})

describe('AC11: dropping a library element next to right-justified outputs places it as today', () => {
  it('a contact dropped on the placeholder drawn left of Lamp lands between Stop and Lamp', async () => {
    const { shifted, plain } = await withAndWithoutShift((container) =>
      dropFromLibrary(lastPane(container), 'contact', () => drawnPlaceholder(container, 'L', 'left').at),
    )
    expect(seriesOf(plain)).toEqual(['contact:Start', 'contact:Stop', 'contact:', 'coil:Lamp', 'coil:Motor'])
    expect(seriesOf(shifted)).toEqual(seriesOf(plain))
  })
})

describe('AC11: placing an armed element next to right-justified outputs places it as today', () => {
  it('a contact placed on the placeholder drawn left of Lamp lands between Stop and Lamp', async () => {
    const place = async (container: HTMLElement) => {
      const bodies = container.querySelectorAll('[aria-label="Rung body"]')
      const rungBody = bodies[bodies.length - 1]
      if (rungBody === undefined) throw new Error('no rung body')
      armPlacement(1)
      await hoverAt(rungBody, drawnAt(container, 'S'))
      const spot = drawnPlaceholder(container, 'L', 'left').at
      await hoverAt(rungBody, spot)
      await pressAt(rungBody, spot)
    }
    const { shifted, plain } = await withAndWithoutShift(place)
    expect(seriesOf(plain)).toEqual(['contact:Start', 'contact:Stop', 'contact:', 'coil:Lamp', 'coil:Motor'])
    expect(seriesOf(shifted)).toEqual(seriesOf(plain))
  })
})
