import type { BlockVariant } from '@root/middleware/shared/ports/block-types'
import type { HandleBranch, RungLadderState } from '@root/middleware/shared/ports/types'
import type { Edge, Node } from '@xyflow/react'

import { reconcileBranches } from '../index'

type BlockVariables = BlockVariant['variables']

const bool = (): BlockVariables[number]['type'] => ({ definition: 'base-type', value: 'BOOL' })
const int = (): BlockVariables[number]['type'] => ({ definition: 'base-type', value: 'INT' })

const variable = (name: string, cls: BlockVariables[number]['class'], type = bool()): BlockVariables[number] => ({
  name,
  class: cls,
  type,
})

/**
 * `reconcileBranches` reads its nodes through `BasicNodeData`, so a fixture only has to carry the
 * fields it actually touches: `handles` on the rail, `branchContext` on a branch element. Built as
 * real `Node`s rather than cast into shape, so a change to the node contract fails here.
 */
const node = (id: string, type: string, data: Record<string, unknown>): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { handles: [], inputHandles: [], outputHandles: [], numericId: id, ...data },
})

const handle = (id: string, y: number): Record<string, unknown> => ({
  id,
  type: 'target',
  glbPosition: { x: 900, y },
  relPosition: { x: 0, y },
})

const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
})

const outputBranchOnFlag: HandleBranch = {
  blockId: 'B1',
  handleId: 'Flag',
  direction: 'output',
  nodeIds: ['COIL1'],
}

/**
 * A rung holding a block with a BOOL `VAR_IN_OUT` (`Flag`) that, under the old two-sided rule, had
 * an output-side pin — and a coil branched off it.
 *
 * This is the shape that made a name-only survival check dangerous: `Flag` is still declared and
 * still BOOL, so the branch looked healthy while its pin had moved to the input side.
 */
const rungWithOutputBranchOnInOut = (): RungLadderState => ({
  id: 'rung-1',
  comment: '',
  defaultBounds: [1000, 200],
  reactFlowViewport: [0, 0],
  selectedNodes: [],
  nodes: [
    node('right-rail-1', 'powerRail', { handles: [handle('rail-in', 36), handle('branch_B1_Flag', 116)] }),
    node('B1', 'block', {}),
    node('COIL1', 'coil', { branchContext: { blockId: 'B1', handleId: 'Flag' } }),
  ],
  edges: [
    edge('e-b1-coil', 'B1', 'Flag', 'COIL1', 'coil-in'),
    edge('e-coil-rail', 'COIL1', 'coil-out', 'right-rail-1', 'branch_B1_Flag'),
  ],
  handleBranches: [outputBranchOnFlag],
})

const railHandleIds = (nodes: Node[]): unknown[] => {
  const rail = nodes.find((n) => n.id === 'right-rail-1')
  const handles = rail?.data.handles
  return Array.isArray(handles) ? handles.map((h) => (h as { id: string }).id) : []
}

describe('reconciling a branch when VAR_IN_OUT loses its output pin', () => {
  it('tears the output branch down instead of remapping it onto a pin that is gone', () => {
    const result = reconcileBranches(rungWithOutputBranchOnInOut(), 'B1', 'B2', [
      variable('Trig', 'input'),
      variable('Flag', 'inOut'),
      variable('Out1', 'output'),
    ])

    // The coil and both of its edges are gone — not silently pointed at a missing handle.
    expect(result.nodes.map((n) => n.id)).toEqual(['right-rail-1', 'B1'])
    expect(result.edges).toEqual([])
    expect(result.handleBranches).toEqual([])
    // The rail's branch handle is torn down with it.
    expect(railHandleIds(result.nodes)).toEqual(['rail-in'])
  })

  it('keeps the branch when the pin really does stay on the output side', () => {
    // Same rung, but `Flag` is a plain output now — the branch has somewhere to live.
    const result = reconcileBranches(rungWithOutputBranchOnInOut(), 'B1', 'B2', [variable('Flag', 'output')])

    expect(result.nodes.map((n) => n.id)).toContain('COIL1')
    expect(result.handleBranches).toEqual([{ ...outputBranchOnFlag, blockId: 'B2' }])
    // And it is remapped onto the NEW block id.
    expect(result.edges.find((e) => e.target === 'COIL1')?.source).toBe('B2')
  })

  it('tears the branch down when the pin stops being BOOL-compatible', () => {
    const result = reconcileBranches(rungWithOutputBranchOnInOut(), 'B1', 'B2', [variable('Flag', 'output', int())])

    expect(result.nodes.map((n) => n.id)).not.toContain('COIL1')
    expect(result.handleBranches).toEqual([])
  })
})
