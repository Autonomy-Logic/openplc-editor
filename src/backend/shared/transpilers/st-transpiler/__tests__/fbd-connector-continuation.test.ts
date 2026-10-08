import { emitFbdBody } from '@root/backend/shared/transpilers/st-transpiler/walker/fbd'
import type { RFEdge, RFNode } from '@root/backend/shared/transpilers/st-transpiler/walker/types'

// Connector / continuation labels live in `data.variable.name`, the shape
// `buildConnectionNode` produces.

let edgeId = 0
const e = (s: string, t: string, sh: string | null, th: string | null): RFEdge => ({
  id: `e${edgeId++}`,
  source: s,
  target: t,
  sourceHandle: sh,
  targetHandle: th,
})
const inVar = (id: string, name: string, x: number, y: number): RFNode => ({
  id,
  type: 'input-variable',
  position: { x, y },
  data: { variant: 'input-variable', variable: { id: '', name }, executionOrder: 0, numericId: id },
})
const outVar = (id: string, name: string, x: number, y: number): RFNode => ({
  id,
  type: 'output-variable',
  position: { x, y },
  data: { variant: 'output-variable', variable: { id: '', name }, executionOrder: 0, numericId: id },
})
const connection = (id: string, variant: 'connector' | 'continuation', name: string, x: number, y: number): RFNode => ({
  id,
  type: variant,
  position: { x, y },
  data: { variant, variable: { id: 'connection', name }, executionOrder: 0, numericId: id },
})
const orBlock = (id: string, nid: string, x: number, y: number): RFNode => ({
  id,
  type: 'block',
  position: { x, y },
  data: {
    numericId: nid,
    executionOrder: 0,
    executionControl: false,
    variable: { name: '' },
    variant: {
      name: 'OR',
      type: 'function',
      extensible: true,
      variables: [
        { name: 'IN1', class: 'input', type: { definition: 'generic-type', value: 'ANY_BIT' } },
        { name: 'IN2', class: 'input', type: { definition: 'generic-type', value: 'ANY_BIT' } },
        { name: 'OUT', class: 'output', type: { definition: 'generic-type', value: 'ANY_BIT' } },
      ],
    },
  },
})
const srBlock = (id: string, instance: string, nid: string, x: number, y: number): RFNode => ({
  id,
  type: 'block',
  position: { x, y },
  data: {
    numericId: nid,
    executionOrder: 0,
    executionControl: false,
    variable: { name: instance },
    variant: {
      name: 'SR',
      type: 'function-block',
      extensible: false,
      variables: [
        { name: 'S1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
    },
  },
})

describe('FBD connector / continuation pairs', () => {
  it('feeds the connector expression into a function input (forum report: SR.Q1 -> FAULT -> OR.IN2)', () => {
    const { bodySt, warnings } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [
          inVar('1', 'S_FAULT', 0, 0),
          inVar('2', 'S_RESET', 0, 60),
          srBlock('SR', 'SR0', '100', 300, 0),
          connection('3', 'connector', 'FAULT', 500, 0),
          inVar('4', 'S_STOP', 0, 300),
          connection('5', 'continuation', 'FAULT', 200, 360),
          orBlock('OR', '200', 400, 300),
          outVar('6', 'STOP', 600, 300),
        ],
        edges: [
          e('1', 'SR', 'output', 'S1'),
          e('2', 'SR', 'output', 'R'),
          e('SR', '3', 'Q1', 'input'),
          e('4', 'OR', 'output', 'IN1'),
          e('5', 'OR', 'output', 'IN2'),
          e('OR', '6', 'OUT', 'input'),
        ],
      },
    })
    expect(warnings).toEqual([])
    expect(bodySt).toContain('SR0(S1 := S_FAULT, R := S_RESET);')
    expect(bodySt).toContain('OR(S_STOP, SR0.Q1)')
    expect(bodySt).toContain('STOP := _TMP_OR200_OUT;')
  })

  it('feeds the connector expression into a function block input', () => {
    const { bodySt, warnings } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [
          inVar('1', 'START', 0, 0),
          connection('2', 'connector', 'SET_IT', 200, 0),
          connection('3', 'continuation', 'SET_IT', 0, 200),
          inVar('4', 'RESET', 0, 260),
          srBlock('SR', 'SR1', '100', 300, 200),
          outVar('5', 'LATCHED', 500, 200),
        ],
        edges: [
          e('1', '2', 'output', 'input'),
          e('3', 'SR', 'output', 'S1'),
          e('4', 'SR', 'output', 'R'),
          e('SR', '5', 'Q1', 'input'),
        ],
      },
    })
    expect(warnings).toEqual([])
    expect(bodySt).toContain('SR1(S1 := START, R := RESET);')
    expect(bodySt).toContain('LATCHED := SR1.Q1;')
  })

  it('resolves every continuation that shares the connector name', () => {
    const { bodySt, warnings } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [
          inVar('1', 'SOURCE', 0, 0),
          connection('2', 'connector', 'SHARED', 200, 0),
          connection('3', 'continuation', 'SHARED', 0, 200),
          outVar('4', 'COPY_A', 200, 200),
          connection('5', 'continuation', 'SHARED', 0, 300),
          outVar('6', 'COPY_B', 200, 300),
        ],
        edges: [e('1', '2', 'output', 'input'), e('3', '4', 'output', 'input'), e('5', '6', 'output', 'input')],
      },
    })
    expect(warnings).toEqual([])
    expect(bodySt).toContain('COPY_A := SOURCE;')
    expect(bodySt).toContain('COPY_B := SOURCE;')
  })

  it('falls back to data.name when the node has no variable', () => {
    const bare = (id: string, type: 'connector' | 'continuation', y: number): RFNode => ({
      id,
      type,
      position: { x: 200, y },
      data: { name: 'BARE' },
    })
    const { bodySt, warnings } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [
          inVar('1', 'SOURCE', 0, 0),
          bare('2', 'connector', 0),
          bare('3', 'continuation', 200),
          outVar('4', 'COPY', 400, 200),
        ],
        edges: [e('1', '2', 'output', 'input'), e('3', '4', 'output', 'input')],
      },
    })
    expect(warnings).toEqual([])
    expect(bodySt).toContain('COPY := SOURCE;')
  })

  it('does not pair through data.name when the editor label was cleared', () => {
    const cleared = (id: string, type: 'connector' | 'continuation', y: number): RFNode => ({
      id,
      type,
      position: { x: 200, y },
      data: { variant: type, variable: { id: 'connection', name: '' }, name: 'STALE' },
    })
    const { bodySt } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [
          inVar('1', 'SOURCE', 0, 0),
          cleared('2', 'connector', 0),
          cleared('3', 'continuation', 200),
          outVar('4', 'COPY', 400, 200),
        ],
        edges: [e('1', '2', 'output', 'input'), e('3', '4', 'output', 'input')],
      },
    })
    expect(bodySt).not.toContain('COPY := SOURCE;')
  })

  it('warns instead of pairing when a continuation has no matching connector', () => {
    const { bodySt, warnings } = emitFbdBody({
      rung: {
        reactFlowViewport: [1000, 500],
        nodes: [connection('1', 'continuation', 'MISSING', 0, 0), outVar('2', 'OUT_VAR', 200, 0)],
        edges: [e('1', '2', 'output', 'input')],
      },
    })
    expect(warnings).toContain('continuation "MISSING" has no matching connector')
    expect(bodySt).not.toContain('OUT_VAR :=')
  })
})
