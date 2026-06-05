import type { FBDRungState } from '@root/frontend/store/slices'
import type { Node } from '@xyflow/react'

import { fbdToXml } from '../fbd-xml'

const makeHandle = (id: string, x = 0, y = 0) => ({
  id,
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x, y },
  relPosition: { x, y },
})

const makeRung = (overrides: Partial<FBDRungState> = {}): FBDRungState => ({
  comment: '',
  selectedNodes: [],
  nodes: [],
  edges: [],
  ...overrides,
})

describe('fbdToXml (codesys)', () => {
  it('returns empty FBD body for an empty rung', () => {
    const result = fbdToXml(makeRung())
    expect(result.body.FBD.block).toEqual([])
    expect(result.body.FBD.inVariable).toEqual([])
    expect(result.body.FBD.outVariable).toEqual([])
    expect(result.body.FBD.connector).toEqual([])
    expect(result.body.FBD.continuation).toEqual([])
    expect(result.body.FBD.comment).toEqual([])
  })

  it('converts an input-variable node', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'iv1',
          type: 'input-variable',
          position: { x: 10, y: 20 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            negated: false,
            variable: { name: 'myInput' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'input-variable',
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.inVariable).toHaveLength(1)
    const iv = result.body.FBD.inVariable[0]
    expect(iv['@localId']).toBe('1')
    expect(iv['@executionOrderId']).toBe(0)
    expect(iv['@negated']).toBe(false)
    expect(iv['@width']).toBe(80)
    expect(iv['@height']).toBe(30)
    expect(iv.position).toEqual({ '@x': 10, '@y': 20 })
    expect(iv.connectionPointOut).toBe('')
    expect(iv.expression).toBe('myInput')
  })

  it('converts an output-variable node with connection', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'src1',
          type: 'input-variable',
          position: { x: 0, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            variable: { name: 'in' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'out',
              type: 'source',
              position: 'right',
              glbPosition: { x: 80, y: 15 },
              relPosition: { x: 80, y: 15 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            negated: false,
            variant: 'input-variable',
          },
        } as unknown as Node,
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '2',
            executionOrder: 1,
            negated: true,
            variable: { name: 'myOutput' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'out',
              type: 'source',
              position: 'right',
              glbPosition: { x: 280, y: 15 },
              relPosition: { x: 80, y: 15 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'src1', target: 'ov1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.outVariable).toHaveLength(1)
    const ov = result.body.FBD.outVariable[0]
    expect(ov['@localId']).toBe('2')
    expect(ov['@negated']).toBe(true)
    expect(ov.expression).toBe('myOutput')
    expect(ov.connectionPointIn.connection).toHaveLength(1)
    expect(ov.connectionPointIn.connection[0]['@refLocalId']).toBe('1')
  })

  it('skips output-variable when no valid connections exist', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '2',
            executionOrder: 1,
            negated: false,
            variable: { name: 'out' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'out',
              type: 'source',
              position: 'right',
              glbPosition: { x: 0, y: 0 },
              relPosition: { x: 0, y: 0 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.outVariable).toHaveLength(0)
  })

  it('filters out undefined connections from output-variable', () => {
    // Source node exists but edge sourceHandle doesn't match outputConnector id,
    // AND sourceNode is found so refLocalId is 'undefined' (the string), which gets filtered
    const rung = makeRung({
      nodes: [
        {
          id: 'src1',
          type: 'input-variable',
          position: { x: 0, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            negated: false,
            variable: { name: 'in' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'input-variable',
          },
        } as unknown as Node,
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '2',
            executionOrder: 1,
            negated: false,
            variable: { name: 'out' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'out-conn',
              type: 'source',
              position: 'right',
              glbPosition: { x: 0, y: 0 },
              relPosition: { x: 0, y: 0 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [
        // Edge from src1 but sourceHandle 'mismatched' doesn't match outputConnector (undefined), so refLocalId='undefined'
        { id: 'e1', source: 'src1', target: 'ov1', sourceHandle: 'mismatched', targetHandle: 'in' },
      ],
    })
    const result = fbdToXml(rung)
    // All connections filtered (refLocalId is 'undefined'), so outputVariableToXml returns undefined
    // and the outVariable is not added to the array
    expect(result.body.FBD.outVariable).toHaveLength(0)
  })

  it('converts a block node', () => {
    const inputHandle = makeHandle('EN', 10, 20)
    const outputHandle = makeHandle('OUT', 90, 20)
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 100, y: 50 },
          width: 120,
          height: 60,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: 'addInst' },
            handles: [],
            inputHandles: [inputHandle],
            outputHandles: [outputHandle],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.block).toHaveLength(1)
    const block = result.body.FBD.block[0]
    expect(block['@localId']).toBe('3')
    expect(block['@typeName']).toBe('ADD')
    expect(block['@instanceName']).toBeUndefined()
    expect(block.position).toEqual({ '@x': 100, '@y': 50 })
    expect(block.inputVariables.variable).toHaveLength(1)
    expect(block.outputVariables.variable).toHaveLength(1)
    expect(block.inOutVariables).toBe('')
  })

  it('sets instanceName for function-block variant', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '5',
            executionOrder: 0,
            variant: { name: 'TON', type: 'function-block' },
            variable: { name: 'timer1' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.block[0]['@instanceName']).toBe('timer1')
  })

  it('converts block input with edge from another block (sourceHandle OUT replaced with spaces)', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '10',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'b2',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '11',
            executionOrder: 1,
            variant: { name: 'MUL', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'b2', sourceHandle: 'OUT', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    const b2 = result.body.FBD.block[1]
    const conn = b2.inputVariables.variable[0].connectionPointIn.connection[0]
    expect(conn['@refLocalId']).toBe('10')
    expect(conn['@formalParameter']).toBe('   ')
  })

  it('converts block input with edge from block using non-OUT handle', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '10',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('RESULT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'b2',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '11',
            executionOrder: 1,
            variant: { name: 'MUL', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'b2', sourceHandle: 'RESULT', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    const b2 = result.body.FBD.block[1]
    const conn = b2.inputVariables.variable[0].connectionPointIn.connection[0]
    expect(conn['@formalParameter']).toBe('RESULT')
  })

  it('converts block input with edge from non-block source (no formalParameter)', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'iv1',
          type: 'input-variable',
          position: { x: 0, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            variable: { name: 'x' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('out')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            negated: false,
            variant: 'input-variable',
          },
        } as unknown as Node,
        {
          id: 'b1',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '2',
            executionOrder: 1,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'iv1', target: 'b1', sourceHandle: 'out', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    const conn = result.body.FBD.block[0].inputVariables.variable[0].connectionPointIn.connection[0]
    expect(conn['@formalParameter']).toBeUndefined()
  })

  it('block input handle with no edges returns empty connection array', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    const iv = result.body.FBD.block[0].inputVariables.variable[0]
    expect(iv.connectionPointIn.connection).toEqual([])
  })

  it('block output with OUT handle replaced by spaces', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '4',
            executionOrder: 1,
            negated: false,
            variable: { name: 'result' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'ov1', sourceHandle: 'OUT', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    const outVar = result.body.FBD.block[0].outputVariables.variable[0]
    expect(outVar['@formalParameter']).toBe('   ')
  })

  it('block output with non-variable target has undefined expression at index 0', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'b2',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '4',
            executionOrder: 1,
            variant: { name: 'MUL', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'b2', sourceHandle: 'OUT', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    // First output handle at index 0: expression should be undefined
    const outVar = result.body.FBD.block[0].outputVariables.variable[0]
    expect(outVar.connectionPointOut.expression).toBeUndefined()
  })

  it('block output at index > 0 connected to variable includes expression', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT'), makeHandle('ENO')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '4',
            executionOrder: 1,
            negated: false,
            variable: { name: 'flag' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'ov1', sourceHandle: 'ENO', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    // Second output (index 1) connected to a variable node
    const outVar = result.body.FBD.block[0].outputVariables.variable[1]
    expect(outVar.connectionPointOut.expression).toBe('flag')
  })

  it('converts a connector node', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'src1',
          type: 'input-variable',
          position: { x: 0, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            variable: { name: 'x' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            negated: false,
            variant: 'input-variable',
          },
        } as unknown as Node,
        {
          id: 'conn1',
          type: 'connector',
          position: { x: 100, y: 0 },
          width: 60,
          height: 30,
          data: {
            numericId: '2',
            variable: { name: 'label1' },
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 100, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'connector',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'src1', target: 'conn1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.connector).toHaveLength(1)
    const conn = result.body.FBD.connector[0]
    expect(conn['@name']).toBe('label1')
    expect(conn['@localId']).toBe('2')
    expect(conn.connectionPointIn.connection).toHaveLength(1)
  })

  it('converts a continuation node', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'cont1',
          type: 'continuation',
          position: { x: 300, y: 0 },
          width: 60,
          height: 30,
          data: {
            numericId: '5',
            variable: { name: 'label1' },
            inputConnector: undefined,
            outputConnector: {
              id: 'out',
              type: 'source',
              position: 'right',
              glbPosition: { x: 360, y: 15 },
              relPosition: { x: 60, y: 15 },
            },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'continuation',
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.continuation).toHaveLength(1)
    const cont = result.body.FBD.continuation[0]
    expect(cont['@name']).toBe('label1')
    expect(cont['@localId']).toBe('5')
    expect(cont.connectionPointOut.relPosition).toEqual({ '@x': 60, '@y': 15 })
  })

  it('converts a comment node', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'c1',
          type: 'comment',
          position: { x: 50, y: 100 },
          width: 200,
          height: 40,
          data: {
            numericId: '6',
            content: 'This is a comment',
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.comment).toHaveLength(1)
    const c = result.body.FBD.comment[0]
    expect(c['@localId']).toBe('6')
    expect(c['@width']).toBe(200)
    expect(c['@height']).toBe(40)
    expect(c.content.xhtml.$).toBe('This is a comment')
    expect(c.content.xhtml['@xmlns']).toBe('http://www.w3.org/1999/xhtml')
  })

  it('comment node falls back to measured dimensions when width/height are null', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'c1',
          type: 'comment',
          position: { x: 0, y: 0 },
          width: null,
          height: null,
          measured: { width: 150, height: 35 },
          data: {
            numericId: '7',
            content: 'test',
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.comment[0]['@width']).toBe(150)
    expect(result.body.FBD.comment[0]['@height']).toBe(35)
  })

  it('skips unknown node types', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'unknown1',
          type: 'custom-unknown',
          position: { x: 0, y: 0 },
          data: {},
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.block).toHaveLength(0)
    expect(result.body.FBD.inVariable).toHaveLength(0)
  })

  it('connector with block source uses formalParameter from edge sourceHandle (OUT replaced)', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '10',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'conn1',
          type: 'connector',
          position: { x: 200, y: 0 },
          width: 60,
          height: 30,
          data: {
            numericId: '11',
            variable: { name: 'L' },
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 200, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'connector',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'conn1', sourceHandle: 'OUT', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    const connXml = result.body.FBD.connector[0]
    expect(connXml.connectionPointIn.connection[0]['@formalParameter']).toBe('   ')
  })

  it('output-variable filters out undefined refLocalId connections', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'src1',
          type: 'input-variable',
          position: { x: 0, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '1',
            executionOrder: 0,
            variable: { name: 'x' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'myOut',
              type: 'source',
              position: 'right',
              glbPosition: { x: 0, y: 0 },
              relPosition: { x: 0, y: 0 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            negated: false,
            variant: 'input-variable',
          },
        } as unknown as Node,
        {
          id: 'ov1',
          type: 'output-variable',
          position: { x: 200, y: 0 },
          width: 80,
          height: 30,
          data: {
            numericId: '2',
            executionOrder: 1,
            negated: false,
            variable: { name: 'out' },
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: {
              id: 'myOut',
              type: 'source',
              position: 'right',
              glbPosition: { x: 0, y: 0 },
              relPosition: { x: 0, y: 0 },
            },
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [
        // Valid edge with matching output connector
        { id: 'e1', source: 'src1', target: 'ov1', sourceHandle: 'myOut', targetHandle: 'in' },
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.outVariable).toHaveLength(1)
  })

  it('block output handle with no edges has empty connection array', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    const ov = result.body.FBD.block[0].outputVariables.variable[0]
    expect(ov.connectionPointOut.expression).toBeUndefined()
  })

  it('block input filters out edges where source node is not found', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '2',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'nonexistent', target: 'b1', sourceHandle: 'out', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    // Source node not found, so the connection is filtered out
    expect(result.body.FBD.block[0].inputVariables.variable).toHaveLength(0)
  })

  it('block output filters out edges where target node is not found', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'nonexistent', sourceHandle: 'OUT', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    // Target node not found, so the output variable is filtered out
    expect(result.body.FBD.block[0].outputVariables.variable).toHaveLength(0)
  })

  it('block output at non-zero index connected to non-variable has undefined expression', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT'), makeHandle('ENO')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
        {
          id: 'b2',
          type: 'block',
          position: { x: 200, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '4',
            executionOrder: 1,
            variant: { name: 'MUL', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1')],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'b2', sourceHandle: 'ENO', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    // ENO is at index 1, connected to block (not variable) so expression should be undefined
    const outVar = result.body.FBD.block[0].outputVariables.variable[1]
    expect(outVar.connectionPointOut.expression).toBeUndefined()
  })

  it('block output with no edges returns undefined expression', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'b1',
          type: 'block',
          position: { x: 0, y: 0 },
          width: 100,
          height: 50,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [],
            outputHandles: [makeHandle('OUT'), makeHandle('ENO')],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    // ENO at index 1 with no edges returns the no-edge path with undefined expression
    const outVar = result.body.FBD.block[0].outputVariables.variable[1]
    expect(outVar['@formalParameter']).toBe('ENO')
    expect(outVar.connectionPointOut.expression).toBeUndefined()
  })

  it('connector filters out edges where source node is not found', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'conn1',
          type: 'connector',
          position: { x: 100, y: 0 },
          width: 60,
          height: 30,
          data: {
            numericId: '2',
            variable: { name: 'label1' },
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 100, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'connector',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'nonexistent', target: 'conn1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.connector[0].connectionPointIn.connection).toHaveLength(0)
  })
})
