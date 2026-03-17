import type { Edge, Node } from '@xyflow/react'
import { produce } from 'immer'
import { createStore } from 'zustand/vanilla'

import { createLadderFlowSlice } from '../slices/ladder/slice'
import type { LadderFlowSlice, LadderFlowType, RungLadderState } from '../slices/ladder/types'

function makeStore() {
  return createStore<LadderFlowSlice>()(createLadderFlowSlice)
}

function makeNode(overrides?: Partial<Node>): Node {
  return {
    id: overrides?.id ?? 'node-1',
    type: overrides?.type ?? 'block',
    position: overrides?.position ?? { x: 0, y: 0 },
    data: overrides?.data ?? { draggable: true },
    draggable: overrides?.draggable ?? true,
    selectable: overrides?.selectable ?? true,
  }
}

function makeEdge(overrides?: Partial<Edge>): Edge {
  return {
    id: overrides?.id ?? 'edge-1',
    source: overrides?.source ?? 'node-1',
    target: overrides?.target ?? 'node-2',
    sourceHandle: overrides?.sourceHandle ?? 'handle-1',
    targetHandle: overrides?.targetHandle ?? 'handle-2',
  }
}

function makeRung(overrides?: Partial<RungLadderState>): RungLadderState {
  return {
    id: overrides?.id ?? 'rung-1',
    comment: overrides?.comment ?? '',
    defaultBounds: overrides?.defaultBounds ?? [800, 200],
    reactFlowViewport: overrides?.reactFlowViewport ?? [800, 200],
    selectedNodes: overrides?.selectedNodes ?? [],
    nodes: overrides?.nodes ?? [
      makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
      makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
    ],
    edges: overrides?.edges ?? [],
  }
}

function makeFlow(overrides?: Partial<LadderFlowType>): LadderFlowType {
  return {
    name: overrides?.name ?? 'flow-1',
    updated: overrides?.updated ?? false,
    rungs: overrides?.rungs ?? [],
  }
}

function seedFlowWithRung(store: ReturnType<typeof makeStore>, editorName = 'editor-1', rung?: RungLadderState) {
  const r = rung ?? makeRung()
  store.getState().ladderFlowActions.addLadderFlow({
    name: editorName,
    updated: true,
    rungs: [r],
  })
  return r
}

