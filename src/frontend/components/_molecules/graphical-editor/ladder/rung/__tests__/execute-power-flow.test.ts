import type { RungLadderState } from '@root/frontend/store/slices'

import { computeRungDebugStates, type LadderDebugContext } from '../ladder-utils/debug-power-flow'

// Regression: `getNodeOutputState` dispatches on node type, and `execute` was
// missing from it — so during debug the power-flow highlight died at an
// Execute ("ST Block") box even though the rung really does energize whatever
// follows. Electrically the element is a coil: its ENO is its EN.

const ctx: LadderDebugContext = {
  isFunctionBlockPou: false,
  hasProgramInstance: true,
  getCompositeKey: (variableName: string) => `main:${variableName}`,
  boolValues: new Map([['main:gate', '1']]),
}

type Nodes = RungLadderState['nodes']
type Edges = RungLadderState['edges']

const rail = (id: string, variant: 'left' | 'right') =>
  ({ id, type: 'powerRail', position: { x: 0, y: 0 }, data: { variant } }) as unknown as Nodes[number]
const contact = (id: string, name: string) =>
  ({
    id,
    type: 'contact',
    position: { x: 0, y: 0 },
    data: { variant: 'open', variable: { name } },
  }) as unknown as Nodes[number]
const execute = (id: string) =>
  ({ id, type: 'execute', position: { x: 0, y: 0 }, data: { code: 'x := 1;' } }) as unknown as Nodes[number]
const coil = (id: string, name: string) =>
  ({
    id,
    type: 'coil',
    position: { x: 0, y: 0 },
    data: { variant: 'default', variable: { name } },
  }) as unknown as Nodes[number]
const edge = (id: string, source: string, target: string) =>
  ({ id, source, target, sourceHandle: 'output', targetHandle: 'input' }) as unknown as Edges[number]

describe('Execute element — debug power flow', () => {
  it('conducts power through to the next element', () => {
    // leftRail -> execute -> coil
    const nodes: Nodes = [rail('L', 'left'), execute('X'), coil('K', 'done')]
    const edges: Edges = [edge('e1', 'L', 'X'), edge('e2', 'X', 'K')]

    const { edgeStates, nodeInputStates } = computeRungDebugStates(nodes, edges, ctx)

    expect(edgeStates.get('e1')).toBe(true)
    // The one that used to be false: ENO must carry the rail's power onward.
    expect(edgeStates.get('e2')).toBe(true)
    expect(nodeInputStates.get('K')).toBe(true)
  })

  it('stays de-energized when its upstream contact is false', () => {
    const offCtx: LadderDebugContext = { ...ctx, boolValues: new Map([['main:gate', '0']]) }
    const nodes: Nodes = [rail('L', 'left'), contact('C', 'gate'), execute('X'), coil('K', 'done')]
    const edges: Edges = [edge('e1', 'L', 'C'), edge('e2', 'C', 'X'), edge('e3', 'X', 'K')]

    const { edgeStates } = computeRungDebugStates(nodes, edges, offCtx)

    expect(edgeStates.get('e1')).toBe(true)
    expect(edgeStates.get('e2')).toBe(false)
    expect(edgeStates.get('e3')).toBe(false)
  })

  it('passes a true contact through to the coil beyond it', () => {
    const nodes: Nodes = [rail('L', 'left'), contact('C', 'gate'), execute('X'), coil('K', 'done')]
    const edges: Edges = [edge('e1', 'L', 'C'), edge('e2', 'C', 'X'), edge('e3', 'X', 'K')]

    const { edgeStates } = computeRungDebugStates(nodes, edges, ctx)

    expect(edgeStates.get('e2')).toBe(true)
    expect(edgeStates.get('e3')).toBe(true)
  })
})
