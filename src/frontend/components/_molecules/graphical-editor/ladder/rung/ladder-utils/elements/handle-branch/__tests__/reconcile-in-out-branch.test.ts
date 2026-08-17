import type { RungLadderState } from '@root/frontend/store/slices'
import type { Node } from '@xyflow/react'

import { reconcileBranches } from '../index'

const bool = { definition: 'base-type' as const, value: 'BOOL' }

/**
 * A rung holding a block with a BOOL `VAR_IN_OUT` (`Flag`) that, under the old two-sided rule,
 * had an output-side pin — and a coil branched off it.
 *
 * This is the shape that made a name-only survival check dangerous: `Flag` is still declared and
 * still BOOL, so the branch looked healthy while its pin had moved to the input side.
 */
const rungWithOutputBranchOnInOut = (): RungLadderState => {
  const rail = {
    id: 'right-rail-1',
    type: 'powerRail',
    position: { x: 900, y: 0 },
    data: {
      handles: [
        { id: 'rail-in', type: 'target', glbPosition: { x: 900, y: 36 }, relPosition: { x: 0, y: 36 } },
        { id: 'branch_B1_Flag', type: 'target', glbPosition: { x: 900, y: 116 }, relPosition: { x: 0, y: 116 } },
      ],
      inputHandles: [],
      outputHandles: [],
      inputConnector: undefined,
      outputConnector: undefined,
      numericId: '1',
      executionOrder: 0,
      variable: { name: '' },
      draggable: false,
      selectable: false,
      deletable: false,
    },
  } as unknown as Node

  const block = {
    id: 'B1',
    type: 'block',
    position: { x: 200, y: 0 },
    data: { handles: [], inputHandles: [], outputHandles: [], numericId: '2' },
  } as unknown as Node

  const coil = {
    id: 'COIL1',
    type: 'coil',
    position: { x: 500, y: 80 },
    data: {
      handles: [],
      inputHandles: [],
      outputHandles: [],
      numericId: '3',
      branchContext: { blockId: 'B1', handleId: 'Flag' },
    },
  } as unknown as Node

  return {
    id: 'rung-1',
    comment: '',
    defaultBounds: [1000, 200],
    nodes: [rail, block, coil],
    edges: [
      { id: 'e-b1-coil', source: 'B1', sourceHandle: 'Flag', target: 'COIL1', targetHandle: 'coil-in' },
      {
        id: 'e-coil-rail',
        source: 'COIL1',
        sourceHandle: 'coil-out',
        target: 'right-rail-1',
        targetHandle: 'branch_B1_Flag',
      },
    ],
    handleBranches: [{ blockId: 'B1', handleId: 'Flag', direction: 'output', nodeIds: ['COIL1'] }],
    selectedNodes: [],
  } as unknown as RungLadderState
}

describe('reconciling a branch when VAR_IN_OUT loses its output pin', () => {
  it('tears the output branch down instead of remapping it onto a pin that is gone', () => {
    const rung = rungWithOutputBranchOnInOut()
    const result = reconcileBranches(rung, 'B1', 'B2', [
      { name: 'Trig', class: 'input', type: bool },
      { name: 'Flag', class: 'inOut', type: bool },
      { name: 'Out1', class: 'output', type: bool },
    ] as never)

    // The coil and both of its edges are gone — not silently pointed at a missing handle.
    expect(result.nodes.map((n) => n.id)).toEqual(['right-rail-1', 'B1'])
    expect(result.edges).toEqual([])
    expect(result.handleBranches).toEqual([])
    // The rail's branch handle is torn down with it.
    const rail = result.nodes.find((n) => n.id === 'right-rail-1')
    expect((rail?.data as { handles: { id: string }[] }).handles.map((h) => h.id)).toEqual(['rail-in'])
  })

  it('keeps the branch when the pin really does stay on the output side', () => {
    const rung = rungWithOutputBranchOnInOut()
    // Same rung, but `Flag` is a plain output now — the branch has somewhere to live.
    const result = reconcileBranches(rung, 'B1', 'B2', [{ name: 'Flag', class: 'output', type: bool }] as never)

    expect(result.nodes.map((n) => n.id)).toContain('COIL1')
    expect(result.handleBranches).toEqual([
      { blockId: 'B2', handleId: 'Flag', direction: 'output', nodeIds: ['COIL1'] },
    ])
    // And it is remapped onto the NEW block id.
    expect(result.edges.find((e) => e.target === 'COIL1')?.source).toBe('B2')
  })
})
