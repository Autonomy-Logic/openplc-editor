import {
  blockInputVariables,
  blockOutputVariables,
  blockParameterSide,
  findOccupiedInOutPin,
  hasLegacyInOutOutputHandle,
  IN_OUT_MARKER_WIDTH,
  inOutVariableNames,
  legacyInOutSourcePinIds,
  rewireInOutReads,
} from '../in-out-pin-rules'

/** Irrigation_Main_Controller: State is VAR_IN_OUT, Moisture and T_Max are inputs. */
const variables = [
  { name: 'State', class: 'inOut', type: { definition: 'user-data-type', value: 'Irrigation_State' } },
  { name: 'Moisture', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
  { name: 'T_Max', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
]

const handle = (id: string, type: 'source' | 'target') => ({ id, type })

/** A block node as a project saved BEFORE the change carries it: an output pin for the in-out. */
const legacyNode = (id = 'imc') => ({
  id,
  type: 'block',
  data: {
    variant: { name: 'Irrigation_Main_Controller', variables },
    outputHandles: [handle('State', 'source')],
    handles: [
      handle('State', 'target'),
      handle('Moisture', 'target'),
      handle('T_Max', 'target'),
      handle('State', 'source'),
    ],
  },
})

/** The same block as `buildBlockNode` produces it today: one pin, input side. */
const currentNode = (id = 'imc') => ({
  id,
  type: 'block',
  data: {
    variant: { name: 'Irrigation_Main_Controller', variables },
    outputHandles: [],
    handles: [handle('State', 'target'), handle('Moisture', 'target'), handle('T_Max', 'target')],
  },
})

describe('VAR_IN_OUT is a single input-side pin', () => {
  it('puts an in-out parameter on the input side only', () => {
    expect(blockInputVariables(variables).map((v) => v.name)).toEqual(['State', 'Moisture', 'T_Max'])
    expect(blockOutputVariables(variables).map((v) => v.name)).toEqual([])
    expect([...inOutVariableNames(variables)]).toEqual(['State'])
  })

  it('leaves plain inputs and outputs alone', () => {
    const ton = [
      { name: 'IN', class: 'input' },
      { name: 'PT', class: 'input' },
      { name: 'Q', class: 'output' },
      { name: 'ET', class: 'output' },
    ]
    expect(blockInputVariables(ton).map((v) => v.name)).toEqual(['IN', 'PT'])
    expect(blockOutputVariables(ton).map((v) => v.name)).toEqual(['Q', 'ET'])
    expect(inOutVariableNames(ton).size).toBe(0)
  })

  it('sides every parameter class the same way the two filters do', () => {
    expect(blockParameterSide({ name: 'IN', class: 'input' })).toBe('input')
    expect(blockParameterSide({ name: 'State', class: 'inOut' })).toBe('input')
    expect(blockParameterSide({ name: 'Q', class: 'output' })).toBe('output')
  })

  it('reserves room for the ⟷ marker', () => {
    expect(IN_OUT_MARKER_WIDTH).toBeGreaterThan(0)
  })
})

describe('an in-out pin takes exactly one wire', () => {
  const graph = {
    nodes: [currentNode()],
    edges: [{ source: 'var1', sourceHandle: 'out', target: 'imc', targetHandle: 'State' }],
  }

  it('refuses a second wire into an occupied in-out pin, naming the pin', () => {
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'State' }, graph)).toBe('State')
  })

  it('allows the first wire into an in-out pin', () => {
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'State' }, { ...graph, edges: [] })).toBeUndefined()
  })

  it('does not restrict plain input pins, however many wires they have', () => {
    const wired = {
      ...graph,
      edges: [{ source: 'var1', sourceHandle: 'out', target: 'imc', targetHandle: 'Moisture' }],
    }
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'Moisture' }, wired)).toBeUndefined()
  })

  it('ignores a connection with no target or no handle, and unknown nodes', () => {
    expect(findOccupiedInOutPin({ target: null, targetHandle: 'State' }, graph)).toBeUndefined()
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: null }, graph)).toBeUndefined()
    expect(findOccupiedInOutPin({ target: 'nope', targetHandle: 'State' }, graph)).toBeUndefined()
  })

  it('ignores a target node that is not a block, or whose variant declares nothing', () => {
    const odd = {
      nodes: [
        { id: 'v', type: 'variable', data: { variant: { variables } } },
        { id: 'empty', type: 'block', data: { variant: {} } },
      ],
      edges: [],
    }
    expect(findOccupiedInOutPin({ target: 'v', targetHandle: 'State' }, odd)).toBeUndefined()
    expect(findOccupiedInOutPin({ target: 'empty', targetHandle: 'State' }, odd)).toBeUndefined()
  })
})

