import type { RungLadderState } from '@root/frontend/store/slices'
import type { Node } from '@xyflow/react'

import { ladderToXml } from '../ladder-xml'

const makeHandle = (id: string, x = 0, y = 0) => ({
  id,
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x, y },
  relPosition: { x, y },
})

const makeRung = (overrides: Partial<RungLadderState> = {}): RungLadderState => ({
  id: 'rung-0',
  comment: '',
  defaultBounds: [0, 0],
  reactFlowViewport: [0, 200],
  selectedNodes: [],
  nodes: [],
  edges: [],
  ...overrides,
})

const makeLeftRail = (id = 'lr1', numericId = '100') => ({
  id,
  type: 'powerRail' as const,
  position: { x: 0, y: 0 },
  width: 10,
  height: 300,
  data: {
    numericId,
    variant: 'left' as const,
    variable: { name: '' },
    executionOrder: 0,
    handles: [],
    inputHandles: [],
    outputHandles: [makeHandle('out')],
    inputConnector: undefined,
    outputConnector: makeHandle('out', 10, 150),
    draggable: false,
    selectable: false,
    deletable: false,
  },
})

const makeRightRail = (id = 'rr1', numericId = '200') => ({
  id,
  type: 'powerRail' as const,
  position: { x: 500, y: 0 },
  width: 10,
  height: 300,
  data: {
    numericId,
    variant: 'right' as const,
    variable: { name: '' },
    executionOrder: 0,
    handles: [],
    inputHandles: [makeHandle('in', 500, 150)],
    outputHandles: [],
    inputConnector: makeHandle('in', 500, 150),
    outputConnector: undefined,
    draggable: false,
    selectable: false,
    deletable: false,
  },
})

const makeContact = (
  id: string,
  numericId: string,
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' = 'default',
  varName = 'A',
) => ({
  id,
  type: 'contact' as const,
  position: { x: 100, y: 100 },
  width: 60,
  height: 40,
  data: {
    numericId,
    variant,
    variable: { name: varName },
    executionOrder: 0,
    handles: [],
    inputHandles: [],
    outputHandles: [],
    inputConnector: makeHandle('in', 100, 120),
    outputConnector: makeHandle('out', 160, 120),
    draggable: true,
    selectable: true,
    deletable: true,
  },
})

const makeCoil = (
  id: string,
  numericId: string,
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset' = 'default',
  varName = 'Q',
) => ({
  id,
  type: 'coil' as const,
  position: { x: 400, y: 100 },
  width: 60,
  height: 40,
  data: {
    numericId,
    variant,
    variable: { name: varName },
    executionOrder: 0,
    handles: [],
    inputHandles: [],
    outputHandles: [],
    inputConnector: makeHandle('in', 400, 120),
    outputConnector: makeHandle('out', 460, 120),
    draggable: true,
    selectable: true,
    deletable: true,
  },
})