describe('createLadderFlowSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // clearLadderFlows
  // -------------------------------------------------------------------------
  it('clearLadderFlows removes all flows', () => {
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'a' }))
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'b' }))

    store.getState().ladderFlowActions.clearLadderFlows()

    expect(store.getState().ladderFlows).toEqual([])
  })

  it('clearLadderFlows on empty state is a no-op', () => {
    store.getState().ladderFlowActions.clearLadderFlows()
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // addLadderFlow
  // -------------------------------------------------------------------------
  it('addLadderFlow adds a new flow', () => {
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'test', rungs: [makeRung()] }))

    const { ladderFlows } = store.getState()
    expect(ladderFlows).toHaveLength(1)
    expect(ladderFlows[0].name).toBe('test')
    expect(ladderFlows[0].rungs).toHaveLength(1)
  })

  it('addLadderFlow clears selectedNodes on all rungs', () => {
    const rung = makeRung({ selectedNodes: [makeNode()] })
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'test', rungs: [rung] }))

    expect(store.getState().ladderFlows[0].rungs[0].selectedNodes).toEqual([])
  })

  it('addLadderFlow replaces existing flow with same name', () => {
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'test', updated: false }))
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'test', updated: true }))

    const { ladderFlows } = store.getState()
    expect(ladderFlows).toHaveLength(1)
    expect(ladderFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // removeLadderFlow
  // -------------------------------------------------------------------------
  it('removeLadderFlow removes flow by name', () => {
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'keep' }))
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'remove' }))

    store.getState().ladderFlowActions.removeLadderFlow('remove')

    const { ladderFlows } = store.getState()
    expect(ladderFlows).toHaveLength(1)
    expect(ladderFlows[0].name).toBe('keep')
  })

  it('removeLadderFlow does nothing for nonexistent name', () => {
    store.getState().ladderFlowActions.addLadderFlow(makeFlow({ name: 'existing' }))

    store.getState().ladderFlowActions.removeLadderFlow('nonexistent')

    expect(store.getState().ladderFlows).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // startLadderRung
  // -------------------------------------------------------------------------
  it('startLadderRung creates a flow and adds the rung', () => {
    store.getState().ladderFlowActions.startLadderRung({
      editorName: 'editor-1',
      rungId: 'rung-1',
      defaultBounds: [800, 200],
    })

    const { ladderFlows } = store.getState()
    expect(ladderFlows).toHaveLength(1)
    expect(ladderFlows[0].name).toBe('editor-1')
    expect(ladderFlows[0].rungs).toHaveLength(1)
    expect(ladderFlows[0].rungs[0].id).toBe('rung-1')
    expect(ladderFlows[0].rungs[0].nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('startLadderRung appends rung to existing flow', () => {
    store.getState().ladderFlowActions.startLadderRung({
      editorName: 'editor-1',
      rungId: 'rung-1',
      defaultBounds: [800, 200],
    })
    store.getState().ladderFlowActions.startLadderRung({
      editorName: 'editor-1',
      rungId: 'rung-2',
      defaultBounds: [800, 200],
    })

    const { ladderFlows } = store.getState()
    expect(ladderFlows).toHaveLength(1)
    expect(ladderFlows[0].rungs).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // setRungs
  // -------------------------------------------------------------------------
  it('setRungs replaces all rungs when valid', () => {
    seedFlowWithRung(store)

    const newRungs = [
      makeRung({ id: 'new-1' }),
      makeRung({
        id: 'new-2',
        nodes: [
          makeNode({ id: 'left-rail-new-2', type: 'powerRail' }),
          makeNode({ id: 'right-rail-new-2', type: 'powerRail' }),
        ],
      }),
    ]

    store.getState().ladderFlowActions.setRungs({ editorName: 'editor-1', rungs: newRungs })

    const flow = store.getState().ladderFlows[0]
    expect(flow.rungs).toHaveLength(2)
    expect(flow.updated).toBe(true)
  })

  it('setRungs rejects rungs missing rail nodes', () => {
    seedFlowWithRung(store)

    const invalidRungs = [makeRung({ id: 'bad', nodes: [makeNode({ id: 'no-rail', type: 'block' })] })]

    store.getState().ladderFlowActions.setRungs({ editorName: 'editor-1', rungs: invalidRungs })

    // Should still have original rung
    expect(store.getState().ladderFlows[0].rungs).toHaveLength(1)
    expect(store.getState().ladderFlows[0].rungs[0].id).toBe('rung-1')
  })

  it('setRungs does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.setRungs({ editorName: 'nonexistent', rungs: [makeRung()] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // removeRung
  // -------------------------------------------------------------------------
  it('removeRung removes a rung by id', () => {
    store.getState().ladderFlowActions.addLadderFlow(
      makeFlow({
        name: 'editor-1',
        rungs: [makeRung({ id: 'rung-1' }), makeRung({ id: 'rung-2' })],
      }),
    )

    store.getState().ladderFlowActions.removeRung('editor-1', 'rung-1')

    const flow = store.getState().ladderFlows[0]
    expect(flow.rungs).toHaveLength(1)
    expect(flow.rungs[0].id).toBe('rung-2')
    expect(flow.updated).toBe(true)
  })

  it('removeRung does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.removeRung('editor-1', 'nonexistent')

    expect(store.getState().ladderFlows[0].rungs).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // addComment
  // -------------------------------------------------------------------------
  it('addComment sets the rung comment', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.addComment({ editorName: 'editor-1', rungId: 'rung-1', comment: 'hello' })

    expect(store.getState().ladderFlows[0].rungs[0].comment).toBe('hello')
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  it('addComment does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.addComment({ editorName: 'editor-1', rungId: 'missing', comment: 'hello' })

    expect(store.getState().ladderFlows[0].rungs[0].comment).toBe('')
  })

  // -------------------------------------------------------------------------
  // duplicateRung
  // -------------------------------------------------------------------------
  it('duplicateRung inserts new rung after the source rung', () => {
    store.getState().ladderFlowActions.addLadderFlow(
      makeFlow({
        name: 'editor-1',
        rungs: [makeRung({ id: 'rung-1' }), makeRung({ id: 'rung-2' })],
      }),
    )

    store.getState().ladderFlowActions.duplicateRung({ editorName: 'editor-1', rungId: 'rung-1' })

    const flow = store.getState().ladderFlows[0]
    expect(flow.rungs).toHaveLength(3)
    expect(flow.rungs[0].id).toBe('rung-1')
    // The duplicated rung has a generated ID
    expect(flow.rungs[1].id).toContain('rung_editor-1_')
    expect(flow.rungs[2].id).toBe('rung-2')
    expect(flow.updated).toBe(true)
  })

  it('duplicateRung does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.duplicateRung({ editorName: 'editor-1', rungId: 'missing' })

    expect(store.getState().ladderFlows[0].rungs).toHaveLength(1)
  })

  it('duplicateRung does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.duplicateRung({ editorName: 'nonexistent', rungId: 'rung-1' })
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // onNodesChange
  // -------------------------------------------------------------------------
  it('onNodesChange applies node changes', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.onNodesChange({
      editorName: 'editor-1',
      rungId: 'rung-1',
      changes: [{ type: 'position', id: 'left-rail-rung-1', position: { x: 100, y: 100 } }],
    })

    const node = store.getState().ladderFlows[0].rungs[0].nodes.find((n) => n.id === 'left-rail-rung-1')
    expect(node?.position).toEqual({ x: 100, y: 100 })
  })

  it('onNodesChange does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.onNodesChange({
      editorName: 'editor-1',
      rungId: 'missing',
      changes: [{ type: 'remove', id: 'whatever' }],
    })

    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // onEdgesChange
  // -------------------------------------------------------------------------
  it('onEdgesChange applies edge changes', () => {
    const rung = makeRung({ edges: [makeEdge({ id: 'e1' })] })
    seedFlowWithRung(store, 'editor-1', rung)

    store.getState().ladderFlowActions.onEdgesChange({
      editorName: 'editor-1',
      rungId: 'rung-1',
      changes: [{ type: 'remove', id: 'e1' }],
    })

    expect(store.getState().ladderFlows[0].rungs[0].edges).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // onConnect
  // -------------------------------------------------------------------------
  it('onConnect adds a connection edge', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.onConnect({
      editorName: 'editor-1',
      rungId: 'rung-1',
      changes: { source: 'node-a', target: 'node-b', sourceHandle: 'h1', targetHandle: 'h2' },
    })

    expect(store.getState().ladderFlows[0].rungs[0].edges).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // setNodes
  // -------------------------------------------------------------------------
  it('setNodes replaces all nodes in a rung', () => {
    seedFlowWithRung(store)
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })]

    store.getState().ladderFlowActions.setNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes })

    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // updateNode
  // -------------------------------------------------------------------------
  it('updateNode replaces a specific node in a rung', () => {
    const rung = makeRung({
      nodes: [
        makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'n1', data: { label: 'old' } }),
      ],
    })
    seedFlowWithRung(store, 'editor-1', rung)

    const updated = makeNode({ id: 'n1', data: { label: 'new' } })
    store
      .getState()
      .ladderFlowActions.updateNode({ editorName: 'editor-1', rungId: 'rung-1', nodeId: 'n1', node: updated })

    const nodes = store.getState().ladderFlows[0].rungs[0].nodes
    expect(nodes.find((n) => n.id === 'n1')?.data.label).toBe('new')
  })

  it('updateNode does nothing for nonexistent node', () => {
    seedFlowWithRung(store)

    store
      .getState()
      .ladderFlowActions.updateNode({ editorName: 'editor-1', rungId: 'rung-1', nodeId: 'missing', node: makeNode() })

    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // addNode
  // -------------------------------------------------------------------------
  it('addNode pushes a node and selects it, deselects others', () => {
    seedFlowWithRung(store)
    const newNode = makeNode({ id: 'new-node' })

    store.getState().ladderFlowActions.addNode({ editorName: 'editor-1', rungId: 'rung-1', node: newNode })

    const rung = store.getState().ladderFlows[0].rungs[0]
    expect(rung.nodes).toHaveLength(3)
    expect(rung.nodes.find((n) => n.id === 'new-node')?.selected).toBe(true)
    expect(rung.nodes.find((n) => n.id === 'left-rail-rung-1')?.selected).toBe(false)
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // removeNodes
  // -------------------------------------------------------------------------
  it('removeNodes removes specified nodes and their connected edges', () => {
    const rung = makeRung({
      nodes: [
        makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'n1' }),
        makeNode({ id: 'n2' }),
      ],
      edges: [
        makeEdge({ id: 'e1', source: 'n1', target: 'n2' }),
        makeEdge({ id: 'e2', source: 'left-rail-rung-1', target: 'n1' }),
      ],
    })
    seedFlowWithRung(store, 'editor-1', rung)

    store
      .getState()
      .ladderFlowActions.removeNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [makeNode({ id: 'n1' })] })

    const updatedRung = store.getState().ladderFlows[0].rungs[0]
    expect(updatedRung.nodes.map((n) => n.id)).toEqual(['left-rail-rung-1', 'right-rail-rung-1', 'n2'])
    expect(updatedRung.edges).toHaveLength(0) // Both edges reference n1
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  it('removeNodes also cleans up selectedNodes', () => {
    const n1 = makeNode({ id: 'n1' })
    const rung = makeRung({
      nodes: [
        makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
        n1,
      ],
      selectedNodes: [n1],
    })
    seedFlowWithRung(store, 'editor-1', rung)

    store.getState().ladderFlowActions.removeNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [n1] })

    expect(store.getState().ladderFlows[0].rungs[0].selectedNodes).toEqual([])
  })

  // -------------------------------------------------------------------------
  // setSelectedNodes
  // -------------------------------------------------------------------------
  it('setSelectedNodes with single node preserves draggable from data', () => {
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: false } })
    const rung = makeRung({
      nodes: [
        makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
        n1,
        n2,
      ],
    })
    seedFlowWithRung(store, 'editor-1', rung)

    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [n1] })

    const updatedRung = store.getState().ladderFlows[0].rungs[0]
    expect(updatedRung.selectedNodes).toHaveLength(1)
    const selectedNode = updatedRung.nodes.find((n) => n.id === 'n1')
    expect(selectedNode?.selected).toBe(true)
    expect(selectedNode?.draggable).toBe(true)
    const otherNode = updatedRung.nodes.find((n) => n.id === 'n2')
    expect(otherNode?.selected).toBe(false)
    expect(otherNode?.draggable).toBe(false)
  })

  it('setSelectedNodes with multiple nodes sets draggable to false for all', () => {
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: true } })
    const rung = makeRung({
      nodes: [
        makeNode({ id: 'left-rail-rung-1', type: 'powerRail' }),
        makeNode({ id: 'right-rail-rung-1', type: 'powerRail' }),
        n1,
        n2,
      ],
    })
    seedFlowWithRung(store, 'editor-1', rung)

    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [n1, n2] })

    const updatedRung = store.getState().ladderFlows[0].rungs[0]
    expect(updatedRung.selectedNodes).toHaveLength(2)
    for (const n of updatedRung.nodes) {
      expect(n.draggable).toBe(false)
    }
  })

  it('setSelectedNodes clears other rungs selected state when nodes are selected', () => {
    store.getState().ladderFlowActions.addLadderFlow(
      makeFlow({
        name: 'editor-1',
        rungs: [makeRung({ id: 'rung-1' }), makeRung({ id: 'rung-2' })],
      }),
    )

    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().ladderFlowActions.setNodes({
      editorName: 'editor-1',
      rungId: 'rung-1',
      nodes: [...store.getState().ladderFlows[0].rungs[0].nodes, node],
    })

    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [node] })

    const flow = store.getState().ladderFlows[0]
    expect(flow.rungs[1].selectedNodes).toEqual([])
  })

  // -------------------------------------------------------------------------
  // setEdges
  // -------------------------------------------------------------------------
  it('setEdges replaces all edges in a rung', () => {
    seedFlowWithRung(store)
    const edges = [makeEdge({ id: 'e1' }), makeEdge({ id: 'e2' })]

    store.getState().ladderFlowActions.setEdges({ editorName: 'editor-1', rungId: 'rung-1', edges })

    expect(store.getState().ladderFlows[0].rungs[0].edges).toHaveLength(2)
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // updateEdge
  // -------------------------------------------------------------------------
  it('updateEdge replaces a specific edge in a rung', () => {
    const rung = makeRung({ edges: [makeEdge({ id: 'e1', source: 'old' })] })
    seedFlowWithRung(store, 'editor-1', rung)

    const updated = makeEdge({ id: 'e1', source: 'new' })
    store
      .getState()
      .ladderFlowActions.updateEdge({ editorName: 'editor-1', rungId: 'rung-1', edgeId: 'e1', edge: updated })

    expect(store.getState().ladderFlows[0].rungs[0].edges[0].source).toBe('new')
  })

  it('updateEdge does nothing for nonexistent edge', () => {
    const rung = makeRung({ edges: [makeEdge({ id: 'e1' })] })
    seedFlowWithRung(store, 'editor-1', rung)

    store
      .getState()
      .ladderFlowActions.updateEdge({ editorName: 'editor-1', rungId: 'rung-1', edgeId: 'missing', edge: makeEdge() })

    expect(store.getState().ladderFlows[0].rungs[0].edges).toHaveLength(1)
    expect(store.getState().ladderFlows[0].rungs[0].edges[0].id).toBe('e1')
  })

  // -------------------------------------------------------------------------
  // addEdge
  // -------------------------------------------------------------------------
  it('addEdge pushes a new edge to a rung', () => {
    seedFlowWithRung(store)

    store
      .getState()
      .ladderFlowActions.addEdge({ editorName: 'editor-1', rungId: 'rung-1', edge: makeEdge({ id: 'e1' }) })

    expect(store.getState().ladderFlows[0].rungs[0].edges).toHaveLength(1)
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // updateReactFlowViewport
  // -------------------------------------------------------------------------
  it('updateReactFlowViewport updates the viewport', () => {
    seedFlowWithRung(store)

    store
      .getState()
      .ladderFlowActions.updateReactFlowViewport({
        editorName: 'editor-1',
        rungId: 'rung-1',
        reactFlowViewport: [1200, 400],
      })

    expect(store.getState().ladderFlows[0].rungs[0].reactFlowViewport).toEqual([1200, 400])
  })

  it('updateReactFlowViewport does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)

    store
      .getState()
      .ladderFlowActions.updateReactFlowViewport({
        editorName: 'editor-1',
        rungId: 'missing',
        reactFlowViewport: [1200, 400],
      })

    expect(store.getState().ladderFlows[0].rungs[0].reactFlowViewport).toEqual([800, 200])
  })

  // -------------------------------------------------------------------------
  // setFlowUpdated
  // -------------------------------------------------------------------------
  it('setFlowUpdated sets the updated flag', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'editor-1', updated: false })
    expect(store.getState().ladderFlows[0].updated).toBe(false)

    store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'editor-1', updated: true })
    expect(store.getState().ladderFlows[0].updated).toBe(true)
  })

  it('setFlowUpdated does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.setFlowUpdated({ editorName: 'nonexistent', updated: true })
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // applyLadderFlowSnapshot
  // -------------------------------------------------------------------------
  it('applyLadderFlowSnapshot adds a new flow when snapshot is provided and flow does not exist', () => {
    const snapshot = makeFlow({
      name: 'other',
      rungs: [makeRung({ comment: 'snap', selectedNodes: [makeNode()] })],
    })

    store.getState().ladderFlowActions.applyLadderFlowSnapshot({ editorName: 'editor-1', snapshot })

    const flow = store.getState().ladderFlows[0]
    expect(flow.name).toBe('editor-1')
    expect(flow.rungs[0].comment).toBe('snap')
    expect(flow.rungs[0].selectedNodes).toEqual([])
  })

  it('applyLadderFlowSnapshot replaces existing flow when snapshot is provided', () => {
    seedFlowWithRung(store)
    const snapshot = makeFlow({ rungs: [makeRung({ comment: 'replaced' })] })

    store.getState().ladderFlowActions.applyLadderFlowSnapshot({ editorName: 'editor-1', snapshot })

    expect(store.getState().ladderFlows).toHaveLength(1)
    expect(store.getState().ladderFlows[0].rungs[0].comment).toBe('replaced')
  })

  it('applyLadderFlowSnapshot removes flow when snapshot is null', () => {
    seedFlowWithRung(store)

    store.getState().ladderFlowActions.applyLadderFlowSnapshot({ editorName: 'editor-1', snapshot: null })

    expect(store.getState().ladderFlows).toEqual([])
  })

  it('applyLadderFlowSnapshot with null snapshot does nothing when flow does not exist', () => {
    store.getState().ladderFlowActions.applyLadderFlowSnapshot({ editorName: 'nonexistent', snapshot: null })
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Guard clause coverage — nonexistent editor/rung
  // -------------------------------------------------------------------------
  it('addComment does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.addComment({ editorName: 'nonexistent', rungId: 'r', comment: 'x' })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('removeRung does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.removeRung('nonexistent', 'r')
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('onNodesChange does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.onNodesChange({ editorName: 'nonexistent', rungId: 'r', changes: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('onEdgesChange does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.onEdgesChange({ editorName: 'nonexistent', rungId: 'r', changes: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('onEdgesChange does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.onEdgesChange({ editorName: 'editor-1', rungId: 'missing', changes: [] })
    expect(store.getState().ladderFlows[0].rungs[0].edges).toEqual([])
  })

  it('onConnect does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.onConnect({
      editorName: 'nonexistent',
      rungId: 'r',
      changes: { source: 'a', target: 'b', sourceHandle: 'h1', targetHandle: 'h2' },
    })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('onConnect does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.onConnect({
      editorName: 'editor-1',
      rungId: 'missing',
      changes: { source: 'a', target: 'b', sourceHandle: 'h1', targetHandle: 'h2' },
    })
    expect(store.getState().ladderFlows[0].rungs[0].edges).toEqual([])
  })

  it('setNodes does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.setNodes({ editorName: 'nonexistent', rungId: 'r', nodes: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('setNodes does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.setNodes({ editorName: 'editor-1', rungId: 'missing', nodes: [] })
    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  it('updateNode does nothing for nonexistent editor', () => {
    store
      .getState()
      .ladderFlowActions.updateNode({ editorName: 'nonexistent', rungId: 'r', nodeId: 'n', node: makeNode() })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('updateNode does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store
      .getState()
      .ladderFlowActions.updateNode({ editorName: 'editor-1', rungId: 'missing', nodeId: 'n', node: makeNode() })
    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  it('addNode does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.addNode({ editorName: 'nonexistent', rungId: 'r', node: makeNode() })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('addNode does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.addNode({ editorName: 'editor-1', rungId: 'missing', node: makeNode() })
    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  it('removeNodes does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.removeNodes({ editorName: 'nonexistent', rungId: 'r', nodes: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('removeNodes does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.removeNodes({ editorName: 'editor-1', rungId: 'missing', nodes: [makeNode()] })
    expect(store.getState().ladderFlows[0].rungs[0].nodes).toHaveLength(2)
  })

  it('setSelectedNodes does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'nonexistent', rungId: 'r', nodes: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('setSelectedNodes does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'missing', nodes: [] })
    expect(store.getState().ladderFlows[0].rungs[0].selectedNodes).toEqual([])
  })

  it('setSelectedNodes with empty array does not clear other rungs', () => {
    store.getState().ladderFlowActions.addLadderFlow(
      makeFlow({
        name: 'editor-1',
        rungs: [makeRung({ id: 'rung-1' }), makeRung({ id: 'rung-2' })],
      }),
    )

    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [] })

    const flow = store.getState().ladderFlows[0]
    expect(flow.rungs).toHaveLength(2)
  })

  it('setEdges does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.setEdges({ editorName: 'nonexistent', rungId: 'r', edges: [] })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('setEdges does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.setEdges({ editorName: 'editor-1', rungId: 'missing', edges: [] })
    expect(store.getState().ladderFlows[0].rungs[0].edges).toEqual([])
  })

  it('updateEdge does nothing for nonexistent editor', () => {
    store
      .getState()
      .ladderFlowActions.updateEdge({ editorName: 'nonexistent', rungId: 'r', edgeId: 'e', edge: makeEdge() })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('updateEdge does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store
      .getState()
      .ladderFlowActions.updateEdge({ editorName: 'editor-1', rungId: 'missing', edgeId: 'e', edge: makeEdge() })
    expect(store.getState().ladderFlows[0].rungs[0].edges).toEqual([])
  })

  it('addEdge does nothing for nonexistent editor', () => {
    store.getState().ladderFlowActions.addEdge({ editorName: 'nonexistent', rungId: 'r', edge: makeEdge() })
    expect(store.getState().ladderFlows).toEqual([])
  })

  it('addEdge does nothing for nonexistent rung', () => {
    seedFlowWithRung(store)
    store.getState().ladderFlowActions.addEdge({ editorName: 'editor-1', rungId: 'missing', edge: makeEdge() })
    expect(store.getState().ladderFlows[0].rungs[0].edges).toEqual([])
  })

  it('updateReactFlowViewport does nothing for nonexistent editor', () => {
    store
      .getState()
      .ladderFlowActions.updateReactFlowViewport({
        editorName: 'nonexistent',
        rungId: 'r',
        reactFlowViewport: [100, 100],
      })
    expect(store.getState().ladderFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Defensive guard coverage — unreachable under TypeScript but present as runtime safety
  // -------------------------------------------------------------------------
  it('setRungs rejects non-array rungs at runtime', () => {
    seedFlowWithRung(store)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.getState().ladderFlowActions.setRungs({ editorName: 'editor-1', rungs: 'not-an-array' as any })
    expect(store.getState().ladderFlows[0].rungs).toHaveLength(1)
  })

  it('setSelectedNodes initializes selectedNodes when undefined', () => {
    seedFlowWithRung(store)
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().ladderFlowActions.setNodes({
      editorName: 'editor-1',
      rungId: 'rung-1',
      nodes: [...store.getState().ladderFlows[0].rungs[0].nodes, node],
    })
    // Artificially nullify selectedNodes to exercise the defensive guard
    store.setState(
      produce((state: LadderFlowSlice) => {
        state.ladderFlows[0].rungs[0].selectedNodes = undefined as unknown as Node[]
      }),
    )
    store.getState().ladderFlowActions.setSelectedNodes({ editorName: 'editor-1', rungId: 'rung-1', nodes: [node] })

    expect(store.getState().ladderFlows[0].rungs[0].selectedNodes).toBeDefined()
  })
})
