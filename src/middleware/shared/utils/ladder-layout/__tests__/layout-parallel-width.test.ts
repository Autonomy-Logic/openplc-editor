/**
 * Parallel branch width (AC26): every branch of a parallel group spans the widest branch, shorter branches end in one
 * straight branch filler, and both junctions are one vertical line; `parallelEdgeRoute` draws the wires to them.
 * @jest-environment node
 * @vitest-environment node
 */
import {
  CORPUS_PROJECTS,
  ldPouNames,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  corpusRungName,
  loadedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import {
  renamedRung,
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { RungLadderState } from '@root/middleware/shared/ports/types'

import { EMPTY_LABEL_SOURCE } from '../labels'
import { applyRungLayout, layoutRung } from '../layout'
import { textWidthPx } from '../measure'
import { LADDER_STYLE, LADDER_TYPOGRAPHY } from '../style'
import type { NodeGeometry, ParallelGroupLayout, RungLayout } from '../types'
import { type LdEdgeEnds, parallelEdgeRoute, type WirePoint } from '../wires'

const S = LADDER_STYLE
const EPS = 1e-6
/** Height of a contact or coil above and below its wire, and so the wire-to-wire pitch of stacked contact branches. */
const CC_TOP = S.symH / 2 + S.labGap + LADDER_TYPOGRAPHY.locationSizePx * 1.3 + LADDER_TYPOGRAPHY.nameSizePx * 1.25
const CC_BOTTOM = S.symH / 2 + 3
const BRANCH_PITCH = CC_BOTTOM + S.branchGap + CC_TOP

const column = (name: string): number => Math.max(textWidthPx(name, LADDER_TYPOGRAPHY.nameSizePx), S.sym) + 2 * S.gap

const contact = (id: string, name = id): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name = id): SeriesElement => ({ kind: 'coil', id, name })
const parallel = (id: string, ...branches: SeriesElement[][]): SeriesElement => ({ kind: 'parallel', id, branches })

function geometry(layout: RungLayout, id: string): NodeGeometry {
  const found = layout.nodes.get(id)
  if (found === undefined) throw new Error(`no geometry for ${id}`)
  return found
}

/** A handle's position in rung canvas coordinates. */
function handleAt(layout: RungLayout, id: string, handleId: string): WirePoint {
  const g = geometry(layout, id)
  const h = g.handles.find((candidate) => candidate.id === handleId)
  if (h === undefined) throw new Error(`${id} has no handle ${handleId}`)
  return { x: g.position.x + h.x, y: g.position.y + h.y }
}

function groupOpenedBy(layout: RungLayout, openId: string): ParallelGroupLayout {
  const found = layout.parallels.find((group) => group.openNodeIds.includes(openId))
  if (found === undefined) throw new Error(`no group opened by ${openId}`)
  return found
}

function fillersOf(layout: RungLayout, group: ParallelGroupLayout) {
  return layout.branchFillers
    .filter((filler) => group.closeNodeIds.includes(filler.closeNodeId))
    .sort((a, b) => a.branchIndex - b.branchIndex)
}

function rungEdge(rung: RungLadderState, target: string, targetHandle: string, source?: string): LdEdgeEnds {
  const found = rung.edges.find(
    (wire) =>
      wire.target === target && wire.targetHandle === targetHandle && (source === undefined || wire.source === source),
  )
  if (found === undefined) throw new Error(`no edge into ${target}.${targetHandle}`)
  return found
}

function edgeFrom(rung: RungLadderState, source: string, sourceHandle: string): LdEdgeEnds {
  const found = rung.edges.find((wire) => wire.source === source && wire.sourceHandle === sourceHandle)
  if (found === undefined) throw new Error(`no edge from ${source}.${sourceHandle}`)
  return found
}

const PARALLEL_INPUTS: ReadonlySet<string> = new Set(['input', 'input-down'])
const PARALLEL_OUTPUTS: ReadonlySet<string> = new Set(['output-right', 'output-down'])

/** Every broken P2-P7 rule of a laid-out rung, for any rung with parallel groups. */
function parallelBreaks(rung: RungLadderState, layout: RungLayout): string[] {
  const breaks: string[] = []
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS
  for (const group of layout.parallels) {
    const name = group.openNodeIds[0]
    if (
      group.branches.length !== group.openNodeIds.length + 1 ||
      group.closeNodeIds.length !== group.openNodeIds.length
    )
      breaks.push(`${name}: ${group.openNodeIds.length} pairs for ${group.branches.length} branches`)
    if (!(group.closeX - group.openX >= S.parPad - EPS)) breaks.push(`${name}: closeX before openX + parPad`)
    if (!near(group.yTop, group.branches[0]?.y ?? NaN)) breaks.push(`${name}: yTop is not the top branch's y`)
    if (!near(group.yBottom, group.branches[group.branches.length - 1]?.y ?? NaN))
      breaks.push(`${name}: yBottom is not the bottom branch's y`)
    const fillers = fillersOf(layout, group)
    if (fillers.length !== group.branches.length)
      breaks.push(`${name}: ${fillers.length} fillers for ${group.branches.length} branches`)
    group.branches.forEach((branch, index) => {
      const filler = fillers.find((candidate) => candidate.branchIndex === index)
      if (group.alignment === 'start') {
        if (!near(branch.startX, group.openX + S.parPad)) breaks.push(`${name}[${index}]: startX is not openX + parPad`)
        if (branch.endX > group.closeX + EPS) breaks.push(`${name}[${index}]: endX past closeX`)
        if (
          filler === undefined ||
          filler.side !== 'after' ||
          !near(filler.x1, branch.endX) ||
          !near(filler.x2, group.closeX)
        )
          breaks.push(`${name}[${index}]: filler is not endX -> closeX`)
      } else if (filler === undefined || filler.side !== 'before' || !near(filler.x1, group.openX)) {
        breaks.push(`${name}[${index}]: 'end' filler does not start at openX`)
      }
      if (filler !== undefined && !near(filler.y, branch.y))
        breaks.push(`${name}[${index}]: filler off the branch wire`)
    })
    for (const id of group.closeNodeIds) {
      for (const h of geometry(layout, id).handles) {
        if (PARALLEL_INPUTS.has(h.id) && !near(handleAt(layout, id, h.id).x, group.closeX))
          breaks.push(`${id}.${h.id}: not on the closing junction`)
      }
    }
    for (const id of group.openNodeIds) {
      for (const h of geometry(layout, id).handles) {
        if (PARALLEL_OUTPUTS.has(h.id) && !near(handleAt(layout, id, h.id).x, group.openX))
          breaks.push(`${id}.${h.id}: not on the opening junction`)
      }
    }
    for (const inner of layout.parallels) {
      if (inner === group) continue
      const nested = group.branches.some((branch) => inner.openNodeIds.every((id) => branch.nodeIds.includes(id)))
      if (!nested) continue
      // A nested group that ends its branch closes on the outer junction's x.
      if (!(inner.closeX <= group.closeX + EPS && inner.openX > group.openX))
        breaks.push(`${inner.openNodeIds[0]}: outside ${name}`)
      if (inner.depth <= group.depth) breaks.push(`${inner.openNodeIds[0]}: depth not below ${name}`)
    }
  }
  const applied = applyRungLayout(rung, layout)
  if (JSON.stringify(applied.nodes.map((n) => n.id)) !== JSON.stringify(rung.nodes.map((n) => n.id)))
    breaks.push('nodes added, removed or reordered')
  if (JSON.stringify(applied.edges) !== JSON.stringify(rung.edges)) breaks.push('edges changed')
  return breaks
}

describe('BDD-20 row 2 / AC26-a: contact A, then B, C, D / E, then coil Motor', () => {
  const rung = seriesRung('rung_w01', [
    contact('A'),
    parallel('p', [contact('B'), contact('C'), contact('D')], [contact('E')]),
    coil('M', 'Motor'),
  ])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
  const group = groupOpenedBy(layout, 'p:open0')
  const columnEndA = geometry(layout, 'A').position.x + S.sym / 2 + column('A') / 2

  it('opens the group at the end of A and closes it at the end of the widest branch (P1)', () => {
    expect(group.openX).toBeCloseTo(columnEndA, 6)
    expect(group.closeX).toBeCloseTo(group.openX + S.parPad + 3 * column('B'), 6)
  })

  it('starts both branches at openX + parPad and stacks E one branch pitch below (P2)', () => {
    expect(group.branches.map((branch) => branch.startX)).toEqual([group.openX + S.parPad, group.openX + S.parPad])
    expect(group.branches[1].y - group.branches[0].y).toBeCloseTo(BRANCH_PITCH, 6)
    expect(group.yTop).toBeCloseTo(layout.mainWireY, 6)
    expect(group.alignment).toBe('start')
    expect(group.depth).toBe(0)
  })

  it("extends E's branch with one straight filler from E's output to the closing junction (P3)", () => {
    const [top, bottom] = fillersOf(layout, group)
    expect(bottom).toEqual({
      closeNodeId: 'p:close0',
      branchIndex: 1,
      side: 'after',
      y: group.branches[1].y,
      x1: handleAt(layout, 'E', 'output').x,
      x2: group.closeX,
    })
    expect(top.x1).toBeCloseTo(handleAt(layout, 'D', 'output').x, 6)
    expect(top.x2).toBeCloseTo(group.closeX, 6)
  })

  it('puts both closing inputs on x = closeX and both opening outputs on x = openX (P4)', () => {
    expect(handleAt(layout, 'p:close0', 'input').x).toBeCloseTo(group.closeX, 6)
    expect(handleAt(layout, 'p:close0', 'input-down').x).toBeCloseTo(group.closeX, 6)
    expect(handleAt(layout, 'p:open0', 'output-right').x).toBeCloseTo(group.openX, 6)
    expect(handleAt(layout, 'p:open0', 'output-down').x).toBeCloseTo(group.openX, 6)
  })

  it('places Motor right after the closing junction', () => {
    expect(geometry(layout, 'M').position.x + S.sym / 2).toBeCloseTo(group.closeX + column('Motor') / 2, 6)
  })

  it('breaks no rule', () => {
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('AC26-b: three branches, the longest in the middle (a stack of pairs)', () => {
  const rung = seriesRung('rung_w02', [
    parallel('p', [contact('F')], [contact('G'), contact('H'), contact('I')], [contact('J'), contact('K')]),
    coil('Y'),
  ])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)

  it('is one group with one openX and one closeX for its three branches (P5)', () => {
    const groups = layout.parallels.filter((group) => group.depth === 0)
    expect(groups).toHaveLength(1)
    const [group] = groups
    expect([...group.openNodeIds].sort()).toEqual(['p:open0', 'p:open1'])
    expect([...group.closeNodeIds].sort()).toEqual(['p:close0', 'p:close1'])
    expect(group.branches).toHaveLength(3)
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + 3 * column('G'), 6)
    expect(group.branches[1].y - group.branches[0].y).toBeCloseTo(BRANCH_PITCH, 6)
    expect(group.branches[2].y - group.branches[1].y).toBeCloseTo(BRANCH_PITCH, 6)
  })

  it('extends the top and bottom branches to the one closing junction', () => {
    const group = groupOpenedBy(layout, 'p:open0')
    const fillers = fillersOf(layout, group)
    expect(fillers.map((filler) => [filler.x1, filler.x2])).toEqual([
      [handleAt(layout, 'F', 'output').x, group.closeX],
      [handleAt(layout, 'I', 'output').x, group.closeX],
      [handleAt(layout, 'K', 'output').x, group.closeX],
    ])
  })

  it('breaks no rule', () => {
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('BDD-20 row 4 / AC26-c: A then an inner group B / "Conveyor_Infeed_Ready", branch 2 E', () => {
  const rung = seriesRung('rung_nested', [
    parallel(
      'o',
      [contact('A'), parallel('i', [contact('B')], [contact('R', 'Conveyor_Infeed_Ready')])],
      [contact('E')],
    ),
    coil('M', 'Motor'),
  ])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
  const outer = groupOpenedBy(layout, 'o:open0')
  const inner = groupOpenedBy(layout, 'i:open0')

  it('lists the outer group first and the inner group one level deeper', () => {
    expect(layout.parallels.indexOf(outer)).toBeLessThan(layout.parallels.indexOf(inner))
    expect([outer.depth, inner.depth]).toEqual([0, 1])
  })

  it('makes the inner group as wide as its longest branch, and the outer as wide as A plus the inner group, both closing on one x (P1, P6)', () => {
    expect(inner.closeX - inner.openX).toBeCloseTo(S.parPad + column('Conveyor_Infeed_Ready'), 6)
    expect(inner.openX).toBeCloseTo(outer.openX + S.parPad + column('A'), 6)
    expect(outer.closeX - outer.openX).toBeCloseTo(S.parPad + column('A') + (inner.closeX - inner.openX), 6)
    expect(inner.closeX).toBeCloseTo(outer.closeX, 6)
  })

  it("extends B's branch to the inner junction and E's branch to the outer junction", () => {
    const [b] = fillersOf(layout, inner)
    const [, e] = fillersOf(layout, outer)
    expect([b.x1, b.x2]).toEqual([handleAt(layout, 'B', 'output').x, inner.closeX])
    expect([e.x1, e.x2]).toEqual([handleAt(layout, 'E', 'output').x, outer.closeX])
    expect(fillersOf(layout, outer)[0].x1).toBeCloseTo(inner.closeX, 6)
  })

  it('breaks no rule', () => {
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('BDD-20 row 3 / AC26-d: the widest branch is decided by measured width, not element count', () => {
  it('"Start_Button_Main_Line" / "Stop": the junction at the end of the long-named column', () => {
    const rung = seriesRung('rung_row3', [
      parallel('p', [contact('L', 'Start_Button_Main_Line')], [contact('S', 'Stop')]),
      coil('M', 'Motor'),
    ])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const group = groupOpenedBy(layout, 'p:open0')
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + column('Start_Button_Main_Line'), 6)
    expect(fillersOf(layout, group)[1]).toMatchObject({ side: 'after', x2: group.closeX })
    expect(parallelBreaks(rung, layout)).toEqual([])
  })

  it('two short contacts against one 50-plus-character contact: the one-contact branch is the widest', () => {
    const long = 'Conveyor_Infeed_Photoeye_Blocked_Longer_Than_Limit_X'
    const rung = seriesRung('rung_w04', [parallel('p', [contact('A'), contact('B')], [contact('L', long)]), coil('Y')])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const group = groupOpenedBy(layout, 'p:open0')
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + column(long), 6)
    expect(fillersOf(layout, group)[0]).toMatchObject({ x1: handleAt(layout, 'B', 'output').x, x2: group.closeX })
  })

  it('equal-width branches: every filler only spans the closing gap', () => {
    const rung = seriesRung('rung_equal', [parallel('p', [contact('X')], [contact('Y')]), coil('Q')])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const group = groupOpenedBy(layout, 'p:open0')
    const gap = S.gap
    expect(fillersOf(layout, group).map((filler) => filler.x2 - filler.x1)).toEqual([gap, gap])
  })
})

describe('BDD-19 row 6 / AC26-e: a trailing group of coils Motor and Conveyor_Reject_Gate', () => {
  const rung = seriesRung('rung_trailing', [
    contact('S', 'Start'),
    parallel('p', [coil('M', 'Motor')], [coil('G', 'Conveyor_Reject_Gate')]),
  ])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
  const group = groupOpenedBy(layout, 'p:open0')

  it("is aligned to the end, both coils centred in the widest coil's column ending at closeX (P2)", () => {
    expect(group.alignment).toBe('end')
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + column('Conveyor_Reject_Gate'), 6)
    for (const [id, name] of [
      ['M', 'Motor'],
      ['G', 'Conveyor_Reject_Gate'],
    ] as const) {
      expect([name, geometry(layout, id).position.x + S.sym / 2 + column('Conveyor_Reject_Gate') / 2]).toEqual([
        name,
        expect.closeTo(group.closeX, 6),
      ])
    }
  })

  it("fills Motor's branch with a straight wire before the coil, from the opening junction (P3)", () => {
    expect(fillersOf(layout, group)).toEqual([
      {
        closeNodeId: 'p:close0',
        branchIndex: 0,
        side: 'before',
        y: group.branches[0].y,
        x1: group.openX,
        x2: handleAt(layout, 'M', 'input').x,
      },
      {
        closeNodeId: 'p:close0',
        branchIndex: 1,
        side: 'before',
        y: group.branches[1].y,
        x1: group.openX,
        x2: handleAt(layout, 'G', 'input').x,
      },
    ])
  })

  it('names the group, its parallel nodes included, as the trailing outputs', () => {
    expect([...layout.trailingOutputIds].sort()).toEqual(['G', 'M', 'p:close0', 'p:open0'])
  })

  it('breaks no rule', () => {
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('AC26-e: groups that are not trailing coil groups stay aligned to the start', () => {
  it('BDD-19 row 5: a trailing group of coil Motor and TON Timer1', () => {
    const rung = seriesRung('rung_row5', [
      contact('S', 'Start'),
      parallel(
        'p',
        [coil('M', 'Motor')],
        [{ kind: 'block', id: 'T', template: 'TON', instance: 'Timer1', pins: { PT: 'T#1s', ET: 'E1' } }],
      ),
    ])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(groupOpenedBy(layout, 'p:open0').alignment).toBe('start')
    expect(layout.trailingOutputIds).toEqual([])
    expect(parallelBreaks(rung, layout)).toEqual([])
  })

  it('W06 shape: contact A then a TON on one branch, contact B on the other; the block branch counts its block', () => {
    const rung = seriesRung('rung_block_branch', [
      parallel(
        'p',
        [contact('A'), { kind: 'block', id: 'T', template: 'TON', instance: 'TON0', pins: { PT: 'T#1s', ET: 'E1' } }],
        [contact('B')],
      ),
      coil('Y'),
    ])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const group = groupOpenedBy(layout, 'p:open0')
    const block = geometry(layout, 'T')
    expect(group.closeX).toBeGreaterThanOrEqual(block.position.x + block.width + S.gapBlk - EPS)
    expect(fillersOf(layout, group)[1]).toMatchObject({
      side: 'after',
      x1: handleAt(layout, 'B', 'output').x,
      x2: group.closeX,
    })
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('AC26-f: parallel groups on block pin networks', () => {
  const data = loadCorpusProject('ld-corpus-parallel-width')
  const blocks = loadedRungs(data, 'Blocks')

  it('W07 shape: CTU R fed by (I AND J) OR K; K extended to one closing junction before the pin', () => {
    const rung = blocks[1]
    const layout = layoutRung(rung, corpusLabelSource(data, 'Blocks'))
    const groups = layout.parallels
    expect(groups).toHaveLength(1)
    const [group] = groups
    const ctu = rung.nodes.find((node) => node.type === 'block')
    if (ctu === undefined) throw new Error('W07 has no block')
    expect(group.closeX).toBeLessThan(geometry(layout, ctu.id).position.x)
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + column('w07_i') + column('w07_j'), 6)
    expect(parallelBreaks(rung, layout)).toEqual([])
  })

  it('BDD-20 row 5: CTUD "Counter1", LD fed by i, k and l in parallel with j after i: one junction at the end of j', () => {
    const rung = renamedRung(blocks[2], { w08_i: 'i', w08_j: 'j', w08_k: 'k', w08_l: 'l', CTUD0: 'Counter1' })
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const groups = layout.parallels
    expect(groups).toHaveLength(1)
    const [group] = groups
    expect(group.branches).toHaveLength(3)
    expect(group.closeX - group.openX).toBeCloseTo(S.parPad + column('i') + column('j'), 6)
    const fillers = fillersOf(layout, group)
    expect(fillers.map((filler) => filler.x2)).toEqual([group.closeX, group.closeX, group.closeX])
    expect(new Set(group.branches.map((branch) => branch.startX)).size).toBe(1)
    expect(parallelBreaks(rung, layout)).toEqual([])
  })
})

describe('parallelEdgeRoute', () => {
  const rung = seriesRung('rung_route', [
    contact('A'),
    parallel('p', [contact('B'), contact('C'), contact('D')], [contact('E')]),
    coil('M', 'Motor'),
  ])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
  const group = groupOpenedBy(layout, 'p:open0')
  const yE = group.branches[1].y

  const orthogonal = (points: readonly WirePoint[]): boolean =>
    points.every((point, index) => {
      const next = points[index + 1]
      return next === undefined || Math.abs(point.x - next.x) <= EPS || Math.abs(point.y - next.y) <= EPS
    })

  it('routes a shorter branch into the closing node in three points, the last two on x = closeX', () => {
    const route = parallelEdgeRoute(layout, rungEdge(rung, 'p:close0', 'input-down'))
    expect(route).toHaveLength(3)
    expect(route?.[0]).toEqual(handleAt(layout, 'E', 'output'))
    expect(route?.[1]).toEqual({ x: group.closeX, y: yE })
    expect(route?.[2]).toEqual(handleAt(layout, 'p:close0', 'input-down'))
    expect(route?.[2].x).toBeCloseTo(group.closeX, 6)
  })

  it('routes the top branch into the closing node as one straight two-point wire', () => {
    const route = parallelEdgeRoute(layout, rungEdge(rung, 'p:close0', 'input'))
    expect(route).toEqual([handleAt(layout, 'D', 'output'), handleAt(layout, 'p:close0', 'input')])
  })

  it('routes an edge out of the opening node down x = openX, then across to the element', () => {
    const route = parallelEdgeRoute(layout, edgeFrom(rung, 'p:open0', 'output-down'))
    expect(route?.[0]).toEqual(handleAt(layout, 'p:open0', 'output-down'))
    expect(route?.[0].x).toBeCloseTo(group.openX, 6)
    expect(route?.[1]).toEqual({ x: group.openX, y: yE })
    expect(route?.[route.length - 1]).toEqual(handleAt(layout, 'E', 'input'))
  })

  it('returns undefined for an edge that neither leaves an opening node nor ends on a closing one', () => {
    expect(parallelEdgeRoute(layout, rungEdge(rung, 'A', 'input'))).toBeUndefined()
    expect(parallelEdgeRoute(layout, rungEdge(rung, 'C', 'input'))).toBeUndefined()
  })

  it('draws every segment horizontal or vertical', () => {
    for (const wire of rung.edges) {
      const route = parallelEdgeRoute(layout, wire)
      if (route !== undefined)
        expect({ edge: wire.id, orthogonal: orthogonal(route) }).toEqual({ edge: wire.id, orthogonal: true })
    }
  })

  it("shifts every point of a route by its group's dx", () => {
    const wire = rungEdge(rung, 'p:close0', 'input-down')
    const plain = parallelEdgeRoute(layout, wire) ?? []
    const shifted = parallelEdgeRoute(layout, wire, () => 5) ?? []
    expect(shifted).toEqual(plain.map((point) => ({ x: point.x + 5, y: point.y })))
  })
})
