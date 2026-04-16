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

describe('fbdToXml (old-editor)', () => {
  it('returns empty FBD body for an empty rung', () => {
    const result = fbdToXml(makeRung())
    expect(result.body.FBD.block).toEqual([])
    expect(result.body.FBD.inVariable).toEqual([])
    expect(result.body.FBD.outVariable).toEqual([])
    expect(result.body.FBD.inOutVariable).toEqual([])
    expect(result.body.FBD.connector).toEqual([])
    expect(result.body.FBD.continuation).toEqual([])
    expect(result.body.FBD.comment).toEqual([])
  })

  it('converts an input-variable node with relPosition', () => {
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
            outputConnector: {
              id: 'out',
              type: 'source',
              position: 'right',
              glbPosition: { x: 90, y: 35 },
              relPosition: { x: 80, y: 15 },
            },
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
    expect(iv.connectionPointOut.relPosition).toEqual({ '@x': 80, '@y': 15 })
    expect(iv.expression).toBe('myInput')
  })

  it('converts an output-variable node with connections', () => {
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
            outputHandles: [makeHandle('out', 80, 15)],
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
            inputHandles: [makeHandle('in', 200, 15)],
            outputHandles: [],
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 200, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
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
    // Non-block source should not have formalParameter
    expect(ov.connectionPointIn.connection[0]['@formalParameter']).toBeUndefined()
  })

  it('output-variable filters out undefined connections (source not found)', () => {
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
            inputHandles: [makeHandle('in', 200, 15)],
            outputHandles: [],
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 200, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'nonexistent', target: 'ov1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.outVariable[0].connectionPointIn.connection).toHaveLength(0)
  })

  it('converts a block node with connected input', () => {
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
            outputHandles: [makeHandle('out', 80, 15)],
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
          id: 'b1',
          type: 'block',
          position: { x: 100, y: 50 },
          width: 120,
          height: 60,
          data: {
            numericId: '3',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1', 100, 70)],
            outputHandles: [makeHandle('OUT', 220, 70)],
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
    expect(result.body.FBD.block).toHaveLength(1)
    const block = result.body.FBD.block[0]
    expect(block['@localId']).toBe('3')
    expect(block['@typeName']).toBe('ADD')
    expect(block['@instanceName']).toBeUndefined()
    const iv = block.inputVariables.variable[0]
    expect(iv.connectionPointIn.connection[0]['@refLocalId']).toBe('1')
    // Non-block source should not have formalParameter
    expect(iv.connectionPointIn.connection[0]['@formalParameter']).toBeUndefined()
  })

  it('block input from another block includes formalParameter', () => {
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
            outputHandles: [makeHandle('OUT', 100, 25)],
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
            inputHandles: [makeHandle('IN1', 200, 25)],
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
    const conn = result.body.FBD.block[1].inputVariables.variable[0].connectionPointIn.connection[0]
    expect(conn['@formalParameter']).toBe('OUT')
  })

  it('block input edge paths include intermediate points when source/target Y differ', () => {
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
            outputHandles: [makeHandle('out', 80, 15)],
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
          id: 'b1',
          type: 'block',
          position: { x: 200, y: 100 },
          width: 100,
          height: 50,
          data: {
            numericId: '2',
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [
              {
                id: 'IN1',
                type: 'target',
                position: 'left',
                glbPosition: { x: 200, y: 125 },
                relPosition: { x: 0, y: 25 },
              },
            ],
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
    const positions = result.body.FBD.block[0].inputVariables.variable[0].connectionPointIn.connection[0].position
    // With different Y, there should be 4 position points (reversed path)
    expect(positions.length).toBe(4)
  })

  it('block input edge paths use 2 points when source/target Y are same', () => {
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
            outputHandles: [makeHandle('out', 80, 15)],
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
            inputHandles: [
              {
                id: 'IN1',
                type: 'target',
                position: 'left',
                glbPosition: { x: 200, y: 15 },
                relPosition: { x: 0, y: 15 },
              },
            ],
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
    const positions = result.body.FBD.block[0].inputVariables.variable[0].connectionPointIn.connection[0].position
    // Same Y, just 2 points
    expect(positions.length).toBe(2)
  })

  it('block input filters out undefined (missing path)', () => {
    // Edge with no matching handles should be filtered
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
            outputHandles: [], // No handles - path will be undefined
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
            executionOrder: 0,
            variant: { name: 'ADD', type: 'function' },
            variable: { name: '' },
            handles: [],
            inputHandles: [makeHandle('IN1', 200, 25)],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'iv1', target: 'b1', sourceHandle: 'nonexistent', targetHandle: 'IN1' }],
    })
    const result = fbdToXml(rung)
    // The connection is filtered out because getEdgePaths returns undefined (no matching outputHandle)
    expect(result.body.FBD.block[0].inputVariables.variable).toHaveLength(0)
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
            outputHandles: [makeHandle('out', 80, 15)],
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
            inputHandles: [makeHandle('in', 100, 15)],
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
    expect(result.body.FBD.connector[0]['@name']).toBe('label1')
    expect(result.body.FBD.connector[0].connectionPointIn.connection).toHaveLength(1)
  })

  it('connector filters out connections with missing source or path', () => {
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
            inputHandles: [makeHandle('in', 100, 15)],
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
    expect(c.content['xhtml:p'].$).toBe('This is a comment')
  })

  it('comment node uses "No comment provided" when content is empty', () => {
    const rung = makeRung({
      nodes: [
        {
          id: 'c1',
          type: 'comment',
          position: { x: 0, y: 0 },
          width: 100,
          height: 30,
          data: {
            numericId: '7',
            content: '',
            draggable: true,
            selectable: true,
            deletable: true,
          },
        } as unknown as Node,
      ],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.comment[0].content['xhtml:p'].$).toBe('No comment provided')
  })

  it('comment node falls back to measured dimensions', () => {
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
            numericId: '8',
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
      nodes: [{ id: 'u1', type: 'unknown-type', position: { x: 0, y: 0 }, data: {} } as unknown as Node],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.block).toHaveLength(0)
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
            inputHandles: [makeHandle('IN1', 200, 25)],
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
    expect(result.body.FBD.block[0].inputVariables.variable).toHaveLength(0)
  })

  it('output-variable with path where source is a block includes formalParameter', () => {
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
            outputHandles: [makeHandle('OUT', 100, 25)],
            inputConnector: undefined,
            outputConnector: {
              id: 'OUT',
              type: 'source',
              position: 'right',
              glbPosition: { x: 100, y: 25 },
              relPosition: { x: 100, y: 25 },
            },
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
            numericId: '11',
            executionOrder: 1,
            negated: false,
            variable: { name: 'result' },
            handles: [],
            inputHandles: [makeHandle('in', 200, 15)],
            outputHandles: [],
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 200, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
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
    const ov = result.body.FBD.outVariable[0]
    expect(ov.connectionPointIn.connection[0]['@formalParameter']).toBe('OUT')
    expect(ov.connectionPointIn.connection[0].position.length).toBeGreaterThanOrEqual(2)
  })

  it('output-variable filters out connections where path is undefined', () => {
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
            outputHandles: [], // No handles so getEdgePaths returns undefined
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
            inputHandles: [makeHandle('in', 200, 15)],
            outputHandles: [],
            inputConnector: {
              id: 'in',
              type: 'target',
              position: 'left',
              glbPosition: { x: 200, y: 15 },
              relPosition: { x: 0, y: 15 },
            },
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'output-variable',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'iv1', target: 'ov1', sourceHandle: 'nonexistent', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    // Path is undefined because source handle doesn't match any outputHandle
    expect(result.body.FBD.outVariable[0].connectionPointIn.connection).toHaveLength(0)
  })

  it('connector with block source includes formalParameter', () => {
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
            outputHandles: [makeHandle('OUT', 100, 25)],
            inputConnector: undefined,
            outputConnector: {
              id: 'OUT',
              type: 'source',
              position: 'right',
              glbPosition: { x: 100, y: 25 },
              relPosition: { x: 100, y: 25 },
            },
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
            inputHandles: [makeHandle('in', 200, 15)],
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
    const conn = result.body.FBD.connector[0]
    expect(conn.connectionPointIn.connection[0]['@formalParameter']).toBe('OUT')
  })

  it('connector filters out connections where path is undefined', () => {
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
            outputHandles: [], // No outputHandles so path returns undefined
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
            inputHandles: [makeHandle('in', 100, 15)],
            outputHandles: [],
            draggable: true,
            selectable: true,
            deletable: true,
            variant: 'connector',
          },
        } as unknown as Node,
      ],
      edges: [{ id: 'e1', source: 'iv1', target: 'conn1', sourceHandle: 'nonexistent', targetHandle: 'in' }],
    })
    const result = fbdToXml(rung)
    expect(result.body.FBD.connector[0].connectionPointIn.connection).toHaveLength(0)
  })
})
