/**
 * POU presentation (BDD-21, BDD-19, AC06, AC26-j): one right rail shared by every rung of a POU, trailing outputs
 * right-justified against it as display-only shifts, and the map from displayed back to canonical positions.
 * @jest-environment node
 * @vitest-environment node
 */
import { loadCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  loadedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import {
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { RungLadderState } from '@root/middleware/shared/ports/types'

import {
  EMPTY_LABEL_SOURCE,
  layoutRung,
  LADDER_STYLE,
  LADDER_TYPOGRAPHY,
  parallelEdgeRoute,
  presentPou,
  type RungLayout,
  textWidthPx,
  toCanonicalPosition,
  toDisplayNodes,
  type WirePoint,
} from '..'

const EPS = 1e-6
const GUTTER = LADDER_STYLE.gutter
const PAD_R = LADDER_STYLE.padR

const contact = (id: string, name = id): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name = id): SeriesElement => ({ kind: 'coil', id, name })
const parallel = (id: string, ...branches: SeriesElement[][]): SeriesElement => ({ kind: 'parallel', id, branches })
const ton = (id: string, instance: string): SeriesElement => ({
  kind: 'block',
  id,
  template: 'TON',
  instance,
  pins: { PT: 'T#1s', ET: `${instance}_ET` },
})

/** A name of exactly `length` characters starting with `prefix`. */
const nameOf = (prefix: string, length: number): string => `${prefix}${'_'.repeat(length)}`.slice(0, length)

/** The right power rail of a rung. */
function rightRailId(rung: RungLadderState): string {
  const rail = rung.nodes.find((node) => node.type === 'powerRail' && node.data.variant === 'right')
  if (rail === undefined) throw new Error(`rung ${rung.id} has no right rail`)
  return rail.id
}

/** The node of a rung whose variable is named `name`. */
function nodeNamed(rung: RungLadderState, name: string): string {
  const found = rung.nodes.find((node) => {
    const variable: unknown = node.data.variable
    return typeof variable === 'object' && variable !== null && 'name' in variable && variable.name === name
  })
  if (found === undefined) throw new Error(`rung ${rung.id} has no element named ${name}`)
  return found.id
}

function geometry(layout: RungLayout, id: string) {
  const found = layout.nodes.get(id)
  if (found === undefined) throw new Error(`no geometry for ${id}`)
  return found
}

/** A handle's canonical position in rung canvas coordinates. */
function handleAt(layout: RungLayout, id: string, handleId: string): WirePoint {
  const g = geometry(layout, id)
  const h = g.handles.find((candidate) => candidate.id === handleId)
  if (h === undefined) throw new Error(`${id} has no handle ${handleId}`)
  return { x: g.position.x + h.x, y: g.position.y + h.y }
}

/** A plain copy of a layout, its maps as entry arrays, so a later change to the layout shows up in a comparison. */
function layoutSnapshot(layout: RungLayout): unknown {
  return JSON.parse(JSON.stringify({ ...layout, nodes: [...layout.nodes], labels: [...layout.labels] }))
}

/** The width of a contact or coil column: its name or its symbol, whichever is wider, plus a gap on each side. */
const column = (name: string): number =>
  Math.max(textWidthPx(name, LADDER_TYPOGRAPHY.nameSizePx), LADDER_STYLE.sym) + 2 * LADDER_STYLE.gap

/** The display shift of a node: its entry in `dxByNode`, 0 when it has none. */
const dxOf = (p: ReturnType<typeof presentPou>, id: string): number => p.dxByNode.get(id) ?? 0

/** The rung's widest example (BDD-21): two contacts whose names fill exactly 900 px with the coil Motor. */
const WIDE = seriesRung('rung_wide', [
  contact('W1', nameOf('Line_Start_Permissive', 55)),
  contact('W2', nameOf('Conveyor_Infeed_Ready', 55)),
  coil('WM', 'Motor'),
])

/** BDD-19 rows 1 to 5, one rung each; row 6 is the corpus rung W05 below. */
const ROWS = {
  row1: seriesRung('rung_row1', [contact('S1', 'Start'), coil('M1', 'Motor')]),
  row2: seriesRung('rung_row2', [contact('S2', 'Start'), coil('M2', 'Motor'), coil('L2', 'Lamp')]),
  row3: seriesRung('rung_row3', [contact('S3', 'Start'), parallel('p3', [coil('M3', 'Motor')], [coil('L3', 'Lamp')])]),
  row4: seriesRung('rung_row4', [contact('S4', 'Start'), ton('T4', 'Timer1')]),
  row5: seriesRung('rung_row5', [contact('S5', 'Start'), parallel('p5', [coil('M5', 'Motor')], [ton('T5', 'Timer1')])]),
} as const

const POU: readonly RungLadderState[] = [WIDE, ...Object.values(ROWS)]
const LAYOUTS: readonly RungLayout[] = POU.map((rung) => layoutRung(rung, EMPTY_LABEL_SOURCE))

/** Where each rung's right rail is displayed: its canonical x plus its shift. */
function displayedRails(p: ReturnType<typeof presentPou>): number[] {
  return POU.map((rung, index) => {
    const id = rightRailId(rung)
    return geometry(LAYOUTS[index], id).position.x + dxOf(p, id)
  })
}

describe('BDD-21: all rungs of a POU share one right rail', () => {
  it('builds the example POU around a widest rung that needs 900 px', () => {
    expect(LAYOUTS[0].size.width).toBeCloseTo(900, 6)
    expect(Math.max(...LAYOUTS.map((layout) => layout.size.width))).toBeCloseTo(900, 6)
  })

  it('1,200 px wide: the rail sits 24 px from the right edge, the same x for every rung, and nothing scrolls', () => {
    const p = presentPou(LAYOUTS, 1200)
    expect(p.railX).toBeCloseTo(1200 - GUTTER - PAD_R, 6)
    expect(p.widthPx).toBeCloseTo(p.railX + PAD_R, 6)
    expect(GUTTER + p.widthPx).toBeLessThanOrEqual(1200 + EPS)
    for (const x of displayedRails(p)) expect(x).toBeCloseTo(p.railX, 6)
  })

  it('resized from 1,200 to 1,000 px: the rail follows to 24 px from the new edge, still one x and no scroll', () => {
    const before = presentPou(LAYOUTS, 1200)
    const after = presentPou(LAYOUTS, 1000)
    expect(after.railX).toBeCloseTo(1000 - GUTTER - PAD_R, 6)
    expect(after.railX - before.railX).toBeCloseTo(-200, 6)
    expect(GUTTER + after.widthPx).toBeLessThanOrEqual(1000 + EPS)
    for (const x of displayedRails(after)) expect(x).toBeCloseTo(after.railX, 6)
  })

  it('700 px wide: the rail sits right after the widest rung, the same x for every rung, and the POU scrolls as one', () => {
    const p = presentPou(LAYOUTS, 700)
    expect(p.railX).toBeCloseTo(900, 6)
    expect(p.widthPx).toBeCloseTo(900 + PAD_R, 6)
    expect(GUTTER + p.widthPx).toBeGreaterThan(700)
    expect(dxOf(p, rightRailId(WIDE))).toBeCloseTo(0, 6)
    for (const x of displayedRails(p)) expect(x).toBeCloseTo(900, 6)
  })

  it('before the editor is measured (0 px), the rail sits right after the widest rung', () => {
    expect(presentPou(LAYOUTS, 0).railX).toBeCloseTo(900, 6)
  })

  it('switches from the widest rung to the editor edge exactly when the editor is wider than gutter + rung + padding', () => {
    expect(presentPou(LAYOUTS, 900 + GUTTER + PAD_R).railX).toBeCloseTo(900, 6)
    expect(presentPou(LAYOUTS, 900 + GUTTER + PAD_R + 1).railX).toBeCloseTo(901, 6)
  })

  it('a one-rung POU puts its own rail at the editor edge', () => {
    const layout = LAYOUTS[1]
    const p = presentPou([layout], 1200)
    expect(dxOf(p, rightRailId(ROWS.row1))).toBeCloseTo(1200 - GUTTER - PAD_R - layout.size.width, 6)
  })

  it('leaves the layouts it presents unchanged', () => {
    const before = LAYOUTS.map(layoutSnapshot)
    presentPou(LAYOUTS, 1200)
    presentPou(LAYOUTS, 700)
    expect(LAYOUTS.map(layoutSnapshot)).toEqual(before)
  })
})

describe('BDD-19 / AC06: outputs right-justified against the right rail, blocks in flow', () => {
  const p = presentPou(LAYOUTS, 1200)
  const shiftOf = (index: number): number => p.railX - LAYOUTS[index].size.width

  /** The ids of a rung's nodes that the presentation moves. */
  const shifted = (rung: RungLadderState): string[] =>
    rung.nodes
      .map((node) => node.id)
      .filter((id) => Math.abs(dxOf(p, id)) > EPS)
      .sort()

  it.each([
    ['row 1: contact Start, coil Motor: Motor sits at the rail', 1, ROWS.row1, ['M1']],
    ['row 2: coils Motor and Lamp in series: both sit at the rail', 2, ROWS.row2, ['L2', 'M2']],
    [
      'row 3: a parallel group of coils Motor, Lamp: the whole group sits at the rail',
      3,
      ROWS.row3,
      ['L3', 'M3', 'p3:close0', 'p3:open0'],
    ],
    ['row 4: contact Start, TON Timer1: nothing moves but the rail', 4, ROWS.row4, []],
    ['row 5: a parallel group of coil Motor and TON: nothing moves but the rail', 5, ROWS.row5, []],
  ] as const)('%s', (_name, index, rung, outputs) => {
    const rail = rightRailId(rung)
    expect(shifted(rung)).toEqual([...outputs, rail].sort())
    for (const id of [...outputs, rail]) expect(dxOf(p, id)).toBeCloseTo(shiftOf(index), 6)
  })

  it('keeps the contact before the outputs and the left rail where they are', () => {
    for (const rung of Object.values(ROWS)) {
      const left = rung.nodes.find((node) => node.type === 'powerRail' && node.data.variant === 'left')
      expect({ rung: rung.id, left: dxOf(p, left?.id ?? ''), start: dxOf(p, rung.nodes[1].id) }).toEqual({
        rung: rung.id,
        left: 0,
        start: 0,
      })
    }
  })

  it('row 4: TON Timer1 and its pin variables stay right after Start (in flow)', () => {
    const blockNodes = ROWS.row4.nodes.filter((node) => node.id === 'T4' || node.id.startsWith('T4:'))
    expect(blockNodes.length).toBeGreaterThan(1)
    expect(blockNodes.map((node) => ({ id: node.id, dx: dxOf(p, node.id) }))).toEqual(
      blockNodes.map((node) => ({ id: node.id, dx: 0 })),
    )
  })

  it('row 1: the wire from Start to Motor stretches by the shift, so it reaches Motor against the rail', () => {
    const layout = LAYOUTS[1]
    const start = handleAt(layout, 'S1', 'output')
    const motor = handleAt(layout, 'M1', 'input')
    const displayedGap = motor.x + dxOf(p, 'M1') - (start.x + dxOf(p, 'S1'))
    expect(displayedGap).toBeCloseTo(motor.x - start.x + shiftOf(1), 6)
    const motorRight = geometry(layout, 'M1')
    const railGap = p.railX - (motorRight.position.x + dxOf(p, 'M1'))
    expect(railGap).toBeCloseTo(layout.size.width - motorRight.position.x, 6)
  })
})

describe('toDisplayNodes', () => {
  const p = presentPou(LAYOUTS, 1200)
  const nodes = ROWS.row2.nodes

  it('returns every node at its canonical position plus its shift', () => {
    const displayed = toDisplayNodes(nodes, p)
    expect(displayed.map((node) => ({ id: node.id, position: node.position }))).toEqual(
      nodes.map((node) => ({ id: node.id, position: { x: node.position.x + dxOf(p, node.id), y: node.position.y } })),
    )
  })

  it('leaves its input nodes untouched and returns new objects for every node it moves', () => {
    const before = structuredClone(nodes)
    const displayed = toDisplayNodes(nodes, p)
    expect(nodes).toEqual(before)
    expect(displayed).not.toBe(nodes)
    for (const id of ['M2', 'L2', rightRailId(ROWS.row2)]) {
      const index = nodes.findIndex((node) => node.id === id)
      expect({ id, same: displayed[index] === nodes[index] }).toEqual({ id, same: false })
    }
  })

  it('keeps every other field of a node', () => {
    const displayed = toDisplayNodes(nodes, p)
    expect(displayed.map(({ position: _position, ...rest }) => rest)).toEqual(
      nodes.map(({ position: _position, ...rest }) => rest),
    )
  })

  it('keeps a node the presentation does not know where it is', () => {
    const placeholder = { id: 'placeholder_M2_x', position: { x: 12, y: 34 }, extra: 'kept' }
    expect(toDisplayNodes([placeholder], p)).toEqual([placeholder])
  })
})

describe('toCanonicalPosition', () => {
  const p = presentPou(LAYOUTS, 1200)

  it('is the inverse of the display shift for every node of the POU', () => {
    for (const rung of POU) {
      const displayed = toDisplayNodes(rung.nodes, p)
      displayed.forEach((node, index) => {
        expect({ id: node.id, position: toCanonicalPosition(node.id, node.position, p) }).toEqual({
          id: node.id,
          position: rung.nodes[index].position,
        })
      })
    }
  })

  it("subtracts a shifted node's dx from x and keeps y", () => {
    const dx = dxOf(p, 'M1')
    expect(dx).toBeGreaterThan(0)
    expect(toCanonicalPosition('M1', { x: 500, y: 77 }, p)).toEqual({ x: 500 - dx, y: 77 })
  })

  it('keeps the position of a node with no shift', () => {
    expect(toCanonicalPosition('S1', { x: 500, y: 77 }, p)).toEqual({ x: 500, y: 77 })
    expect(toCanonicalPosition('unknown', { x: 3, y: 4 }, p)).toEqual({ x: 3, y: 4 })
  })
})

describe('AC26-j / BDD-19 row 6 (W05): a trailing coil group with unequal names, shifted to the rail', () => {
  const data = loadCorpusProject('ld-corpus-parallel-width')
  const src = corpusLabelSource(data, 'Branches')
  const rungs = loadedRungs(data, 'Branches')
  const layouts = rungs.map((rung) => layoutRung(rung, src))
  const rung = rungs[4]
  const layout = layouts[4]
  const p = presentPou(layouts, 1200)
  const shortCoil = nodeNamed(rung, 'w05_k')
  const longCoil = nodeNamed(rung, 'w05_conveyor_reject_gate_solenoid_output_main')
  const group = layout.parallels.find((candidate) => candidate.openNodeIds.length > 0 && candidate.depth === 0)
  if (group === undefined) throw new Error('W05 has no parallel group')
  const shift = p.railX - layout.size.width

  it('is the corpus rung W05, a trailing group aligned to the end, and the presentation shifts it', () => {
    expect(group.alignment).toBe('end')
    expect(shift).toBeGreaterThan(0)
  })

  it('gives every node of the group, its parallel nodes included, and the rail one shift', () => {
    const ids = [...group.openNodeIds, ...group.closeNodeIds, shortCoil, longCoil, rightRailId(rung)]
    expect(ids.map((id) => ({ id, dx: Math.round(dxOf(p, id) * 1000) / 1000 }))).toEqual(
      ids.map((id) => ({ id, dx: Math.round(shift * 1000) / 1000 })),
    )
    expect(dxOf(p, nodeNamed(rung, 'w05_a'))).toBe(0)
  })

  it("draws every wire of the group as its canonical route shifted by the group's dx, still straight", () => {
    const routed = rung.edges.flatMap((edge) => {
      const plain = parallelEdgeRoute(layout, edge)
      const moved = parallelEdgeRoute(layout, edge, (id) => p.dxByNode.get(id) ?? 0)
      return plain === undefined ? [] : [{ edge: edge.id, plain, moved }]
    })
    expect(routed.length).toBe(4)
    for (const { edge, plain, moved } of routed) {
      expect({ edge, moved }).toEqual({ edge, moved: plain.map((point) => ({ x: point.x + shift, y: point.y })) })
      const slanted = (moved ?? []).slice(1).filter((point, index) => {
        const from = (moved ?? [])[index]
        return Math.abs(point.x - from.x) > EPS && Math.abs(point.y - from.y) > EPS
      })
      expect({ edge, slanted }).toEqual({ edge, slanted: [] })
    }
  })

  it("puts both coils in the widest coil's column, on one vertical, ending parPad before the junction on the rail", () => {
    const closeX = group.closeX + shift
    const widest = column('w05_conveyor_reject_gate_solenoid_output_main')
    expect(geometry(layout, shortCoil).position.x).toBeCloseTo(geometry(layout, longCoil).position.x, 6)
    expect(closeX).toBeCloseTo(p.railX, 6)
    const cellEnds = [
      [shortCoil, 'w05_k'],
      [longCoil, 'w05_conveyor_reject_gate_solenoid_output_main'],
    ].map(([id]) => geometry(layout, id).position.x + LADDER_STYLE.sym / 2 + widest / 2 + dxOf(p, id))
    expect(closeX - cellEnds[0]).toBeCloseTo(LADDER_STYLE.parPad, 6)
    expect(closeX - cellEnds[1]).toBeCloseTo(LADDER_STYLE.parPad, 6)
  })

  it('keeps the closing junction one vertical line on the rail', () => {
    const closeX = group.closeX + shift
    const closingInputs = group.closeNodeIds.flatMap((id) =>
      geometry(layout, id)
        .handles.filter((handle) => handle.id === 'input' || handle.id === 'input-down')
        .map((handle) => geometry(layout, id).position.x + handle.x + dxOf(p, id)),
    )
    expect(closingInputs.length).toBe(2)
    for (const x of closingInputs) expect(x).toBeCloseTo(closeX, 6)
  })

  it("runs the short-named coil's filler straight from the opening junction to the coil", () => {
    const branch = group.branches.findIndex((candidate) => candidate.nodeIds.includes(shortCoil))
    const filler = layout.branchFillers.find(
      (candidate) => group.closeNodeIds.includes(candidate.closeNodeId) && candidate.branchIndex === branch,
    )
    if (filler === undefined) throw new Error('W05 has no filler for the short-named coil')
    const coilInput = handleAt(layout, shortCoil, 'input')
    expect(filler.side).toBe('before')
    expect(filler.x1 + shift).toBeCloseTo(group.openX + dxOf(p, group.openNodeIds[0]), 6)
    expect(filler.x2 + shift).toBeCloseTo(coilInput.x + dxOf(p, shortCoil), 6)
    expect(filler.y).toBeCloseTo(coilInput.y, 6)
  })
})
