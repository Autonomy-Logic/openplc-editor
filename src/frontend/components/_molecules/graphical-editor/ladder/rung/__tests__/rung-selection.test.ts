import type { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../../../../../middleware/shared/ports/types'
import { getFunctionBlockVariablesToCleanup } from '../../../../../../utils/graphical/get-function-block-variables-to-cleanup'
import { isSameSelection, resolveSelectedNodes } from '../selection'

const node = (id: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Node => ({
  id,
  type: 'contact',
  position: { x: 0, y: 0 },
  data,
  ...extra,
})

const fbBlock = (id: string, instance: string): Node => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: { variable: { name: instance }, variant: { name: 'TON', type: 'function-block' } },
})

const fbVariable = (name: string): PLCVariable =>
  ({ name, class: 'local', type: { definition: 'derived', value: 'TON' } }) as unknown as PLCVariable

describe('isSameSelection', () => {
  it('matches the same ids even when the local copies carry extra fields', () => {
    const stored = [node('A'), node('B')]
    const local = [
      node('B', { variable: { name: 'renamed' } }, { selected: true, measured: { width: 10, height: 10 } }),
      node('A', {}, { selected: true, dragging: false }),
    ]
    expect(isSameSelection(local, stored)).toBe(true)
  })

  it('treats an empty local selection and a missing stored one as the same', () => {
    expect(isSameSelection([], undefined)).toBe(true)
    expect(isSameSelection([], [])).toBe(true)
  })

  it('differs when a node is added, removed or swapped', () => {
    expect(isSameSelection([node('A'), node('B')], [node('A')])).toBe(false)
    expect(isSameSelection([node('A')], [node('A'), node('B')])).toBe(false)
    expect(isSameSelection([node('A')], [node('B')])).toBe(false)
    expect(isSameSelection([node('A')], undefined)).toBe(false)
  })
})

describe('resolveSelectedNodes', () => {
  it('returns the current node data, not the copy stored in the selection', () => {
    const rung = {
      nodes: [fbBlock('BLK', 'TON1'), node('C')],
      selectedNodes: [fbBlock('BLK', 'TON0')],
    }
    const resolved = resolveSelectedNodes(rung)
    expect(resolved).toEqual([rung.nodes[0]])
  })

  it('drops selected ids that are no longer in the rung', () => {
    expect(resolveSelectedNodes({ nodes: [node('A')], selectedNodes: [node('A'), node('GONE')] })).toEqual([node('A')])
    expect(resolveSelectedNodes({ nodes: [node('A')] })).toEqual([])
  })

  it('cleans up the renamed instance when the edited block is removed', () => {
    const rung = { nodes: [fbBlock('BLK', 'TON1')], selectedNodes: [fbBlock('BLK', 'TON0')] }
    const variables = [fbVariable('TON0'), fbVariable('TON1')]

    const removed = resolveSelectedNodes(rung)
    const remainingRungs = [{ nodes: rung.nodes.filter((n) => !removed.includes(n)) }]

    expect(getFunctionBlockVariablesToCleanup(removed, remainingRungs, variables)).toEqual(['TON1'])
  })
})
