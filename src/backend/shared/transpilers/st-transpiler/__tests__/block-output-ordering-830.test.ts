import { emitLdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/ld'
import type { RFBody, RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

// Regression coverage for issue #830 — when function calls are chained in
// a rung, each block's output assignment must emit immediately after the
// call, so a downstream block reads the written value and not a stale one.

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
const inVar = (id: string, name: string, x: number, y: number): RFNode => ({
  id,
  type: 'variable',
  position: { x, y },
  data: { variant: 'input', variable: { name }, executionOrder: 0, numericId: id },
})
const outVar = (id: string, name: string, x: number, y: number): RFNode => ({
  id,
  type: 'variable',
  position: { x, y },
  data: { variant: 'output', variable: { name }, executionOrder: 0, numericId: id },
})
const coil = (id: string, name: string, x: number, y: number): RFNode => ({
  id,
  type: 'coil',
  position: { x, y },
  data: { variant: 'default', variable: { name }, executionOrder: 0, numericId: id },
})
const fblock = (id: string, name: string, nid: string, eo: number, x: number, y: number, outType = 'DINT'): RFNode => ({
  id,
  type: 'block',
  position: { x, y },
  data: {
    numericId: nid,
    executionOrder: eo,
    executionControl: true,
    variant: {
      name,
      type: 'function',
      extensible: false,
      variables: [
        { name: 'EN', class: 'input', type: { definition: 'generic-type', value: 'BOOL' } },
        { name: 'ENO', class: 'output', type: { definition: 'generic-type', value: 'BOOL' } },
        { name: 'OUT', class: 'output', type: { definition: 'base-type', value: outType } },
        { name: 'IN1', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'IN2', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
      ],
    },
  },
})

const call = (lhs: string, rhs: string): string => `  ${lhs} := ${rhs};\n`
const enoIf = (eno: string, v: string, val: string): string => `  IF ${eno} THEN\n      ${v} := ${val};\n  END_IF;\n`
const asg = (v: string, val: string): string => `  ${v} := ${val};\n`

describe('issue 830 — chained block output assignments emit before downstream calls', () => {
  it('writes a block output before the next block reads it (reported MOD->DIV chain)', () => {
    // MOD(EN:=TRUE) -> Output ; DIV(EN:=MOD.ENO, IN1:=Output) -> Output. Blocks numbered, writes at eo 0.
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [800, 300],
          nodes: [
            rail('L', 'left', 0),
            inVar('901', 'Input', 20, 80),
            inVar('902', '86400', 20, 120),
            fblock('MOD', 'MOD', '6363443', 1, 150, 30),
            outVar('903', 'Output', 320, 30),
            inVar('904', 'Output', 20, 200),
            inVar('905', '60', 20, 240),
            fblock('DIV', 'DIV', '4651235', 2, 450, 30),
            outVar('906', 'Output', 620, 30),
            rail('R', 'right', 760),
          ],
          edges: [
            e('L', 'MOD', 'left-rail', 'EN'),
            e('901', 'MOD', null, 'IN1'),
            e('902', 'MOD', null, 'IN2'),
            e('MOD', '903', 'OUT', null),
            e('MOD', 'DIV', 'ENO', 'EN'),
            e('904', 'DIV', null, 'IN1'),
            e('905', 'DIV', null, 'IN2'),
            e('DIV', '906', 'OUT', null),
          ],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        call('_TMP_MOD6363443_OUT', 'MOD(EN := TRUE, IN1 := Input, IN2 := 86400, ENO => _TMP_MOD6363443_ENO)') +
        enoIf('_TMP_MOD6363443_ENO', 'Output', '_TMP_MOD6363443_OUT') +
        call(
          '_TMP_DIV4651235_OUT',
          'DIV(EN := _TMP_MOD6363443_ENO, IN1 := Output, IN2 := 60, ENO => _TMP_DIV4651235_ENO)',
        ) +
        enoIf('_TMP_DIV4651235_ENO', 'Output', '_TMP_DIV4651235_OUT'),
    )
  })

  it('interleaves output writes for blocks pulled eagerly through a later block EN', () => {
    // MUL -> producto ; SUB(IN1:=producto) -> dif ; GT(EN := MUL.ENO OR SUB.ENO) -> flag.
    // No execution order: GT.EN pulls MUL and SUB; their writes must still land between the calls.
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [800, 300],
          nodes: [
            rail('L', 'left', 0),
            inVar('901', 'valor', 20, 80),
            inVar('902', 'k', 20, 120),
            fblock('MUL', 'MUL', '111', 0, 150, 30),
            outVar('903', 'producto', 320, 200),
            inVar('904', 'producto', 20, 160),
            inVar('905', 'k2', 20, 200),
            fblock('SUB', 'SUB', '222', 0, 150, 130),
            outVar('906', 'dif', 320, 260),
            fblock('GT', 'GT', '333', 0, 500, 30, 'BOOL'),
            outVar('907', 'flag', 660, 30),
            rail('R', 'right', 760),
          ],
          edges: [
            e('L', 'MUL', 'left-rail', 'EN'),
            e('901', 'MUL', null, 'IN1'),
            e('902', 'MUL', null, 'IN2'),
            e('MUL', '903', 'OUT', null),
            e('904', 'SUB', null, 'IN1'),
            e('905', 'SUB', null, 'IN2'),
            e('SUB', '906', 'OUT', null),
            e('MUL', 'GT', 'ENO', 'EN'),
            e('SUB', 'GT', 'ENO', 'EN'),
            e('GT', '907', 'OUT', null),
          ],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        call('_TMP_MUL111_OUT', 'MUL(EN := TRUE, IN1 := valor, IN2 := k, ENO => _TMP_MUL111_ENO)') +
        enoIf('_TMP_MUL111_ENO', 'producto', '_TMP_MUL111_OUT') +
        call('_TMP_SUB222_OUT', 'SUB(IN1 := producto, IN2 := k2, ENO => _TMP_SUB222_ENO)') +
        asg('dif', '_TMP_SUB222_OUT') +
        call('_TMP_GT333_OUT', 'GT(EN := _TMP_MUL111_ENO OR _TMP_SUB222_ENO, ENO => _TMP_GT333_ENO)') +
        enoIf('_TMP_GT333_ENO', 'flag', '_TMP_GT333_OUT'),
    )
  })

  it('writes a block-fed coil before the next block reads it', () => {
    // GEA -> coil Flag ; GEB(EN:=GEA.ENO, IN1:=Flag) -> coil Result.
    const body: RFBody = {
      rungs: [
        {
          reactFlowViewport: [800, 300],
          nodes: [
            rail('L', 'left', 0),
            inVar('901', 'Input', 20, 80),
            inVar('902', '86400', 20, 120),
            fblock('GEA', 'GE', '111', 1, 150, 30, 'BOOL'),
            coil('cFlag', 'Flag', 320, 30),
            inVar('904', 'Flag', 20, 200),
            inVar('905', '60', 20, 240),
            fblock('GEB', 'GE', '222', 2, 450, 30, 'BOOL'),
            coil('cRes', 'Result', 620, 30),
            rail('R', 'right', 760),
          ],
          edges: [
            e('L', 'GEA', 'left-rail', 'EN'),
            e('901', 'GEA', null, 'IN1'),
            e('902', 'GEA', null, 'IN2'),
            e('GEA', 'cFlag', 'OUT', null),
            e('GEA', 'GEB', 'ENO', 'EN'),
            e('904', 'GEB', null, 'IN1'),
            e('905', 'GEB', null, 'IN2'),
            e('GEB', 'cRes', 'OUT', null),
          ],
        },
      ],
    }
    const { bodySt, warnings } = emitLdBody(body)
    expect(warnings).toEqual([])
    expect(bodySt).toBe(
      '\n' +
        call('_TMP_GE111_OUT', 'GE(EN := TRUE, IN1 := Input, IN2 := 86400, ENO => _TMP_GE111_ENO)') +
        asg('Flag', '_TMP_GE111_OUT') +
        call('_TMP_GE222_OUT', 'GE(EN := _TMP_GE111_ENO, IN1 := Flag, IN2 := 60, ENO => _TMP_GE222_ENO)') +
        asg('Result', '_TMP_GE222_OUT'),
    )
  })
})