describe('ladderToXml (old-editor)', () => {
  it('returns empty LD body for empty rungs', () => {
    const result = ladderToXml([])
    expect(result.body.LD.leftPowerRail).toEqual([])
    expect(result.body.LD.rightPowerRail).toEqual([])
    expect(result.body.LD.contact).toEqual([])
    expect(result.body.LD.coil).toEqual([])
    expect(result.body.LD.block).toEqual([])
    expect(result.body.LD.inVariable).toEqual([])
    expect(result.body.LD.inOutVariable).toEqual([])
    expect(result.body.LD.outVariable).toEqual([])
  })

  it('adds left and right power rails from each rung', () => {
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, makeRightRail() as unknown as Node],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.leftPowerRail).toHaveLength(1)
    expect(result.body.LD.rightPowerRail).toHaveLength(1)
  })

  it('adds left and right rails per rung', () => {
    const rung1 = makeRung({
      nodes: [makeLeftRail() as unknown as Node, makeRightRail() as unknown as Node],
    })
    const rung2 = makeRung({
      id: 'rung-1',
      nodes: [makeLeftRail('lr2', '101') as unknown as Node, makeRightRail('rr2', '201') as unknown as Node],
    })
    const result = ladderToXml([rung1, rung2])
    // old-editor adds a left rail per rung
    expect(result.body.LD.leftPowerRail).toHaveLength(2)
    expect(result.body.LD.rightPowerRail).toHaveLength(2)
  })

  it('right rail includes connections', () => {
    const leftRail = makeLeftRail()
    const contact = makeContact('c1', '10')
    const rightRail = makeRightRail()
    const rung = makeRung({
      nodes: [leftRail as unknown as Node, contact as unknown as Node, rightRail as unknown as Node],
      edges: [
        { id: 'e1', source: 'lr1', target: 'c1', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'c1', target: 'rr1', sourceHandle: 'out', targetHandle: 'in' },
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.rightPowerRail[0].connectionPointIn.connection.length).toBeGreaterThanOrEqual(1)
  })

  it('converts a contact with default variant', () => {
    const contact = makeContact('c1', '10')
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node],
      edges: [{ id: 'e1', source: 'lr1', target: 'c1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = ladderToXml([rung])
    const c = result.body.LD.contact[0]
    expect(c['@localId']).toBe('10')
    expect(c['@negated']).toBe(false)
    expect(c['@edge']).toBeUndefined()
    expect(c.variable).toBe('A')
    expect(c.connectionPointIn.relPosition).toBeDefined()
    expect(c.connectionPointOut.relPosition).toBeDefined()
  })

  it('converts a negated contact', () => {
    const contact = makeContact('c1', '10', 'negated')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0]['@negated']).toBe(true)
  })

  it('converts risingEdge contact', () => {
    const contact = makeContact('c1', '10', 'risingEdge')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0]['@edge']).toBe('rising')
  })

  it('converts fallingEdge contact', () => {
    const contact = makeContact('c1', '10', 'fallingEdge')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0]['@edge']).toBe('falling')
  })

  it('contact uses default variable A when name is empty', () => {
    const contact = makeContact('c1', '10', 'default', '')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0].variable).toBe('A')
  })

  it('converts a default coil', () => {
    const coil = makeCoil('cl1', '20')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    const c = result.body.LD.coil[0]
    expect(c['@localId']).toBe('20')
    expect(c['@negated']).toBe(false)
    expect(c['@edge']).toBeUndefined()
    expect(c['@storage']).toBeUndefined()
    expect(c.variable).toBe('Q')
  })

  it('converts negated coil', () => {
    const coil = makeCoil('cl1', '20', 'negated')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0]['@negated']).toBe(true)
  })

  it('converts risingEdge coil', () => {
    const coil = makeCoil('cl1', '20', 'risingEdge')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0]['@edge']).toBe('rising')
  })

  it('converts fallingEdge coil', () => {
    const coil = makeCoil('cl1', '20', 'fallingEdge')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0]['@edge']).toBe('falling')
  })

  it('converts set coil', () => {
    const coil = makeCoil('cl1', '20', 'set')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0]['@storage']).toBe('set')
  })

  it('converts reset coil', () => {
    const coil = makeCoil('cl1', '20', 'reset')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0]['@storage']).toBe('reset')
  })

  it('coil uses default variable A when name is empty', () => {
    const coil = makeCoil('cl1', '20', 'default', '')
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, coil as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.coil[0].variable).toBe('A')
  })

  it('skips variable nodes with empty name', () => {
    const rung = makeRung({
      nodes: [
        makeLeftRail() as unknown as Node,
        {
          id: 'v1',
          type: 'variable',
          position: { x: 50, y: 50 },
          width: 80,
          height: 30,
          data: {
            numericId: '30',
            variant: 'input',
            variable: { name: '' },
            executionOrder: 0,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: makeHandle('out', 130, 65),
            draggable: true,
            selectable: true,
            deletable: true,
            block: { id: 'b1', handleId: 'IN1' },
          },
        },
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.inVariable).toHaveLength(0)
    expect(result.body.LD.outVariable).toHaveLength(0)
  })

  it('converts an input variable node', () => {
    const rung = makeRung({
      nodes: [
        makeLeftRail() as unknown as Node,
        {
          id: 'v1',
          type: 'variable',
          position: { x: 50, y: 50 },
          width: 80,
          height: 30,
          data: {
            numericId: '30',
            variant: 'input',
            variable: { name: 'myVar' },
            executionOrder: 0,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: undefined,
            outputConnector: makeHandle('out', 130, 65),
            draggable: true,
            selectable: true,
            deletable: true,
            block: { id: 'b1', handleId: 'IN1' },
          },
        },
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.inVariable).toHaveLength(1)
    expect(result.body.LD.inVariable[0].expression).toBe('myVar')
    expect(result.body.LD.inVariable[0]['@negated']).toBe(false)
    expect(result.body.LD.inVariable[0].connectionPointOut.relPosition).toBeDefined()
  })

  it('converts an output variable node', () => {
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 200, y: 50 },
      width: 120,
      height: 60,
      data: {
        numericId: '40',
        variant: { name: 'ADD', type: 'function' },
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [makeHandle('IN1', 200, 70)],
        outputHandles: [makeHandle('OUT', 320, 70)],
        inputConnector: makeHandle('IN1', 200, 70),
        outputConnector: makeHandle('OUT', 320, 70),
        draggable: true,
        selectable: true,
        deletable: true,
        executionControl: false,
        lockExecutionControl: false,
        connectedVariables: [],
      },
    }
    const rung = makeRung({
      nodes: [
        makeLeftRail() as unknown as Node,
        blockNode as unknown as Node,
        {
          id: 'v1',
          type: 'variable',
          position: { x: 350, y: 50 },
          width: 80,
          height: 30,
          data: {
            numericId: '41',
            variant: 'output',
            variable: { name: 'result' },
            executionOrder: 0,
            handles: [],
            inputHandles: [],
            outputHandles: [],
            inputConnector: makeHandle('in', 350, 65),
            outputConnector: undefined,
            draggable: true,
            selectable: true,
            deletable: true,
            block: { id: 'b1', handleId: 'OUT' },
          },
        },
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.outVariable).toHaveLength(1)
    expect(result.body.LD.outVariable[0].expression).toBe('result')
    expect(result.body.LD.outVariable[0].connectionPointIn.connection[0]['@refLocalId']).toBe('40')
    expect(result.body.LD.outVariable[0].connectionPointIn.connection[0]['@formalParameter']).toBe('OUT')
  })

  it('converts a block node', () => {
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 200, y: 50 },
      width: 120,
      height: 60,
      data: {
        numericId: '50',
        variant: { name: 'ADD', type: 'function' },
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [makeHandle('EN', 200, 50)],
        outputHandles: [makeHandle('OUT', 320, 70)],
        inputConnector: makeHandle('EN', 200, 50),
        outputConnector: makeHandle('OUT', 320, 70),
        draggable: true,
        selectable: true,
        deletable: true,
        executionControl: false,
        lockExecutionControl: false,
        connectedVariables: [],
      },
    }
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, blockNode as unknown as Node],
      edges: [{ id: 'e1', source: 'lr1', target: 'b1', sourceHandle: 'out', targetHandle: 'EN' }],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.block).toHaveLength(1)
    expect(result.body.LD.block[0]['@localId']).toBe('50')
    expect(result.body.LD.block[0]['@typeName']).toBe('ADD')
    expect(result.body.LD.block[0]['@instanceName']).toBeUndefined()
  })

  it('block sets instanceName for function-block', () => {
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 200, y: 50 },
      width: 120,
      height: 60,
      data: {
        numericId: '50',
        variant: { name: 'TON', type: 'function-block' },
        variable: { name: 'timer1' },
        executionOrder: 0,
        handles: [],
        inputHandles: [],
        outputHandles: [],
        inputConnector: undefined,
        outputConnector: undefined,
        draggable: true,
        selectable: true,
        deletable: true,
        executionControl: false,
        lockExecutionControl: false,
        connectedVariables: [],
      },
    }
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, blockNode as unknown as Node] })
    const result = ladderToXml([rung])
    expect(result.body.LD.block[0]['@instanceName']).toBe('timer1')
  })

  it('block input handle connects to variable node with edge positions', () => {
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 200, y: 50 },
      width: 120,
      height: 60,
      data: {
        numericId: '50',
        variant: { name: 'ADD', type: 'function' },
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [makeHandle('EN', 200, 50), makeHandle('IN1', 200, 70)],
        outputHandles: [],
        inputConnector: makeHandle('EN', 200, 50),
        outputConnector: undefined,
        draggable: true,
        selectable: true,
        deletable: true,
        executionControl: false,
        lockExecutionControl: false,
        connectedVariables: [],
      },
    }
    const varNode = {
      id: 'v1',
      type: 'variable',
      position: { x: 100, y: 70 },
      width: 80,
      height: 30,
      data: {
        numericId: '51',
        variant: 'input',
        variable: { name: 'x' },
        executionOrder: 0,
        handles: [],
        inputHandles: [],
        outputHandles: [],
        inputConnector: undefined,
        outputConnector: makeHandle('out', 180, 85),
        draggable: true,
        selectable: true,
        deletable: true,
        block: { id: 'b1', handleId: 'IN1' },
      },
    }
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, blockNode as unknown as Node, varNode as unknown as Node],
    })
    const result = ladderToXml([rung])
    const block = result.body.LD.block[0]
    const in1 = block.inputVariables.variable.find((v: Record<string, unknown>) => v['@formalParameter'] === 'IN1')
    expect(in1).toBeDefined()
    expect(in1!.connectionPointIn.connection[0]['@refLocalId']).toBe('51')
    expect(in1!.connectionPointIn.connection[0].position).toHaveLength(2)
  })

  it('block input handle without variable node is filtered out', () => {
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 200, y: 50 },
      width: 120,
      height: 60,
      data: {
        numericId: '50',
        variant: { name: 'ADD', type: 'function' },
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [makeHandle('EN', 200, 50), makeHandle('IN1', 200, 70)],
        outputHandles: [],
        inputConnector: makeHandle('EN', 200, 50),
        outputConnector: undefined,
        draggable: true,
        selectable: true,
        deletable: true,
        executionControl: false,
        lockExecutionControl: false,
        connectedVariables: [],
      },
    }
    const rung = makeRung({ nodes: [makeLeftRail() as unknown as Node, blockNode as unknown as Node] })
    const result = ladderToXml([rung])
    const block = result.body.LD.block[0]
    expect(block.inputVariables.variable).toHaveLength(1)
  })

  it('skips unknown node types', () => {
    const rung = makeRung({
      nodes: [
        makeLeftRail() as unknown as Node,
        { id: 'u', type: 'placeholder', position: { x: 0, y: 0 }, data: {} } as unknown as Node,
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact).toHaveLength(0)
    expect(result.body.LD.coil).toHaveLength(0)
  })

  it('accumulates offsetY across rungs', () => {
    const rung1 = makeRung({
      reactFlowViewport: [0, 200],
      nodes: [makeLeftRail() as unknown as Node],
    })
    const contact2 = makeContact('c2', '15')
    const rung2 = makeRung({
      id: 'rung-1',
      reactFlowViewport: [0, 300],
      nodes: [makeLeftRail('lr2', '101') as unknown as Node, contact2 as unknown as Node],
    })
    const result = ladderToXml([rung1, rung2])
    const c = result.body.LD.contact[0]
    expect(c.position['@y']).toBe(300) // 100 (original) + 200 (offset from rung1)
  })

  describe('findConnections with parallel nodes', () => {
    it('handles close parallel node connections', () => {
      const leftRail = makeLeftRail()
      const c1 = { ...makeContact('c1', '10'), position: { x: 100, y: 50 } }
      const c2 = { ...makeContact('c2', '11'), position: { x: 100, y: 150 } }
      const pc = {
        id: 'pc1',
        type: 'parallel',
        position: { x: 200, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '60',
          type: 'close',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 200, 100),
          outputConnector: makeHandle('out', 220, 100),
          parallelInputConnector: makeHandle('pIn', 200, 150),
          parallelOutputConnector: undefined,
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const coil = makeCoil('cl1', '20')
      const rung = makeRung({
        nodes: [
          leftRail as unknown as Node,
          c1 as unknown as Node,
          c2 as unknown as Node,
          pc as unknown as Node,
          coil as unknown as Node,
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'pc1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e2', source: 'c2', target: 'pc1', sourceHandle: 'out', targetHandle: 'pIn' },
          { id: 'e3', source: 'pc1', target: 'cl1', sourceHandle: 'out', targetHandle: 'in' },
        ],
      })
      const result = ladderToXml([rung])
      expect(result.body.LD.coil[0].connectionPointIn.connection.length).toBeGreaterThanOrEqual(1)
    })

    it('handles open parallel node connections (serial path)', () => {
      const leftRail = makeLeftRail()
      const contact1 = { ...makeContact('c1', '10'), position: { x: 100, y: 50 } }
      const po = {
        id: 'po1',
        type: 'parallel',
        position: { x: 180, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '60',
          type: 'open',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 180, 100),
          outputConnector: makeHandle('out', 200, 100),
          parallelInputConnector: makeHandle('pIn', 180, 150),
          parallelOutputConnector: makeHandle('pOut', 200, 150),
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const contact2 = { ...makeContact('c2', '11'), position: { x: 250, y: 50 } }
      const rung = makeRung({
        nodes: [
          leftRail as unknown as Node,
          contact1 as unknown as Node,
          po as unknown as Node,
          contact2 as unknown as Node,
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'po1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e2', source: 'po1', target: 'c2', sourceHandle: 'out', targetHandle: 'in' },
        ],
      })
      const result = ladderToXml([rung])
      expect(result.body.LD.contact[1].connectionPointIn.connection.length).toBeGreaterThanOrEqual(1)
    })

    it('handles open parallel node connections (non-serial path)', () => {
      const leftRail = makeLeftRail()
      const contact1 = { ...makeContact('c1', '10'), position: { x: 100, y: 50 } }
      const po = {
        id: 'po1',
        type: 'parallel',
        position: { x: 180, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '60',
          type: 'open',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 180, 100),
          outputConnector: makeHandle('out', 200, 100),
          parallelInputConnector: makeHandle('pIn', 180, 150),
          parallelOutputConnector: makeHandle('pOut', 200, 150),
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const contact2 = { ...makeContact('c2', '11'), position: { x: 250, y: 150 } }
      const rung = makeRung({
        nodes: [
          leftRail as unknown as Node,
          contact1 as unknown as Node,
          po as unknown as Node,
          contact2 as unknown as Node,
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'po1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e2', source: 'po1', target: 'c2', sourceHandle: 'pOut', targetHandle: 'in' },
        ],
      })
      const result = ladderToXml([rung])
      expect(result.body.LD.contact[1].connectionPointIn.connection.length).toBeGreaterThanOrEqual(1)
    })

    it('chains through nested open parallels', () => {
      const leftRail = makeLeftRail()
      const c1 = { ...makeContact('c1', '10'), position: { x: 50, y: 50 } }
      const po1 = {
        id: 'po1',
        type: 'parallel',
        position: { x: 130, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '60',
          type: 'open',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 130, 100),
          outputConnector: makeHandle('out', 150, 100),
          parallelInputConnector: makeHandle('pIn', 130, 150),
          parallelOutputConnector: makeHandle('pOut', 150, 150),
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const po2 = {
        id: 'po2',
        type: 'parallel',
        position: { x: 160, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '61',
          type: 'open',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 160, 100),
          outputConnector: makeHandle('out', 180, 100),
          parallelInputConnector: makeHandle('pIn', 160, 150),
          parallelOutputConnector: makeHandle('pOut', 180, 150),
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const c2 = { ...makeContact('c2', '11'), position: { x: 200, y: 50 } }
      const rung = makeRung({
        nodes: [
          leftRail as unknown as Node,
          c1 as unknown as Node,
          po1 as unknown as Node,
          po2 as unknown as Node,
          c2 as unknown as Node,
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'po1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e2', source: 'po1', target: 'po2', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e3', source: 'po2', target: 'c2', sourceHandle: 'out', targetHandle: 'in' },
        ],
      })
      const result = ladderToXml([rung])
      expect(result.body.LD.contact).toHaveLength(2)
    })

    it('chains through nested close parallels', () => {
      const leftRail = makeLeftRail()
      const c1 = { ...makeContact('c1', '10'), position: { x: 100, y: 50 } }
      const c2 = { ...makeContact('c2', '11'), position: { x: 100, y: 150 } }
      const c3 = { ...makeContact('c3', '12'), position: { x: 100, y: 250 } }
      const pc1 = {
        id: 'pc1',
        type: 'parallel',
        position: { x: 200, y: 50 },
        width: 20,
        height: 100,
        data: {
          numericId: '70',
          type: 'close',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 200, 100),
          outputConnector: makeHandle('out', 220, 100),
          parallelInputConnector: makeHandle('pIn', 200, 150),
          parallelOutputConnector: undefined,
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const pc2 = {
        id: 'pc2',
        type: 'parallel',
        position: { x: 200, y: 150 },
        width: 20,
        height: 100,
        data: {
          numericId: '71',
          type: 'close',
          variable: { name: '' },
          executionOrder: 0,
          handles: [],
          inputHandles: [],
          outputHandles: [],
          inputConnector: makeHandle('in', 200, 200),
          outputConnector: makeHandle('out', 220, 200),
          parallelInputConnector: makeHandle('pIn', 200, 250),
          parallelOutputConnector: undefined,
          parallelOpenReference: undefined,
          parallelCloseReference: undefined,
          draggable: false,
          selectable: false,
          deletable: false,
        },
      }
      const coil = makeCoil('cl1', '20')
      const rung = makeRung({
        nodes: [
          leftRail as unknown as Node,
          c1 as unknown as Node,
          c2 as unknown as Node,
          c3 as unknown as Node,
          pc1 as unknown as Node,
          pc2 as unknown as Node,
          coil as unknown as Node,
        ],
        edges: [
          { id: 'e1', source: 'c1', target: 'pc1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e2', source: 'pc2', target: 'pc1', sourceHandle: 'out', targetHandle: 'pIn' },
          { id: 'e3', source: 'c2', target: 'pc2', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'e4', source: 'c3', target: 'pc2', sourceHandle: 'out', targetHandle: 'pIn' },
          { id: 'e5', source: 'pc1', target: 'cl1', sourceHandle: 'out', targetHandle: 'in' },
        ],
      })
      const result = ladderToXml([rung])
      expect(result.body.LD.coil[0].connectionPointIn.connection.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('findConnections filters out variable source nodes', () => {
    const varNode = {
      id: 'v1',
      type: 'variable',
      position: { x: 50, y: 50 },
      width: 80,
      height: 30,
      data: {
        numericId: '30',
        variant: 'input',
        variable: { name: 'x' },
        executionOrder: 0,
        handles: [],
        inputHandles: [],
        outputHandles: [],
        inputConnector: undefined,
        outputConnector: undefined,
        draggable: true,
        selectable: true,
        deletable: true,
        block: { id: 'b1', handleId: 'IN1' },
      },
    }
    const contact = makeContact('c1', '10')
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, varNode as unknown as Node, contact as unknown as Node],
      edges: [{ id: 'e1', source: 'v1', target: 'c1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0].connectionPointIn.connection).toEqual([])
  })

  it('findConnections filters out edges where source node is not found', () => {
    const contact = makeContact('c1', '10')
    const rung = makeRung({
      nodes: [makeLeftRail() as unknown as Node, contact as unknown as Node],
      edges: [{ id: 'e1', source: 'nonexistent', target: 'c1', sourceHandle: 'out', targetHandle: 'in' }],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact[0].connectionPointIn.connection).toEqual([])
  })

  it('findNodeBasedOnParallelOpen chains through a close parallel', () => {
    const leftRail = makeLeftRail()
    const c1 = { ...makeContact('c1', '10'), position: { x: 50, y: 50 } }
    const c2 = { ...makeContact('c2', '11'), position: { x: 50, y: 150 } }
    const pc = {
      id: 'pc1',
      type: 'parallel',
      position: { x: 180, y: 50 },
      width: 20,
      height: 100,
      data: {
        numericId: '70',
        type: 'close',
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [],
        outputHandles: [],
        inputConnector: makeHandle('in', 180, 75),
        outputConnector: makeHandle('out', 200, 75),
        parallelInputConnector: makeHandle('pIn', 180, 150),
        parallelOutputConnector: undefined,
        parallelOpenReference: undefined,
        parallelCloseReference: undefined,
        draggable: false,
        selectable: false,
        deletable: false,
      },
    }
    const po = {
      id: 'po1',
      type: 'parallel',
      position: { x: 220, y: 50 },
      width: 20,
      height: 100,
      data: {
        numericId: '71',
        type: 'open',
        variable: { name: '' },
        executionOrder: 0,
        handles: [],
        inputHandles: [],
        outputHandles: [],
        inputConnector: makeHandle('in', 220, 75),
        outputConnector: makeHandle('out', 240, 75),
        parallelInputConnector: makeHandle('pIn', 220, 150),
        parallelOutputConnector: makeHandle('pOut', 240, 150),
        parallelOpenReference: undefined,
        parallelCloseReference: undefined,
        draggable: false,
        selectable: false,
        deletable: false,
      },
    }
    const c3 = { ...makeContact('c3', '12'), position: { x: 260, y: 50 } }
    const rung = makeRung({
      nodes: [
        leftRail as unknown as Node,
        c1 as unknown as Node,
        c2 as unknown as Node,
        pc as unknown as Node,
        po as unknown as Node,
        c3 as unknown as Node,
      ],
      edges: [
        { id: 'e1', source: 'c1', target: 'pc1', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e2', source: 'c2', target: 'pc1', sourceHandle: 'out', targetHandle: 'pIn' },
        { id: 'e3', source: 'pc1', target: 'po1', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'e4', source: 'po1', target: 'c3', sourceHandle: 'out', targetHandle: 'in' },
      ],
    })
    const result = ladderToXml([rung])
    expect(result.body.LD.contact.length).toBeGreaterThanOrEqual(1)
  })
})
