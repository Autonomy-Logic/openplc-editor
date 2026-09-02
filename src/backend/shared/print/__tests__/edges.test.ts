import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/system'

import { edgeToDrawOp, isVisibleEdge } from '../edges'

function makeNode(overrides: Partial<Node> & { id: string; position: { x: number; y: number } }): Node {
  return { data: {}, ...overrides }
}

describe('isVisibleEdge', () => {
  it('returns false when the source or target node is missing from the map', () => {
    const nodesById = new Map<string, Node>([['a', makeNode({ id: 'a', position: { x: 0, y: 0 } })]])
    expect(isVisibleEdge(nodesById, { id: 'e1', source: 'a', target: 'missing' })).toBe(false)
    expect(isVisibleEdge(nodesById, { id: 'e2', source: 'missing', target: 'a' })).toBe(false)
  })

  it('returns false when either endpoint is a hidden structural node type', () => {
    const nodesById = new Map<string, Node>([
      ['a', makeNode({ id: 'a', position: { x: 0, y: 0 }, type: 'placeholder' })],
      ['b', makeNode({ id: 'b', position: { x: 10, y: 0 }, type: 'block' })],
    ])
    expect(isVisibleEdge(nodesById, { id: 'e1', source: 'a', target: 'b' })).toBe(false)
  })

  it('returns true for two ordinary node types', () => {
    const nodesById = new Map<string, Node>([
      ['a', makeNode({ id: 'a', position: { x: 0, y: 0 }, type: 'block' })],
      ['b', makeNode({ id: 'b', position: { x: 10, y: 0 }, type: 'coil' })],
    ])
    expect(isVisibleEdge(nodesById, { id: 'e1', source: 'a', target: 'b' })).toBe(true)
  })
})

describe('edgeToDrawOp', () => {
  it('returns undefined when the source or target node is missing', () => {
    const nodesById = new Map<string, Node>([['a', makeNode({ id: 'a', position: { x: 0, y: 0 } })]])
    const edge: Edge = { id: 'e1', source: 'a', target: 'missing' }
    expect(edgeToDrawOp(nodesById, edge, '#000000', 1)).toBeUndefined()
  })

  it('resolves handle position from node.data.handles when the handle id matches', () => {
    const source = makeNode({
      id: 'a',
      position: { x: 0, y: 0 },
      data: { handles: [{ id: 'out', position: Position.Right, relPosition: { x: 20, y: 5 } }] },
    })
    const target = makeNode({
      id: 'b',
      position: { x: 100, y: 0 },
      data: { handles: [{ id: 'in', position: Position.Left, relPosition: { x: 0, y: 5 } }] },
    })
    const nodesById = new Map<string, Node>([
      ['a', source],
      ['b', target],
    ])
    const edge: Edge = { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }

    const op = edgeToDrawOp(nodesById, edge, '#0464FB', 1.5)

    expect(op).toBeDefined()
    expect(op?.kind).toBe('path')
    if (op?.kind === 'path') {
      expect(typeof op.d).toBe('string')
      expect(op.d.length).toBeGreaterThan(0)
      expect(op.stroke).toBe('#0464FB')
      expect(op.strokeWidthPt).toBe(1.5)
    }
  })

  it('falls back to the node position and default side when the handle id is not found', () => {
    const source = makeNode({ id: 'a', position: { x: 0, y: 0 }, data: {} })
    const target = makeNode({ id: 'b', position: { x: 100, y: 50 }, data: {} })
    const nodesById = new Map<string, Node>([
      ['a', source],
      ['b', target],
    ])
    const edge: Edge = { id: 'e1', source: 'a', target: 'b', sourceHandle: null, targetHandle: undefined }

    const op = edgeToDrawOp(nodesById, edge, '#000000', 1)

    expect(op?.kind).toBe('path')
  })

  it('ignores a handle entry with a position string that is not a valid Position enum value', () => {
    const source = makeNode({
      id: 'a',
      position: { x: 0, y: 0 },
      data: { handles: [{ id: 'out', position: 'diagonal', relPosition: { x: 5, y: 5 } }] },
    })
    const target = makeNode({ id: 'b', position: { x: 50, y: 50 }, data: {} })
    const nodesById = new Map<string, Node>([
      ['a', source],
      ['b', target],
    ])
    const edge: Edge = { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out' }

    const op = edgeToDrawOp(nodesById, edge, '#000000', 1)

    expect(op?.kind).toBe('path')
  })
})
