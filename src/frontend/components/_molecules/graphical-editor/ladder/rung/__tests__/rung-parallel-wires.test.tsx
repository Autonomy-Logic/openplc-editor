import { loadCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import { loadedRungs } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import type { OpenPLCStore } from '@root/frontend/store'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { LADDER_PALETTE } from '@root/middleware/shared/utils/ladder-layout/style'
import type { RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'
import { parallelEdgeRoute, type WirePoint } from '@root/middleware/shared/utils/ladder-layout/wires'

import {
  debugSession,
  drawnColour,
  drawnPoints,
  drawnValue,
  installLadderScreen,
  ladderStore,
  nodeElement,
  queryTestId,
  renderLadder,
  rounded,
  settle,
  storedLayout,
  storedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()

const EPS = 1e-6
const data = loadCorpusProject('ld-corpus-parallel-width')

/** The corpus POU as an editor program: its variables and its rungs as the editor loads them. */
function corpusPou(name: string) {
  const pou = data.pous.find((candidate) => candidate.name === name)
  return { name, variables: pou?.interface?.variables ?? [], rungs: loadedRungs(data, name) }
}

/** The plan cases of this phase: corpus rung, POU and 0-based rung index. */
const CASES: readonly [string, string, number][] = [
  ['AC26-a / BDD-20 row 2 (W01): A, then B, C, D / E, then Y', 'Branches', 0],
  ['AC26-b (W02): three branches, the longest in the middle', 'Branches', 1],
  ['AC26-c / BDD-20 row 4 (W03): nested groups with shorter inner and outer branches', 'Branches', 2],
  ['AC26-f / BDD-20 row 5 (W08): CTUD LD fed by (I AND J) OR K OR L', 'Blocks', 2],
]

async function open(pouName: string): Promise<{ store: OpenPLCStore; container: HTMLElement }> {
  const store = ladderStore([corpusPou(pouName)])
  const { container } = await renderLadder(store, pouName)
  return { store, container }
}

/** The `ld-wire` path drawn for edge `edgeId`, or null when the edge has none. */
const wireOf = (container: HTMLElement, edgeId: string) => queryTestId(container, `ld-wire-${edgeId}`)

/** Every segment of a polyline that is neither horizontal nor vertical. */
function slanted(points: readonly WirePoint[]): string[] {
  return points.slice(1).flatMap((point, index) => {
    const from = points[index]
    const straight = Math.abs(point.x - from.x) <= EPS || Math.abs(point.y - from.y) <= EPS
    return straight ? [] : [`(${from.x},${from.y})-(${point.x},${point.y})`]
  })
}

/** The x of every vertical segment of a polyline. */
function verticalXs(points: readonly WirePoint[]): number[] {
  return points.slice(1).flatMap((point, index) => {
    const from = points[index]
    return Math.abs(point.x - from.x) <= EPS && Math.abs(point.y - from.y) > EPS ? [point.x] : []
  })
}

/** Whether `x` is the opening or closing junction of a parallel group of the layout. */
const onJunction = (layout: RungLayout, x: number): boolean =>
  layout.parallels.some((group) => Math.abs(group.openX - x) <= EPS || Math.abs(group.closeX - x) <= EPS)

/** The node of `rung` whose variable is named `name`. */
function nodeNamed(rung: RungLadderState, name: string): string {
  const found = rung.nodes.find((node) => {
    const variable: unknown = node.data.variable
    return typeof variable === 'object' && variable !== null && 'name' in variable && variable.name === name
  })
  if (found === undefined) throw new Error(`rung ${rung.id} has no element named ${name}`)
  return found.id
}

describe.each(CASES)('%s', (_name, pouName, rungIndex) => {
  it('draws every edge with a route as the polyline through exactly its parallelEdgeRoute points', async () => {
    const { store, container } = await open(pouName)
    const rung = storedRungs(store, pouName)[rungIndex]
    const layout = storedLayout(store, pouName, rungIndex)
    const routed = rung.edges.flatMap((wire) => {
      const route = parallelEdgeRoute(layout, wire)
      return route === undefined ? [] : [{ wire, route }]
    })
    expect(routed.length).toBeGreaterThan(0)
    for (const { wire, route } of routed) {
      const path = wireOf(container, wire.id)
      expect({ edge: wire.id, drawn: path === null ? null : rounded(drawnPoints(path)) }).toEqual({
        edge: wire.id,
        drawn: rounded(route),
      })
    }
  })

  it('draws only horizontal and vertical segments, each vertical one on a junction of its group', async () => {
    const { store, container } = await open(pouName)
    const rung = storedRungs(store, pouName)[rungIndex]
    const layout = storedLayout(store, pouName, rungIndex)
    const routed = rung.edges.filter((wire) => parallelEdgeRoute(layout, wire) !== undefined)
    expect(routed.length).toBeGreaterThan(0)
    for (const wire of routed) {
      const path = wireOf(container, wire.id)
      const points = path === null ? [] : drawnPoints(path)
      expect({
        edge: wire.id,
        drawn: points.length >= 2,
        slanted: slanted(points),
        offJunction: verticalXs(points).filter((x) => !onJunction(layout, x)),
      }).toEqual({ edge: wire.id, drawn: true, slanted: [], offJunction: [] })
    }
  })

  it("keeps today's smoothstep drawing for every edge without a route", async () => {
    const { store, container } = await open(pouName)
    const rung = storedRungs(store, pouName)[rungIndex]
    const layout = storedLayout(store, pouName, rungIndex)
    const plain = rung.edges.filter((wire) => parallelEdgeRoute(layout, wire) === undefined)
    expect(plain.length).toBeGreaterThan(0)
    for (const wire of plain) {
      const edge = container.querySelector(`.react-flow__edge[data-id="${wire.id}"]`)
      expect({
        edge: wire.id,
        smoothstep: edge?.classList.contains('react-flow__edge-smoothstep'),
        wire: wireOf(container, wire.id) === null,
      }).toEqual({ edge: wire.id, smoothstep: true, wire: true })
    }
  })
})

describe('the junctions stay one straight vertical line', () => {
  it('W08: the wires of k and l run straight to the closing junction, with no bend after k', async () => {
    const { store, container } = await open('Blocks')
    const rung = storedRungs(store, 'Blocks')[2]
    const layout = storedLayout(store, 'Blocks', 2)
    const [group] = layout.parallels
    if (group === undefined) throw new Error('W08 has no parallel group')
    for (const name of ['w08_k', 'w08_l']) {
      const id = nodeNamed(rung, name)
      const wire = rung.edges.find((candidate) => candidate.source === id)
      const path = wire === undefined ? null : wireOf(container, wire.id)
      const points = rounded(path === null ? [] : drawnPoints(path))
      const closeX = Math.round(group.closeX * 1000) / 1000
      expect({
        name,
        drawn: points.length >= 2,
        endsOnJunction: points[points.length - 1]?.x === closeX,
        verticals: verticalXs(points).filter((x) => x !== closeX),
        bends: verticalXs(points).length <= 1,
      }).toEqual({ name, drawn: true, endsOnJunction: true, verticals: [], bends: true })
    }
  })

  it('W01: the parallel nodes draw no outlined box across the junction line', async () => {
    const { store, container } = await open('Branches')
    const parallels = storedRungs(store, 'Branches')[0].nodes.filter((node) => node.type === 'parallel')
    expect(parallels.length).toBeGreaterThan(0)
    for (const node of parallels) {
      const boxes = Array.from(nodeElement(container, node.id).querySelectorAll('rect')).filter(
        (rect) => (drawnValue(rect, 'fill') ?? '').trim().toLowerCase() === 'none',
      )
      expect({ node: node.id, outlinedBoxes: boxes.length }).toEqual({ node: node.id, outlinedBoxes: 0 })
    }
  })
})

describe('AC26-h: a branch filler is energized with the edge it belongs to', () => {
  it("W01 in debug, E passing power and D not: E's wire into the closing junction is on, D's is not", async () => {
    const { store, container } = await open('Branches')
    debugSession(store, 'Branches', {
      w01_a: 'TRUE',
      w01_b: 'FALSE',
      w01_c: 'FALSE',
      w01_d: 'FALSE',
      w01_e: 'TRUE',
    })
    await settle()
    const rung = storedRungs(store, 'Branches')[0]
    const into = (name: string) => {
      const id = nodeNamed(rung, name)
      const wire = rung.edges.find((candidate) => candidate.source === id)
      if (wire === undefined) throw new Error(`no edge leaves ${name}`)
      const path = wireOf(container, wire.id)
      if (path === null) throw new Error(`edge ${wire.id} from ${name} has no ld-wire path`)
      return drawnColour(path, 'stroke')
    }
    expect({ e: into('w01_e'), dOn: into('w01_d') === LADDER_PALETTE.light.on }).toEqual({
      e: LADDER_PALETTE.light.on,
      dOn: false,
    })
  })
})

describe('the parallel wires are not stored', () => {
  it('rendering the W01-W05 rungs leaves the stored rungs and the updated flag unchanged', async () => {
    const store = ladderStore([corpusPou('Branches')])
    const flow = () => {
      const found = store.getState().ladderFlows.find((candidate) => candidate.name === 'Branches')
      return structuredClone({ updated: found?.updated, rungs: found?.rungs ?? [] })
    }
    const before = flow()
    await renderLadder(store, 'Branches')
    expect(flow()).toEqual(before)
  })
})
