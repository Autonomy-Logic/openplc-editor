import {
  boolVariable,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { OpenPLCStore } from '@root/frontend/store'
import type { PLCVariable } from '@root/middleware/shared/ports/types'
import { LADDER_PALETTE } from '@root/middleware/shared/utils/ladder-layout/style'
import { act } from '@testing-library/react'

import {
  answerScopeQueriesFrom,
  debugSession,
  drawnColour,
  edgePath,
  installLadderScreen,
  ladderStore,
  nodeElement,
  outlineColours,
  renderLadder,
  settle,
  storedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()

const POU = 'main'
const LIGHT = LADDER_PALETTE.light
const FORCED_TRUE = '#80c000'
const FORCED_FALSE = '#4080ff'

const baseVariable = (name: string, value: 'INT' | 'TIME'): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value },
  location: '',
  documentation: '',
})

const instanceVariable = (name: string, functionBlock: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'derived', value: functionBlock },
  location: '',
  documentation: '',
})

const RUNGS = [
  seriesRung('rung_timer', [
    { kind: 'contact', id: 'start', name: 'Start' },
    { kind: 'block', id: 't', template: 'TON', instance: 'Timer1', pins: { PT: 'T#1s', ET: 'Elapsed' } },
    { kind: 'coil', id: 'motor', name: 'Motor' },
  ]),
  seriesRung('rung_counter', [
    { kind: 'contact', id: 'cu', name: 'Count_Up' },
    { kind: 'block', id: 'c', template: 'CTU', instance: 'Counter1', pins: { R: 'Reset', PV: 'Preset', CV: 'Count' } },
  ]),
]

const VARIABLES: PLCVariable[] = [
  boolVariable('Start'),
  boolVariable('Motor'),
  boolVariable('Count_Up'),
  boolVariable('Reset'),
  baseVariable('Preset', 'INT'),
  baseVariable('Count', 'INT'),
  baseVariable('Elapsed', 'TIME'),
  instanceVariable('Timer1', 'TON'),
  instanceVariable('Counter1', 'CTU'),
]

async function openDebug(
  values: Readonly<Record<string, string>>,
  forced: Readonly<Record<string, boolean>> = {},
): Promise<{ store: OpenPLCStore; container: HTMLElement }> {
  const store = ladderStore([{ name: POU, variables: VARIABLES, rungs: RUNGS }])
  answerScopeQueriesFrom(store)
  const { container } = await renderLadder(store, POU)
  debugSession(store, POU, values, forced)
  await settle()
  return { store, container }
}

/** The id of the edge leaving `source` in the stored rungs. */
function edgeFrom(store: OpenPLCStore, source: string): string {
  const found = storedRungs(store, POU)
    .flatMap((rung) => rung.edges)
    .find((wire) => wire.source === source)
  if (found === undefined) throw new Error(`no edge leaves ${source}`)
  return found.id
}

/** The outline colours drawn inside node `id`: its SVG strokes and inline border colours. */
const outlinesOf = (container: HTMLElement, id: string): Set<string> =>
  new Set(outlineColours(nodeElement(container, id)))

describe('contacts and wires in a debug session (BDD-23, AC07)', () => {
  it('Start is TRUE: Start and the wire after it are drawn in the on colour', async () => {
    const { store, container } = await openDebug({ Start: 'TRUE' })
    const start = outlinesOf(container, 'start')
    expect({
      startOn: start.has(LIGHT.on),
      startInk: start.has(LIGHT.text),
      wire: drawnColour(edgePath(container, edgeFrom(store, 'start')), 'stroke'),
    }).toEqual({ startOn: true, startInk: false, wire: LIGHT.on })
  })

  it('Start is FALSE: Start is in the normal ink and the wire after it is not on', async () => {
    const { store, container } = await openDebug({ Start: 'FALSE' })
    const start = outlinesOf(container, 'start')
    expect({
      startInk: start.has(LIGHT.text),
      startOn: start.has(LIGHT.on),
      wireOn: drawnColour(edgePath(container, edgeFrom(store, 'start')), 'stroke') === LIGHT.on,
    }).toEqual({ startInk: true, startOn: false, wireOn: false })
  })

  it("Start is forced TRUE: Start keeps today's forced-true colour", async () => {
    const { container } = await openDebug({ Start: 'TRUE' }, { Start: true })
    expect(outlinesOf(container, 'start').has(FORCED_TRUE)).toBe(true)
  })

  it("Start is forced FALSE: Start keeps today's forced-false colour", async () => {
    const { container } = await openDebug({ Start: 'FALSE' }, { Start: false })
    expect(outlinesOf(container, 'start').has(FORCED_FALSE)).toBe(true)
  })

  it('a coil that is not true is in the normal ink', async () => {
    const { container } = await openDebug({ Start: 'FALSE' })
    const motor = outlinesOf(container, 'motor')
    expect({ ink: motor.has(LIGHT.text), on: motor.has(LIGHT.on) }).toEqual({ ink: true, on: false })
  })

  it('in the dark theme, a true contact and its wire use the dark on colour and a false contact the dark ink', async () => {
    const { store, container } = await openDebug({ Start: 'TRUE', Count_Up: 'FALSE' })
    act(() => store.getState().workspaceActions.switchAppTheme())
    await settle()
    const dark = LADDER_PALETTE.dark
    expect({
      start: outlinesOf(container, 'start').has(dark.on),
      wire: drawnColour(edgePath(container, edgeFrom(store, 'start')), 'stroke'),
      countUp: outlinesOf(container, 'cu').has(dark.text),
    }).toEqual({ start: true, wire: dark.on, countUp: true })
  })
})

describe('block borders in a debug session (BDD-23, AC07)', () => {
  it("power reaches Timer1's IN on the rung wire: Timer1's border is in the on colour", async () => {
    const { container } = await openDebug({ Start: 'TRUE' })
    expect(outlinesOf(container, 't').has(LIGHT.on)).toBe(true)
  })

  it("no power reaches Timer1's IN: Timer1's border is in the wire colour and nothing in it is on", async () => {
    const { container } = await openDebug({ Start: 'FALSE' })
    const timer = outlinesOf(container, 't')
    expect({ wire: timer.has(LIGHT.wire), on: timer.has(LIGHT.on) }).toEqual({ wire: true, on: false })
  })
})

describe('value badges in a debug session (BDD-23, AC07)', () => {
  it('Preset is 5: a badge "5" shows beside Preset, and no value is drawn inside the CTU', async () => {
    const { container } = await openDebug({ Preset: '5', Count_Up: 'TRUE' })
    expect({
      preset: nodeElement(container, 'c:PV').textContent?.includes('5'),
      block: nodeElement(container, 'c').textContent?.includes('5'),
    }).toEqual({ preset: true, block: false })
  })

  it('Start is TRUE (BOOL): no badge shows for Start', async () => {
    const { container } = await openDebug({ Start: 'TRUE' })
    expect(nodeElement(container, 'start').textContent ?? '').not.toMatch(/TRUE|\b1\b/)
  })
})
