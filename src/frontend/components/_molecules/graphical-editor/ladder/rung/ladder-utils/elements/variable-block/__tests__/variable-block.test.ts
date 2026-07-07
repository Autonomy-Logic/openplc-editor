/**
 * updateVariableBlockPosition destroys and rebuilds every variable node on
 * each layout pass. These tests pin the identity-reuse contract: a rebuilt
 * variable node for an unchanged attachment point (block id + handle id +
 * side) must keep its previous `id` and `data.numericId`, so a net-identical
 * graph stays byte-identical when serialized (no phantom source-control
 * modifications after drag-away-and-back).
 */
import type { RungLadderState } from '@root/frontend/store/slices'
import type { Node } from '@xyflow/react'

import { updateVariableBlockPosition } from '../index'

const makeHandle = (id: string, x: number, y: number) => ({
  id,
  glbPosition: { x, y },
})

const makeBlockNode = (): Node =>
  ({
    id: 'BLOCK_1',
    type: 'block',
    position: { x: 200, y: 40 },
    data: {
      variant: { name: 'CTU', type: 'function-block', variables: [] },
      inputHandles: [makeHandle('EN', 200, 50), makeHandle('CU', 200, 70), makeHandle('PV', 200, 90)],
      outputHandles: [makeHandle('ENO', 300, 50), makeHandle('CV', 300, 70)],
      connectedVariables: [],
    },
  }) as unknown as Node

const makeVariableNode = (id: string, handleId: string, variant: 'input' | 'output', numericId: number): Node =>
  ({
    id,
    type: 'variable',
    position: { x: 0, y: 0 },
    data: {
      variant,
      block: { id: 'BLOCK_1', handleId },
      numericId,
    },
  }) as unknown as Node

const makeRung = (nodes: Node[]): RungLadderState =>
  ({
    id: 'rung-1',
    comment: '',
    defaultBounds: [800, 200],
    reactFlowViewport: [800, 200],
    selectedNodes: [],
    nodes,
    edges: [],
  }) as unknown as RungLadderState

describe('updateVariableBlockPosition identity reuse', () => {
  it('reuses id and numericId for unchanged attachment points', () => {
    const rung = makeRung([
      makeBlockNode(),
      makeVariableNode('VARIABLE_prev_cu', 'CU', 'input', 111),
      makeVariableNode('VARIABLE_prev_pv', 'PV', 'input', 222),
      makeVariableNode('VARIABLE_prev_cv', 'CV', 'output', 333),
    ])

    const { nodes } = updateVariableBlockPosition(rung)
    const variables = nodes.filter((n) => n.type === 'variable')

    expect(variables).toHaveLength(3)
    const byHandle = new Map(variables.map((n) => [(n.data as { block: { handleId: string } }).block.handleId, n]))
    expect(byHandle.get('CU')?.id).toBe('VARIABLE_prev_cu')
    expect((byHandle.get('CU')?.data as { numericId: number }).numericId).toBe(111)
    expect(byHandle.get('PV')?.id).toBe('VARIABLE_prev_pv')
    expect((byHandle.get('PV')?.data as { numericId: number }).numericId).toBe(222)
    expect(byHandle.get('CV')?.id).toBe('VARIABLE_prev_cv')
    expect((byHandle.get('CV')?.data as { numericId: number }).numericId).toBe(333)
  })

  it('is idempotent: a second rebuild produces identical variable identities', () => {
    const rung = makeRung([makeBlockNode()])

    const first = updateVariableBlockPosition(rung)
    const second = updateVariableBlockPosition(makeRung(first.nodes))

    const identity = (ns: Node[]) =>
      ns
        .filter((n) => n.type === 'variable')
        .map((n) => `${n.id}::${(n.data as { numericId: number }).numericId}`)
        .sort()
    expect(identity(second.nodes)).toEqual(identity(first.nodes))
  })

  it('mints fresh ids for attachment points with no previous variable node', () => {
    const rung = makeRung([makeBlockNode(), makeVariableNode('VARIABLE_prev_cu', 'CU', 'input', 111)])

    const { nodes } = updateVariableBlockPosition(rung)
    const variables = nodes.filter((n) => n.type === 'variable')

    expect(variables).toHaveLength(3)
    const cu = variables.find((n) => (n.data as { block: { handleId: string } }).block.handleId === 'CU')
    const pv = variables.find((n) => (n.data as { block: { handleId: string } }).block.handleId === 'PV')
    expect(cu?.id).toBe('VARIABLE_prev_cu')
    expect(pv?.id).toMatch(/^VARIABLE_/)
    expect(pv?.id).not.toBe('VARIABLE_prev_pv')
  })

  it('reuses identities from previousNodes when the rung was stripped upstream', () => {
    // Simulates the drag-drop pipeline: prepareDropState removes variable
    // nodes before layout, so the rung reaching the rebuild has none — the
    // pre-drop node set is passed separately as the identity source.
    const strippedRung = makeRung([makeBlockNode()])
    const preDropNodes = [
      makeBlockNode(),
      makeVariableNode('VARIABLE_prev_cu', 'CU', 'input', 111),
      makeVariableNode('VARIABLE_prev_pv', 'PV', 'input', 222),
      makeVariableNode('VARIABLE_prev_cv', 'CV', 'output', 333),
    ]

    const { nodes } = updateVariableBlockPosition(strippedRung, preDropNodes)
    const variables = nodes.filter((n) => n.type === 'variable')

    expect(variables).toHaveLength(3)
    const byHandle = new Map(variables.map((n) => [(n.data as { block: { handleId: string } }).block.handleId, n]))
    expect(byHandle.get('CU')?.id).toBe('VARIABLE_prev_cu')
    expect(byHandle.get('PV')?.id).toBe('VARIABLE_prev_pv')
    expect(byHandle.get('CV')?.id).toBe('VARIABLE_prev_cv')
    expect((byHandle.get('CV')?.data as { numericId: number }).numericId).toBe(333)
  })

  it('prefers identities from the rung itself over previousNodes', () => {
    const rung = makeRung([makeBlockNode(), makeVariableNode('VARIABLE_current_cu', 'CU', 'input', 999)])
    const preDropNodes = [makeVariableNode('VARIABLE_stale_cu', 'CU', 'input', 111)]

    const { nodes } = updateVariableBlockPosition(rung, preDropNodes)
    const cu = nodes.find(
      (n) => n.type === 'variable' && (n.data as { block: { handleId: string } }).block.handleId === 'CU',
    )

    expect(cu?.id).toBe('VARIABLE_current_cu')
    expect((cu?.data as { numericId: number }).numericId).toBe(999)
  })

  it('ignores previous variable nodes with incomplete identity data', () => {
    const brokenVariable = {
      id: 'VARIABLE_broken',
      type: 'variable',
      position: { x: 0, y: 0 },
      data: { variant: 'input', block: { id: 'BLOCK_1' } },
    } as unknown as Node

    const rung = makeRung([makeBlockNode(), brokenVariable])
    const { nodes } = updateVariableBlockPosition(rung)
    const variables = nodes.filter((n) => n.type === 'variable')

    expect(variables).toHaveLength(3)
    expect(variables.every((n) => n.id !== 'VARIABLE_broken')).toBe(true)
  })
})
