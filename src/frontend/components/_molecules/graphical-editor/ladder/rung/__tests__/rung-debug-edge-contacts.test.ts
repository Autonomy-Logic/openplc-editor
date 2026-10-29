import type { RungLadderState } from '../../../../../../store/slices/ladder'
import { computeRungDebugStates, type LadderDebugContext } from '../rung-debug-states'

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data })

// L -> contact -> coil -> R, so the edge from the contact carries the contact's output.
const rungWith = (variant: string, numericId?: string) => ({
  nodes: [
    node('L', 'powerRail', { variant: 'left' }),
    node('C', 'contact', { variant, variable: { name: 'LED' }, ...(numericId ? { numericId } : {}) }),
    node('K', 'coil', { variant: 'default', variable: { name: 'OUT' } }),
    node('R', 'powerRail', { variant: 'right' }),
  ] as unknown as RungLadderState['nodes'],
  edges: [
    { id: 'L-C', source: 'L', target: 'C' },
    { id: 'C-K', source: 'C', target: 'K' },
    { id: 'K-R', source: 'K', target: 'R' },
  ] as unknown as RungLadderState['edges'],
})

const ctx = (values: Record<string, string>): LadderDebugContext => ({
  isFunctionBlockPou: false,
  hasProgramInstance: true,
  getCompositeKey: (name) => `MAIN:${name}`,
  boolValues: new Map(Object.entries(values).map(([k, v]) => [`MAIN:${k}`, v])),
})

const contactOutput = (variant: string, values: Record<string, string>, numericId?: string) => {
  const { nodes, edges } = rungWith(variant, numericId)
  return computeRungDebugStates(nodes, edges, ctx(values)).edgeStates.get('C-K')
}

describe('computeRungDebugStates with edge contacts', () => {
  it('keeps a plain contact on the variable level', () => {
    expect(contactOutput('default', { LED: 'TRUE' }, '7')).toBe(true)
  })

  it('does not pass power through a rising contact whose variable is held TRUE', () => {
    expect(contactOutput('risingEdge', { LED: 'TRUE', '_TMP_R_TRIG7.Q': 'FALSE' }, '7')).toBe(false)
  })

  it('does not pass power through a falling contact whose variable is held TRUE', () => {
    expect(contactOutput('fallingEdge', { LED: 'TRUE', '_TMP_F_TRIG7.Q': 'FALSE' }, '7')).toBe(false)
  })

  it('passes power in the scan the trigger fires', () => {
    expect(contactOutput('risingEdge', { LED: 'TRUE', '_TMP_R_TRIG7.Q': 'TRUE' }, '7')).toBe(true)
    expect(contactOutput('fallingEdge', { LED: 'FALSE', '_TMP_F_TRIG7.Q': 'TRUE' }, '7')).toBe(true)
  })

  it('never falls back to the variable when the trigger cannot be resolved', () => {
    expect(contactOutput('risingEdge', { LED: 'TRUE' }, '7')).toBe(false)
    expect(contactOutput('risingEdge', { LED: 'TRUE' })).toBe(false)
  })
})
