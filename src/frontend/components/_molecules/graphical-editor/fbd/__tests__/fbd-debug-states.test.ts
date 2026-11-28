import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import type { FBDRungState } from '../../../../../store/slices/fbd'
import { computeFBDEdgeStates, type FBDDebugContext } from '../fbd-debug-states'

type FbdNode = FBDRungState['nodes'][number]
type FbdEdge = FBDRungState['edges'][number]

const node = (id: string, type: string, data: Record<string, unknown>): FbdNode =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FbdNode

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FbdEdge =>
  ({ id: `${source}.${sourceHandle}`, source, sourceHandle, target, targetHandle }) as FbdEdge

const generic = (value: string) => ({ definition: 'generic-type', value })
const base = (value: string) => ({ definition: 'base-type', value })

const variables: PLCVariable[] = [
  { name: 'b', class: 'local', type: base('BOOL') } as PLCVariable,
  { name: 'q', class: 'local', type: base('BOOL') } as PLCVariable,
]

// b -> NOT(7) -> ton.IN; ton.Q -> q; ton.ET -> et; n -> ADD(8) -> sum
const nodes = [
  node('b', 'input-variable', { variable: { name: 'b' } }),
  node('not', 'block', {
    numericId: '7',
    variable: { name: '' },
    variant: {
      name: 'NOT',
      type: 'function',
      variables: [
        { name: 'IN', class: 'input', type: generic('ANY_BIT') },
        { name: 'OUT', class: 'output', type: generic('ANY_BIT') },
      ],
    },
  }),
  node('ton', 'block', {
    numericId: '9',
    variable: { name: 'ton' },
    variant: {
      name: 'TON',
      type: 'function-block',
      variables: [
        { name: 'IN', class: 'input', type: base('BOOL') },
        { name: 'Q', class: 'output', type: base('BOOL') },
        { name: 'ET', class: 'output', type: base('TIME') },
      ],
    },
  }),
  node('add', 'block', {
    numericId: '8',
    variable: { name: '' },
    variant: {
      name: 'ADD',
      type: 'function',
      variables: [
        { name: 'IN1', class: 'input', type: generic('ANY_NUM') },
        { name: 'OUT', class: 'output', type: generic('ANY_NUM') },
      ],
    },
  }),
  node('q', 'output-variable', { variable: { name: 'q' } }),
  node('et', 'output-variable', { variable: { name: 'et' } }),
  node('sum', 'output-variable', { variable: { name: 'sum' } }),
]

const edges = [
  edge('b', 'output-variable', 'not', 'IN'),
  edge('not', 'OUT', 'ton', 'IN'),
  edge('ton', 'Q', 'q', 'input-variable'),
  edge('ton', 'ET', 'et', 'input-variable'),
  edge('add', 'OUT', 'sum', 'input-variable'),
]

const context = (boolValues: Record<string, string>): FBDDebugContext => ({
  isFunctionBlockPou: false,
  hasProgramInstance: true,
  getCompositeKey: (name) => `main:${name}`,
  boolValues: new Map(Object.entries(boolValues).map(([name, value]) => [`main:${name}`, value])),
  forcedValues: new Map(),
  pouVariables: variables,
})

describe('computeFBDEdgeStates', () => {
  it('energises the wire out of a function whose output is declared ANY_BIT when its value is a TRUE BOOL', () => {
    const states = computeFBDEdgeStates(nodes, edges, context({ b: 'FALSE', _TMP_NOT7_OUT: 'TRUE', 'ton.Q': 'TRUE' }))

    expect(states.get('b.output-variable')).toBe(false)
    expect(states.get('not.OUT')).toBe(true)
    expect(states.get('ton.Q')).toBe(true)
  })

  it('leaves the wire out of a function de-energised while its BOOL value is FALSE', () => {
    const states = computeFBDEdgeStates(nodes, edges, context({ b: 'TRUE', _TMP_NOT7_OUT: 'FALSE', 'ton.Q': 'FALSE' }))

    expect(states.get('b.output-variable')).toBe(true)
    expect(states.get('not.OUT')).toBe(false)
    expect(states.get('ton.Q')).toBe(false)
  })

  it('never energises a wire whose source output has no BOOL value', () => {
    const states = computeFBDEdgeStates(nodes, edges, context({ _TMP_NOT7_OUT: 'TRUE', 'ton.Q': 'TRUE' }))

    expect(states.get('ton.ET')).toBe(false)
    expect(states.get('add.OUT')).toBe(false)
  })
})