describe('detecting a block still drawn with the old two-sided pin', () => {
  it('flags a node that carries the in-out on its output side', () => {
    expect(hasLegacyInOutOutputHandle(legacyNode())).toBe(true)
    expect([...legacyInOutSourcePinIds(legacyNode().data)]).toEqual(['State'])
  })

  it('does not flag a node built by the current rules', () => {
    expect(hasLegacyInOutOutputHandle(currentNode())).toBe(false)
    expect(legacyInOutSourcePinIds(currentNode().data).size).toBe(0)
  })

  it('catches the stale pin in `handles` even when `outputHandles` no longer lists it', () => {
    const node = legacyNode()
    node.data.outputHandles = []
    expect(hasLegacyInOutOutputHandle(node)).toBe(true)
  })

  it('never mistakes the surviving INPUT pin for the stale one — both share the id', () => {
    const node = currentNode()
    // Only the source-side entry counts; `State` is still a target handle here.
    expect(legacyInOutSourcePinIds(node.data).has('State')).toBe(false)
  })

  it('ignores blocks with no in-out parameter, and non-block nodes', () => {
    const ton = {
      id: 'ton',
      type: 'block',
      data: {
        variant: { name: 'TON', variables: [{ name: 'Q', class: 'output' }] },
        outputHandles: [handle('Q', 'source')],
        handles: [handle('Q', 'source')],
      },
    }
    expect(hasLegacyInOutOutputHandle(ton)).toBe(false)
    expect(hasLegacyInOutOutputHandle({ ...legacyNode(), type: 'variable' })).toBe(false)
  })

  it('tolerates a node with no handle arrays and no variant at all', () => {
    expect(hasLegacyInOutOutputHandle({ id: 'x', type: 'block', data: {} })).toBe(false)
    expect(legacyInOutSourcePinIds({ variant: { variables } }).size).toBe(0)
  })

  it('ignores a handle carrying no id, on either array', () => {
    const bare = { type: 'source' }
    expect(
      hasLegacyInOutOutputHandle({ id: 'imc', type: 'block', data: { variant: { variables }, handles: [bare] } }),
    ).toBe(false)
    expect(
      hasLegacyInOutOutputHandle({ id: 'imc', type: 'block', data: { variant: { variables }, outputHandles: [bare] } }),
    ).toBe(false)
  })

  it('tolerates a variant that declares no variables', () => {
    expect(hasLegacyInOutOutputHandle({ id: 'x', type: 'block', data: { variant: {} } })).toBe(false)
  })

  it('ignores a node with no type at all', () => {
    expect(hasLegacyInOutOutputHandle({ id: 'x', data: { variant: { variables } } })).toBe(false)
  })
})

describe('converting the wires that read an in-out pin (FBD)', () => {
  const node = legacyNode()

  it('re-points a read at whatever feeds the pin, so the value is unchanged', () => {
    const edges = [
      { source: 'stateVar', sourceHandle: 'out', target: 'imc', targetHandle: 'State' },
      { source: 'imc', sourceHandle: 'State', target: 'other', targetHandle: 'IN' },
    ]
    const result = rewireInOutReads(node, edges)
    expect(result.rewired).toBe(1)
    expect(result.dropped).toBe(0)
    expect(result.edges).toEqual([
      edges[0],
      { source: 'stateVar', sourceHandle: 'out', target: 'other', targetHandle: 'IN' },
    ])
  })

  it('re-points every read of the same pin', () => {
    const edges = [
      { source: 'stateVar', sourceHandle: 'out', target: 'imc', targetHandle: 'State' },
      { source: 'imc', sourceHandle: 'State', target: 'a', targetHandle: 'IN' },
      { source: 'imc', sourceHandle: 'State', target: 'b', targetHandle: 'IN' },
    ]
    const result = rewireInOutReads(node, edges)
    expect(result.rewired).toBe(2)
    expect(result.edges.filter((e) => e.source === 'stateVar')).toHaveLength(3)
  })

  it('drops a read whose pin has nothing feeding it, and counts it', () => {
    const edges = [{ source: 'imc', sourceHandle: 'State', target: 'other', targetHandle: 'IN' }]
    const result = rewireInOutReads(node, edges)
    expect(result.dropped).toBe(1)
    expect(result.rewired).toBe(0)
    expect(result.edges).toEqual([])
  })

  it('leaves edges on other pins, other nodes and other directions untouched', () => {
    const edges = [
      { source: 'imc', sourceHandle: 'Q', target: 'other', targetHandle: 'IN' },
      { source: 'elsewhere', sourceHandle: 'State', target: 'other', targetHandle: 'IN' },
      { source: 'feed', sourceHandle: 'out', target: 'imc', targetHandle: 'Moisture' },
    ]
    const result = rewireInOutReads(node, edges)
    expect(result).toEqual({ edges, rewired: 0, dropped: 0 })
  })

  it('is a no-op for a block with no in-out parameter, returning the same array', () => {
    const ton = { id: 'ton', type: 'block', data: { variant: { variables: [{ name: 'Q', class: 'output' }] } } }
    const edges = [{ source: 'ton', sourceHandle: 'Q', target: 'other', targetHandle: 'IN' }]
    expect(rewireInOutReads(ton, edges).edges).toBe(edges)
  })

  it('ignores an edge that leaves the node with no handle named', () => {
    const edges = [{ source: 'imc', sourceHandle: null, target: 'other', targetHandle: 'IN' }]
    expect(rewireInOutReads(node, edges)).toEqual({ edges, rewired: 0, dropped: 0 })
  })
})
