/**
 * The LD walker's sink order, extracted so code outside `backend/shared` can check emission order.
 * @jest-environment node
 * @vitest-environment node
 */
import {
  CORPUS_PROJECTS,
  ldPouNames,
  ldPouRungs,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import { asBlockData, asCoilData, asVariableData } from '@root/backend/shared/transpilers/st-transpiler/walker/narrow'
import type { RFEdge, RFNode, RFRung } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

import { compareLdNodePosition, type LdOrderNode, type LdOrderRung, ldRungYOffsets, ldSinkOrder } from '../sink-order'

interface TestRung {
  nodes: RFNode[]
  edges: RFEdge[]
  reactFlowViewport?: number[]
}

const at = (id: string, type: string, x: number, y: number, data: Record<string, unknown>): RFNode => ({
  id,
  type,
  position: { x, y },
  data,
})
const coil = (id: string, x: number, y: number, executionOrder = 0, name = id): RFNode =>
  at(id, 'coil', x, y, { variant: 'default', variable: { name }, executionOrder })
const contact = (id: string, x: number, y: number): RFNode =>
  at(id, 'contact', x, y, { variant: 'default', variable: { name: id } })
const variable = (
  id: string,
  variant: 'input' | 'output' | 'inout',
  x: number,
  y: number,
  executionOrder = 0,
  name = id,
): RFNode => at(id, 'variable', x, y, { variant, variable: { name }, executionOrder })
const block = (id: string, x: number, y: number, executionOrder = 0): RFNode =>
  at(id, 'block', x, y, {
    variant: { name: 'TON', type: 'function-block', variables: [] },
    variable: { name: `${id}_inst` },
    executionOrder,
  })
const connector = (id: string, x: number, y: number, executionOrder?: number): RFNode =>
  at(id, 'connector', x, y, { variable: { name: id }, ...(executionOrder === undefined ? {} : { executionOrder }) })
const rail = (id: string, variant: 'left' | 'right', x: number): RFNode => at(id, 'powerRail', x, 30, { variant })
const parallel = (id: string, x: number): RFNode => at(id, 'parallel', x, 38, { type: 'open' })
const rung = (nodes: RFNode[], height?: number): TestRung => ({
  nodes,
  edges: [],
  ...(height === undefined ? {} : { reactFlowViewport: [600, height] }),
})
const node = (id: string, x: number, y: number): LdOrderNode => ({ id, type: 'coil', position: { x, y } })
const sign = (value: number): number => Math.sign(value)

/** The walker's execution order of a sink, read as `walker/ld.ts` reads it today. */
function referenceExecutionOrder(sink: RFNode): number {
  if (sink.type === 'coil') return asCoilData(sink.data)?.executionOrder ?? 0
  if (sink.type === 'block') return asBlockData(sink.data)?.executionOrder ?? 0
  if (['variable', 'input-variable', 'output-variable', 'inout-variable'].includes(sink.type)) {
    return asVariableData(sink.data)?.executionOrder ?? 0
  }
  return 0
}

/**
 * Oracle: a copy of today's sink collection and sort in `walker/ld.ts` (cumulative rung offsets, sink classes,
 * ordered bucket, then the position comparator through `Array.prototype.sort`), independent of `sink-order.ts`.
 */
function referenceSinkOrder(rungs: readonly RFRung[]): string[] {
  const yOffset = new Map<string, number>()
  let cumulative = 0
  for (const each of rungs) {
    for (const n of each.nodes) yOffset.set(n.id, cumulative)
    const viewport = each.reactFlowViewport
    cumulative +=
      Array.isArray(viewport) && typeof viewport[1] === 'number' && Number.isFinite(viewport[1]) ? viewport[1] : 0
  }
  const sinks: RFNode[] = []
  for (const each of rungs) {
    for (const n of each.nodes) {
      if (n.type === 'coil') {
        if (asCoilData(n.data)?.variable) sinks.push(n)
      } else if (['variable', 'input-variable', 'output-variable', 'inout-variable'].includes(n.type)) {
        const data = asVariableData(n.data)
        if (data !== null && data.variable !== '' && (data.variant === 'output' || data.variant === 'inout')) {
          sinks.push(n)
        }
      } else if (n.type === 'block' || n.type === 'connector') {
        sinks.push(n)
      }
    }
  }
  const position = (a: RFNode, b: RFNode): number => {
    const ay = Math.trunc(a.position.y + (yOffset.get(a.id) ?? 0))
    const by = Math.trunc(b.position.y + (yOffset.get(b.id) ?? 0))
    if (Math.abs(ay - by) >= 10) return ay - by
    return Math.trunc(a.position.x) - Math.trunc(b.position.x)
  }
  const ordered = sinks.filter((s) => referenceExecutionOrder(s) > 0)
  const others = sinks.filter((s) => referenceExecutionOrder(s) <= 0)
  ordered.sort((a, b) => referenceExecutionOrder(a) - referenceExecutionOrder(b))
  others.sort(position)
  return [...ordered, ...others].map((s) => s.id)
}

/** A projected rung as an `LdOrderRung`; a non-number viewport entry becomes NaN, which both sides read as 0. */
function toOrderRung(projected: RFRung): LdOrderRung {
  const viewport = projected.reactFlowViewport
  return {
    nodes: projected.nodes,
    reactFlowViewport: Array.isArray(viewport)
      ? viewport.map((value: unknown) => (typeof value === 'number' ? value : Number.NaN))
      : undefined,
  }
}

describe('ldRungYOffsets', () => {
  it('gives each node the summed viewport heights of the rungs before it', () => {
    const offsets = ldRungYOffsets([
      rung([coil('a', 0, 0), coil('b', 0, 50)], 120),
      rung([coil('c', 0, 0)], 200),
      rung([coil('d', 0, 0)]),
    ])
    expect(Object.fromEntries(offsets)).toEqual({ a: 0, b: 0, c: 120, d: 320 })
  })

  it('adds 0 for a rung whose viewport height is missing, NaN or infinite', () => {
    const offsets = ldRungYOffsets([
      rung([coil('a', 0, 0)]),
      { nodes: [coil('b', 0, 0)], reactFlowViewport: [600, Number.NaN] },
      { nodes: [coil('c', 0, 0)], reactFlowViewport: [600, Number.POSITIVE_INFINITY] },
      { nodes: [coil('d', 0, 0)], reactFlowViewport: [600] },
      rung([coil('e', 0, 0)], 50),
      rung([coil('f', 0, 0)]),
    ])
    expect(Object.fromEntries(offsets)).toEqual({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 50 })
  })
})

describe('compareLdNodePosition', () => {
  const none = new Map<string, number>()

  it('orders by Y when the truncated Y values differ by 10 or more, whatever the X', () => {
    expect(sign(compareLdNodePosition(node('a', 100, 0), node('b', 0, 10), none))).toBe(-1)
    expect(sign(compareLdNodePosition(node('b', 0, 10), node('a', 100, 0), none))).toBe(1)
  })

  it('orders by X when the truncated Y values differ by less than 10', () => {
    expect(sign(compareLdNodePosition(node('a', 100, 0), node('b', 0, 9), none))).toBe(1)
    expect(sign(compareLdNodePosition(node('b', 0, 9), node('a', 100, 0), none))).toBe(-1)
  })

  it('truncates Y before measuring the 10-unit band', () => {
    expect(sign(compareLdNodePosition(node('a', 100, 0.5), node('b', 0, 10.4), none))).toBe(-1)
  })

  it('truncates X before the tie-break, so 5.9 and 5.1 on one band compare equal', () => {
    expect(Math.abs(compareLdNodePosition(node('a', 5.9, 20), node('b', 5.1, 22), none))).toBe(0)
  })

  it("adds each node's rung offset to its Y before comparing", () => {
    const offsets = new Map([
      ['a', 0],
      ['b', 10],
    ])
    expect(sign(compareLdNodePosition(node('a', 100, 5), node('b', 0, 5), offsets))).toBe(-1)
  })

  it('truncates Y plus offset as one value', () => {
    const offsets = new Map([['a', 9.4]])
    expect(sign(compareLdNodePosition(node('a', 100, 0.7), node('b', 200, 0), offsets))).toBe(1)
  })

  it('counts a node missing from the offset map as offset 0', () => {
    const offsets = new Map([['b', 10]])
    expect(sign(compareLdNodePosition(node('a', 100, 5), node('b', 0, 5), offsets))).toBe(-1)
  })
})

describe('ldSinkOrder', () => {
  it('lists the sinks with execution order > 0 first, ascending, then the others by position', () => {
    const body = [
      rung([coil('c1', 0, 0), block('b2', 0, 100, 2), variable('v1', 'output', 0, 200, 1), coil('c3', 0, 50)]),
    ]
    expect(ldSinkOrder(body)).toEqual(['v1', 'b2', 'c1', 'c3'])
  })

  it('keeps the input order of sinks with the same execution order, whatever their position', () => {
    const body = [rung([coil('first', 0, 100, 3), coil('second', 0, 0, 3)])]
    expect(ldSinkOrder(body)).toEqual(['first', 'second'])
  })

  it('reads the execution order of coils, blocks and variable nodes, never of connectors', () => {
    const body = [
      rung([connector('k', 0, 0, 5), coil('c', 0, 100, 1), block('b', 0, 200, 2), variable('v', 'inout', 0, 300, 3)]),
    ]
    expect(ldSinkOrder(body)).toEqual(['c', 'b', 'v', 'k'])
  })

  it('includes blocks and connectors among the unordered sinks', () => {
    const body = [rung([block('b', 0, 40), connector('k', 0, 20), coil('c', 0, 0)])]
    expect(ldSinkOrder(body)).toEqual(['c', 'k', 'b'])
  })

  it('leaves out contacts, input variables, rails, parallels, empty-name variables and coils without a variable', () => {
    const body = [
      rung([
        rail('left', 'left', 0),
        contact('x', 10, 0),
        parallel('p', 20),
        variable('in', 'input', 30, 0),
        variable('noname', 'output', 40, 0, 0, ''),
        coil('nocoil', 50, 0, 0, ''),
        variable('out', 'output', 60, 0),
        variable('io', 'inout', 70, 0),
        rail('right', 'right', 80),
      ]),
    ]
    expect(ldSinkOrder(body)).toEqual(['out', 'io'])
  })

  it('sorts across rungs with the cumulative offsets: 5 units apart globally falls back to X', () => {
    const body = [rung([coil('a', 0, 95)], 100), rung([coil('b', 300, 0)])]
    expect(ldSinkOrder(body)).toEqual(['a', 'b'])
  })

  it('starts from rung order then node array order, so equal positions keep that order', () => {
    expect(ldSinkOrder([rung([coil('p', 10, 10), coil('q', 10, 10)])])).toEqual(['p', 'q'])
    expect(ldSinkOrder([rung([coil('q', 10, 10), coil('p', 10, 10)])])).toEqual(['q', 'p'])
    expect(ldSinkOrder([rung([coil('q', 10, 10)], 0), rung([coil('p', 10, 10)])])).toEqual(['q', 'p'])
  })

  it('reproduces Array.prototype.sort on the non-transitive 10-unit band', () => {
    const body = [
      rung([coil('n1', 300, 0), coil('n2', 200, 8), coil('n3', 100, 16), coil('n4', 0, 24), coil('n5', 250, 4)]),
    ]
    expect(ldSinkOrder(body)).toEqual(['n5', 'n4', 'n3', 'n2', 'n1'])
    expect(ldSinkOrder(body)).toEqual(referenceSinkOrder(body))
  })

  it('accepts store rungs: nodes with an optional type and unknown data', () => {
    const storeRung = {
      nodes: [
        { id: 'c', type: 'coil', position: { x: 0, y: 0 }, data: { variant: 'default', variable: { name: 'c' } } },
        { id: 'none', position: { x: 0, y: 0 }, data: {} },
      ],
      reactFlowViewport: [600, 120],
    }
    expect(ldSinkOrder([storeRung])).toEqual(['c'])
  })
})

describe('ldSinkOrder on crafted B12 rungs (execution-order-mixed)', () => {
  type Spot = { x: number; y: number }

  /** Three rungs whose ordered sinks (execution order > 0) sit at the given spots among unordered sinks. */
  const b12 = (spots: { b1: Spot; k2: Spot; v3: Spot }): TestRung[] => [
    rung(
      [contact('a', 50, 38), coil('u1', 300, 38), block('b1', spots.b1.x, spots.b1.y, 2), coil('u2', 300, 138)],
      200,
    ),
    rung([coil('k2', spots.k2.x, spots.k2.y, 3), block('u3', 200, 38), connector('u4', 400, 90)], 150),
    rung([variable('v3', 'output', spots.v3.x, spots.v3.y, 1), coil('u5', 100, 0), variable('u6', 'inout', 500, 60)]),
  ]
  const placed = { b1: { x: 150, y: 38 }, k2: { x: 300, y: 38 }, v3: { x: 450, y: 38 } }
  const moved = { b1: { x: 600, y: 180 }, k2: { x: 20, y: 0 }, v3: { x: 10, y: 400 } }

  it('emits the sinks with execution order > 0 first, by that order, then the others by position across rungs', () => {
    expect(ldSinkOrder(b12(placed))).toEqual(['v3', 'b1', 'k2', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  })

  it('keeps the same order after the ordered sinks move', () => {
    expect(ldSinkOrder(b12(moved))).toEqual(ldSinkOrder(b12(placed)))
  })

  it("equals the walker's emission order on the crafted rungs, before and after the move", () => {
    expect(ldSinkOrder(b12(placed))).toEqual(referenceSinkOrder(b12(placed)))
    expect(ldSinkOrder(b12(moved))).toEqual(referenceSinkOrder(b12(moved)))
  })
})

describe('ldSinkOrder on the corpus', () => {
  for (const project of CORPUS_PROJECTS) {
    it(`equals the walker's emission order on every LD POU of ${project}`, () => {
      const data = loadCorpusProject(project)
      const pous = ldPouNames(data)
      expect(pous.length).toBeGreaterThan(0)
      for (const pou of pous) {
        const rungs = ldPouRungs(data, pou)
        expect({ pou, order: ldSinkOrder(rungs.map(toOrderRung)) }).toEqual({ pou, order: referenceSinkOrder(rungs) })
      }
    })
  }
})
