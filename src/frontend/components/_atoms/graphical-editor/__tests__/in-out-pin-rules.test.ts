import { describe, expect, it } from 'vitest'

import {
  blockInputVariables,
  blockOutputVariables,
  findOccupiedInOutPin,
  inOutVariableNames,
  migrateInOutSourceEdges,
  stripInOutOutputHandles,
} from '../in-out-pin-rules'

/** Irrigation_Main_Controller: State is VAR_IN_OUT, Moisture and T_Max are inputs. */
const variables = [
  { name: 'State', class: 'inOut', type: { definition: 'user-data-type', value: 'Irrigation_State' } },
  { name: 'Moisture', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
  { name: 'T_Max', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
]

const handle = (id: string, type: 'source' | 'target', top: number) => ({
  id,
  type,
  glbPosition: { x: 0, y: top },
  relPosition: { x: 0, y: top },
  style: { top },
})

const blockNode = (id = 'imc') => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: {
    variant: { name: 'Irrigation_Main_Controller', variables },
    inputHandles: [handle('State', 'target', 48), handle('Moisture', 'target', 96), handle('T_Max', 'target', 144)],
    // What a project saved before the change carries: an output pin for the in-out.
    outputHandles: [handle('State', 'source', 48)],
    handles: [
      handle('State', 'target', 48),
      handle('Moisture', 'target', 96),
      handle('T_Max', 'target', 144),
      handle('State', 'source', 48),
    ],
    outputConnector: handle('State', 'source', 48),
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
      { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
      { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'TIME' } },
    ]
    expect(blockInputVariables(ton).map((v) => v.name)).toEqual(['IN', 'PT'])
    expect(blockOutputVariables(ton).map((v) => v.name)).toEqual(['Q', 'ET'])
    expect(inOutVariableNames(ton).size).toBe(0)
  })
})

describe('an in-out pin accepts exactly one variable', () => {
  const graph = {
    nodes: [blockNode()],
    edges: [{ source: 'v1', sourceHandle: 'output-variable', target: 'imc', targetHandle: 'State' }],
  }

  it('rejects a second connection to an in-out pin', () => {
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'State' }, graph)).toBe('State')
  })

  it('allows the first connection to an in-out pin', () => {
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'State' }, { ...graph, edges: [] })).toBeUndefined()
  })

  it('does not restrict ordinary input pins', () => {
    const busy = {
      ...graph,
      edges: [...graph.edges, { source: 'v2', sourceHandle: 'output-variable', target: 'imc', targetHandle: 'Moisture' }],
    }
    expect(findOccupiedInOutPin({ target: 'imc', targetHandle: 'Moisture' }, busy)).toBeUndefined()
  })
})

describe('migrating projects saved with a two-sided in-out pin', () => {
  it('re-points a wire leaving the in-out pin at whatever feeds the pin', () => {
    // The Irrigation Controller's main POU: variable `State` feeds the pin, and the pin is
    // read into two other blocks.
    const edges = [
      { source: 'stateVar', sourceHandle: 'output-variable', target: 'imc', targetHandle: 'State' },
      { source: 'imc', sourceHandle: 'State', target: 'manualOverride', targetHandle: 'State' },
      { source: 'imc', sourceHandle: 'State', target: 'stateToNum', targetHandle: 'State' },
    ]
    const result = migrateInOutSourceEdges([blockNode()], edges)

    expect(result.rewired).toBe(2)
    expect(result.dropped).toBe(0)
    expect(result.edges).toEqual([
      edges[0],
      { source: 'stateVar', sourceHandle: 'output-variable', target: 'manualOverride', targetHandle: 'State' },
      { source: 'stateVar', sourceHandle: 'output-variable', target: 'stateToNum', targetHandle: 'State' },
    ])
  })

  it('drops a wire whose in-out pin has nothing feeding it', () => {
    const result = migrateInOutSourceEdges(
      [blockNode()],
      [{ source: 'imc', sourceHandle: 'State', target: 'manualOverride', targetHandle: 'State' }],
    )
    expect(result).toMatchObject({ edges: [], rewired: 0, dropped: 1 })
  })

  it('leaves a diagram without in-out pins untouched', () => {
    const edges = [{ source: 'a', sourceHandle: 'Q', target: 'b', targetHandle: 'IN' }]
    const plain = { ...blockNode(), data: { ...blockNode().data, variant: { name: 'TON', variables: [] } } }
    expect(migrateInOutSourceEdges([plain], edges)).toEqual({ edges, rewired: 0, dropped: 0 })
  })

  it('removes the stale in-out output pin from the saved handles', () => {
    const healed = stripInOutOutputHandles(blockNode(), { connectorY: 48, connectorOffsetY: 48 })

    expect(healed.data.outputHandles).toEqual([])
    expect(healed.data.handles?.map((h) => `${h.id}:${h.type}`)).toEqual([
      'State:target',
      'Moisture:target',
      'T_Max:target',
    ])
    expect(healed.data.outputConnector).toBeUndefined()
  })

  it('re-flows the remaining output pins so labels and pins stay aligned', () => {
    const node = blockNode()
    node.data.variant.variables = [
      { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ...variables,
    ]
    node.data.outputHandles = [handle('State', 'source', 48), handle('Q', 'source', 96)]
    node.data.outputConnector = handle('State', 'source', 48)

    const healed = stripInOutOutputHandles(node, { connectorY: 48, connectorOffsetY: 48 })

    // `Q` was second; with the in-out gone it moves up into the first slot.
    expect(healed.data.outputHandles).toEqual([
      { ...handle('Q', 'source', 48), glbPosition: { x: 0, y: 0 } },
    ])
    expect(healed.data.outputConnector?.id).toBe('Q')
  })

  it('is a no-op for a block that never had a two-sided in-out pin', () => {
    const node = blockNode()
    node.data.outputHandles = []
    node.data.handles = node.data.inputHandles
    const healed = stripInOutOutputHandles(node, { connectorY: 48, connectorOffsetY: 48 })
    expect(healed).toBe(node)
  })
})
