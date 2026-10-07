import { generateGraphicalPou } from '@root/backend/shared/transpilers/st-transpiler/emit/pou-graphical'
import type { TranspilePou, TranspileProject } from '@root/backend/shared/transpilers/st-transpiler/types'
import type { RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

/**
 * The type of a function block's output temporary (`_TMP_SEL…_OUT`) comes from
 * what its generic pins are wired to. A variable reached through an array
 * subscript, or spelled in another case than its declaration, used to resolve
 * to nothing, leaving the temporary declared `ANY`, which does not compile.
 */

let edgeId = 0
const e = (s: string, t: string, sh: string | null, th: string | null): RFEdge => ({
  id: `e${edgeId++}`,
  source: s,
  target: t,
  sourceHandle: sh,
  targetHandle: th,
})
const rail = (id: string, variant: 'left' | 'right', x: number): RFNode => ({
  id,
  type: 'powerRail',
  position: { x, y: 30 },
  data: { variant },
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
const sel = (id: string): RFNode => ({
  id: 'SEL',
  type: 'block',
  position: { x: 150, y: 30 },
  data: {
    numericId: id,
    executionOrder: 0,
    executionControl: false,
    variant: {
      name: 'SEL',
      type: 'function',
      extensible: false,
      variables: [
        { name: 'G', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'IN0', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
        { name: 'IN1', class: 'input', type: { definition: 'generic-type', value: 'ANY' } },
        { name: 'OUT', class: 'output', type: { definition: 'generic-type', value: 'ANY' } },
      ],
    },
  },
})

/** One rung: SEL(G := sw, IN0 := in0, IN1 := in1) -> target. */
const pouWithSel = (target: string, in0: string, in1: string, variables: TranspilePou['interface']['variables']) =>
  ({
    name: 'Main',
    pouType: 'program',
    interface: { variables },
    body: {
      language: 'ld',
      value: {
        rungs: [
          {
            reactFlowViewport: [800, 300],
            nodes: [
              rail('L', 'left', 0),
              inVar('901', 'sw', 30),
              inVar('902', in0, 80),
              inVar('903', in1, 120),
              sel('7001'),
              outVar('904', target),
              rail('R', 'right', 500),
            ],
            edges: [
              e('901', 'SEL', null, 'G'),
              e('902', 'SEL', null, 'IN0'),
              e('903', 'SEL', null, 'IN1'),
              e('SEL', '904', 'OUT', null),
            ],
          },
        ],
      },
    },
  }) as TranspilePou

const project = (pou: TranspilePou): TranspileProject =>
  ({
    dataTypes: [
      { name: 'E1', derivation: 'enumerated', values: [{ description: 'A0' }, { description: 'A1' }] },
      { name: 'Codes', derivation: 'array', dimensions: [{ dimension: '0..3' }], baseType: 'DINT' },
      {
        name: 'Plant',
        derivation: 'structure',
        variable: [
          {
            name: 'code',
            type: { definition: 'array', data: { dimensions: [{ dimension: '0..9' }], baseType: 'INT' } },
          },
          { name: 'grid', type: { definition: 'derived', value: 'Grid' } },
          { name: 'codes', type: { definition: 'derived', value: 'Codes' } },
          { name: 'mode', type: { definition: 'derived', value: 'E1' } },
        ],
      },
      {
        name: 'Grid',
        derivation: 'array',
        dimensions: [{ dimension: '0..1' }, { dimension: '0..1' }],
        baseType: 'REAL',
      },
    ],
    pous: [pou],
    configuration: { tasks: [], instances: [], globalVariables: [] },
  }) as TranspileProject

const text = (pou: TranspilePou): string =>
  generateGraphicalPou(pou, project(pou))
    .map(([chunk]) => chunk)
    .join('')

const plantVars: TranspilePou['interface']['variables'] = [
  { name: 'G', class: 'external', type: { definition: 'derived', value: 'Plant' } },
  { name: 'sw', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
  { name: 'i', class: 'local', type: { definition: 'base-type', value: 'INT' } },
]

describe('function-call temporaries take the type of the variable their output drives', () => {
  it('types the temporary from an array element of a structure member', () => {
    const st = text(pouWithSel('G.code[9]', '3', '4', plantVars))
    expect(st).toMatch(/_TMP_SEL7001_OUT : INT;/)
    expect(st).not.toMatch(/: ANY;/)
  })

  it('resolves a subscript with an expression, a named array type and two dimensions', () => {
    expect(text(pouWithSel('G.codes[i + 1]', '3', '4', plantVars))).toMatch(/_TMP_SEL7001_OUT : DINT;/)
    expect(text(pouWithSel('G.grid[0, 1]', '3', '4', plantVars))).toMatch(/_TMP_SEL7001_OUT : REAL;/)
  })

  it('matches names regardless of case, as IEC 61131-3 does', () => {
    expect(text(pouWithSel('g.CODE[9]', '3', '4', plantVars))).toMatch(/_TMP_SEL7001_OUT : INT;/)
  })

  it('types a SEL of an enumeration as the enumeration', () => {
    const vars: TranspilePou['interface']['variables'] = [
      ...plantVars,
      { name: 'a', class: 'local', type: { definition: 'derived', value: 'E1' } },
      { name: 'b', class: 'local', type: { definition: 'derived', value: 'E1' } },
    ]
    expect(text(pouWithSel('G.mode', 'a', 'b', vars))).toMatch(/_TMP_SEL7001_OUT : E1;/)
    expect(
      text(
        pouWithSel('r', 'a', 'b', [
          ...vars,
          { name: 'r', class: 'local', type: { definition: 'derived', value: 'E1' } },
        ]),
      ),
    ).toMatch(/_TMP_SEL7001_OUT : E1;/)
  })
})
