import { generateGraphicalPou } from '@root/backend/shared/transpilers/st-transpiler/emit/pou-graphical'
import type { TranspilePou, TranspileProject } from '@root/backend/shared/transpilers/st-transpiler/types'
import type { RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

/**
 * Arguments of an extensible block (ADD, OR, MUX, ...) on LD and FBD bodies.
 *
 * Two wires into one extensible pin used to give two arguments for it,
 * `ADD(IN1 := a, IN1 := a, ...)`, copied from the old Python generator. That
 * counted the input twice, and STruC++ now rejects it ("given input 'IN1'
 * twice"). A pin is one argument; several wires into it are OR-ed, the same as
 * on a pin of a block that is not extensible.
 *
 * And an unwired pin in the middle of an extensible block used to drop out of a
 * POSITIONAL call, moving every later wire down one place: `MUX(k, a, c)` sent
 * `c` to IN1. The call is named whenever a pin is unwired, so the gap stays a
 * gap — which STruC++ reports for MUX ("missing input IN1") and `check --lint`
 * explains.
 */

let edgeId = 0
const e = (s: string, t: string, th: string | null): RFEdge => ({
  id: `e${edgeId++}`,
  source: s,
  target: t,
  sourceHandle: null,
  targetHandle: th,
})
const inVar = (id: string, name: string, y: number): RFNode => ({
  id,
  type: 'variable',
  position: { x: 20, y },
  data: { variant: 'input', variable: { name }, executionOrder: 0, numericId: id },
})
const outVar = (id: string, name: string): RFNode => ({
  id,
  type: 'variable',
  position: { x: 320, y: 30 },
  data: { variant: 'output', variable: { name }, executionOrder: 0, numericId: id },
})
const pin = (name: string, type: string, cls: 'input' | 'output' = 'input') => ({
  name,
  class: cls,
  type: { definition: type === 'ANY' ? 'generic-type' : 'base-type', value: type },
})
const block = (name: string, inputs: Array<[string, string]>, outType: string): RFNode => ({
  id: 'B',
  type: 'block',
  position: { x: 150, y: 30 },
  data: {
    numericId: '7001',
    executionOrder: 0,
    executionControl: false,
    variant: {
      name,
      type: 'function',
      extensible: true,
      variables: [...inputs.map(([n, t]) => pin(n, t)), pin('OUT', outType, 'output')],
    },
  },
})

const BOOL = (name: string) => ({ name, class: 'local', type: { definition: 'base-type', value: 'BOOL' } })
const INT = (name: string) => ({ name, class: 'local', type: { definition: 'base-type', value: 'INT' } })

function pou(language: 'ld' | 'fbd', nodes: RFNode[], edges: RFEdge[], variables: unknown[]): TranspilePou {
  const rung = { reactFlowViewport: [800, 300], nodes, edges }
  return {
    name: 'Main',
    pouType: 'program',
    interface: { variables },
    body: { language, value: language === 'ld' ? { rungs: [rung] } : { rung } },
  } as unknown as TranspilePou
}

const text = (p: TranspilePou): string =>
  generateGraphicalPou(p, {
    dataTypes: [],
    pous: [p],
    configuration: { tasks: [], instances: [], globalVariables: [] },
  } as unknown as TranspileProject)
    .map(([chunk]) => chunk)
    .join('')

/** The argument list of the block's call. */
const callOf = (st: string, name: string): string => new RegExp(`:= ${name}\\(([^;]*)\\);`).exec(st)?.[1] ?? ''

describe.each(['ld', 'fbd'] as const)('extensible block arguments on %s', (language) => {
  it('gives ADD one IN1 for two wires into it', () => {
    const st = text(
      pou(
        language,
        [
          inVar('1', 'a', 30),
          inVar('2', 'b', 60),
          inVar('3', 'c', 90),
          block(
            'ADD',
            [
              ['IN1', 'ANY'],
              ['IN2', 'ANY'],
            ],
            'ANY',
          ),
          outVar('9', 'x'),
        ],
        [e('1', 'B', 'IN1'), e('2', 'B', 'IN1'), e('3', 'B', 'IN2'), e('B', '9', null)],
        [INT('a'), INT('b'), INT('c'), INT('x')],
      ),
    )
    // Two wires, one input: both are in it, once — OR-ed, as on a pin of a
    // block that is not extensible.
    expect(callOf(st, 'ADD')).toBe('a OR b, c')
  })

  it('ORs two BOOL wires into one pin of OR', () => {
    const st = text(
      pou(
        language,
        [
          inVar('1', 'p', 30),
          inVar('2', 'q', 60),
          inVar('3', 'r', 90),
          block(
            'OR',
            [
              ['IN1', 'ANY'],
              ['IN2', 'ANY'],
            ],
            'ANY',
          ),
          outVar('9', 'y'),
        ],
        [e('1', 'B', 'IN1'), e('2', 'B', 'IN1'), e('3', 'B', 'IN2'), e('B', '9', null)],
        [BOOL('p'), BOOL('q'), BOOL('r'), BOOL('y')],
      ),
    )
    expect(callOf(st, 'OR')).toBe('p OR q, r')
  })

  it('keeps an unwired middle pin of MUX a gap, by name, rather than shifting the wires after it', () => {
    const st = text(
      pou(
        language,
        [
          inVar('1', 'k', 30),
          inVar('2', 'a', 60),
          inVar('3', 'c', 90),
          block(
            'MUX',
            [
              ['K', 'INT'],
              ['IN0', 'ANY'],
              ['IN1', 'ANY'],
              ['IN2', 'ANY'],
            ],
            'ANY',
          ),
          outVar('9', 'x'),
        ],
        [e('1', 'B', 'K'), e('2', 'B', 'IN0'), e('3', 'B', 'IN2'), e('B', '9', null)],
        [INT('k'), INT('a'), INT('c'), INT('x')],
      ),
    )
    expect(callOf(st, 'MUX')).toBe('K := k, IN0 := a, IN2 := c')
  })
})
