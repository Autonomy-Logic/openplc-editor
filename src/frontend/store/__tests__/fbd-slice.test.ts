import type { Edge, Node } from '@xyflow/react'
import { produce } from 'immer'
import { createStore } from 'zustand/vanilla'

import { createFBDFlowSlice } from '../slices/fbd/slice'
import type { FBDFlowSlice, FBDFlowType, FBDRungState } from '../slices/fbd/types'

function makeStore() {
  return createStore<FBDFlowSlice>()(createFBDFlowSlice)
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

function makeRung(overrides?: Partial<FBDRungState>): FBDRungState {
  return {
    comment: overrides?.comment ?? '',
    selectedNodes: overrides?.selectedNodes ?? [],
    nodes: overrides?.nodes ?? [],
    edges: overrides?.edges ?? [],
  }
}

function makeFlow(overrides?: Partial<FBDFlowType>): FBDFlowType {
  return {
    name: overrides?.name ?? 'flow-1',
    updated: overrides?.updated ?? false,
    rung: overrides?.rung ?? makeRung(),
  }
}

describe('createFBDFlowSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('should have correct initial state', () => {
    const state = store.getState()
    expect(state.fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // clearFBDFlows
  // -------------------------------------------------------------------------
  it('clearFBDFlows removes all flows', () => {
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'a' }))
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'b' }))

    store.getState().fbdFlowActions.clearFBDFlows()

    expect(store.getState().fbdFlows).toEqual([])
  })

  it('clearFBDFlows on empty state is a no-op', () => {
    store.getState().fbdFlowActions.clearFBDFlows()
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // addFBDFlow
  // -------------------------------------------------------------------------
  it('addFBDFlow adds a new flow', () => {
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'test' }))

    const { fbdFlows } = store.getState()
    expect(fbdFlows).toHaveLength(1)
    expect(fbdFlows[0].name).toBe('test')
  })

  it('addFBDFlow clears selectedNodes on added flow', () => {
    const rung = makeRung({ selectedNodes: [makeNode()] })
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'test', rung }))

    const { fbdFlows } = store.getState()
    expect(fbdFlows[0].rung.selectedNodes).toEqual([])
  })

  it('addFBDFlow replaces existing flow with same name', () => {
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'test', updated: false }))
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'test', updated: true }))

    const { fbdFlows } = store.getState()
    expect(fbdFlows).toHaveLength(1)
    // addFBDFlow always resets updated to false on load — the flow is being loaded from a saved project.
    expect(fbdFlows[0].updated).toBe(false)
  })

  // -------------------------------------------------------------------------
  // removeFBDFlow
  // -------------------------------------------------------------------------
  it('removeFBDFlow removes flow by name', () => {
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'keep' }))
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'remove' }))

    store.getState().fbdFlowActions.removeFBDFlow('remove')

    const { fbdFlows } = store.getState()
    expect(fbdFlows).toHaveLength(1)
    expect(fbdFlows[0].name).toBe('keep')
  })

  it('removeFBDFlow does nothing for nonexistent name', () => {
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'existing' }))

    store.getState().fbdFlowActions.removeFBDFlow('nonexistent')

    expect(store.getState().fbdFlows).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // startFBDRung
  // -------------------------------------------------------------------------
  it('startFBDRung creates a new flow if none exists', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    const { fbdFlows } = store.getState()
    expect(fbdFlows).toHaveLength(1)
    expect(fbdFlows[0].name).toBe('editor-1')
    expect(fbdFlows[0].rung.nodes).toEqual([])
    expect(fbdFlows[0].rung.edges).toEqual([])
    expect(fbdFlows[0].rung.comment).toBe('')
    expect(fbdFlows[0].rung.selectedNodes).toEqual([])
  })

  it('startFBDRung resets rung of existing flow', () => {
    const rung = makeRung({ comment: 'old', nodes: [makeNode()], edges: [makeEdge()] })
    store.getState().fbdFlowActions.addFBDFlow(makeFlow({ name: 'editor-1', rung }))

    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes).toEqual([])
    expect(flow.rung.edges).toEqual([])
    expect(flow.rung.comment).toBe('')
  })

  // -------------------------------------------------------------------------
  // setRung
  // -------------------------------------------------------------------------
  it('setRung replaces the rung and marks flow updated', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const newRung = makeRung({ comment: 'new comment', nodes: [makeNode()] })

    store.getState().fbdFlowActions.setRung({ editorName: 'editor-1', rung: newRung })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.comment).toBe('new comment')
    expect(flow.rung.nodes).toHaveLength(1)
    expect(flow.updated).toBe(true)
  })

  it('setRung does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.setRung({ editorName: 'nonexistent', rung: makeRung() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // addComment
  // -------------------------------------------------------------------------
  it('addComment sets the rung comment', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    store.getState().fbdFlowActions.addComment({ editorName: 'editor-1', comment: 'hello' })

    expect(store.getState().fbdFlows[0].rung.comment).toBe('hello')
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  it('addComment does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.addComment({ editorName: 'nonexistent', comment: 'hello' })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // onConnect
  // -------------------------------------------------------------------------
  it('onConnect adds a connection edge', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    store.getState().fbdFlowActions.onConnect({
      editorName: 'editor-1',
      changes: {
        source: 'node-1',
        target: 'node-2',
        sourceHandle: 'h1',
        targetHandle: 'h2',
      },
    })

    const { edges } = store.getState().fbdFlows[0].rung
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe('node-1')
    expect(edges[0].target).toBe('node-2')
  })

  // -------------------------------------------------------------------------
  // setNodes
  // -------------------------------------------------------------------------
  it('setNodes replaces all nodes', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })]

    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes })

    expect(store.getState().fbdFlows[0].rung.nodes).toHaveLength(2)
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  it('setNodes does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.setNodes({ editorName: 'nonexistent', nodes: [] })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // updateNode
  // -------------------------------------------------------------------------
  it('updateNode replaces a specific node', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setNodes({
      editorName: 'editor-1',
      nodes: [makeNode({ id: 'n1', data: { label: 'old' } })],
    })

    const updated = makeNode({ id: 'n1', data: { label: 'new' } })
    store.getState().fbdFlowActions.updateNode({ editorName: 'editor-1', nodeId: 'n1', node: updated })

    expect(store.getState().fbdFlows[0].rung.nodes[0].data.label).toBe('new')
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  it('updateNode does nothing for nonexistent node', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setNodes({
      editorName: 'editor-1',
      nodes: [makeNode({ id: 'n1' })],
    })

    store.getState().fbdFlowActions.updateNode({ editorName: 'editor-1', nodeId: 'missing', node: makeNode() })

    expect(store.getState().fbdFlows[0].rung.nodes).toHaveLength(1)
    expect(store.getState().fbdFlows[0].rung.nodes[0].id).toBe('n1')
  })

  // -------------------------------------------------------------------------
  // addNode
  // -------------------------------------------------------------------------
  it('addNode pushes a node and selects it', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setNodes({
      editorName: 'editor-1',
      nodes: [makeNode({ id: 'existing' })],
    })

    store.getState().fbdFlowActions.addNode({ editorName: 'editor-1', node: makeNode({ id: 'new' }) })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes).toHaveLength(2)
    expect(flow.rung.nodes.find((n) => n.id === 'new')?.selected).toBe(true)
    expect(flow.rung.nodes.find((n) => n.id === 'existing')?.selected).toBe(false)
    expect(flow.rung.selectedNodes).toHaveLength(1)
    expect(flow.rung.selectedNodes[0].id).toBe('new')
    expect(flow.updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // removeNodes
  // -------------------------------------------------------------------------
  it('removeNodes removes specified nodes and their selected entries', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const n1 = makeNode({ id: 'n1' })
    const n2 = makeNode({ id: 'n2' })
    const n3 = makeNode({ id: 'n3' })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [n1, n2, n3] })

    store.getState().fbdFlowActions.removeNodes({ editorName: 'editor-1', nodes: [n1, n3] })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes).toHaveLength(1)
    expect(flow.rung.nodes[0].id).toBe('n2')
    expect(flow.updated).toBe(true)
  })

  it('removeNodes also removes from selectedNodes', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [n1, n2] })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node: n1 })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node: n2 })

    store.getState().fbdFlowActions.removeNodes({ editorName: 'editor-1', nodes: [n1] })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes).toHaveLength(1)
    expect(flow.rung.selectedNodes).toHaveLength(1)
    expect(flow.rung.selectedNodes[0].id).toBe('n2')
  })

  it('removeNodes does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.removeNodes({ editorName: 'nonexistent', nodes: [makeNode()] })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // addSelectedNode
  // -------------------------------------------------------------------------
  it('addSelectedNode adds to selectedNodes and marks node as selected', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })

    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.selectedNodes).toHaveLength(1)
    expect(flow.rung.selectedNodes[0].id).toBe('n1')
    expect(flow.rung.nodes[0].selected).toBe(true)
  })

  it('addSelectedNode only marks the target node as selected, leaves others unchanged', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: false } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [n1, n2] })

    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node: n1 })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes.find((n) => n.id === 'n1')?.selected).toBe(true)
    expect(flow.rung.nodes.find((n) => n.id === 'n2')?.selected).toBeUndefined()
  })

  it('addSelectedNode does not duplicate already selected node', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })

    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node })

    expect(store.getState().fbdFlows[0].rung.selectedNodes).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // removeSelectedNode
  // -------------------------------------------------------------------------
  it('removeSelectedNode removes from selectedNodes and deselects node', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node })

    store.getState().fbdFlowActions.removeSelectedNode({ editorName: 'editor-1', node })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.selectedNodes).toHaveLength(0)
    expect(flow.rung.nodes[0].selected).toBe(false)
  })

  it('removeSelectedNode leaves other nodes unchanged', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [n1, n2] })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node: n1 })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node: n2 })

    store.getState().fbdFlowActions.removeSelectedNode({ editorName: 'editor-1', node: n1 })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes.find((n) => n.id === 'n1')?.selected).toBe(false)
    // n2 was added via addSelectedNode, which set selected=true on its matching node
    expect(flow.rung.nodes.find((n) => n.id === 'n2')?.selected).toBe(true)
    expect(flow.rung.selectedNodes).toHaveLength(1)
    expect(flow.rung.selectedNodes[0].id).toBe('n2')
  })

  it('removeSelectedNode does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.removeSelectedNode({ editorName: 'nonexistent', node: makeNode() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // setSelectedNodes
  // -------------------------------------------------------------------------
  it('setSelectedNodes replaces all selected nodes', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const n1 = makeNode({ id: 'n1', data: { draggable: true } })
    const n2 = makeNode({ id: 'n2', data: { draggable: false } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [n1, n2] })

    store.getState().fbdFlowActions.setSelectedNodes({ editorName: 'editor-1', nodes: [n1] })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.selectedNodes).toHaveLength(1)
    expect(flow.rung.nodes.find((n) => n.id === 'n1')?.selected).toBe(true)
    expect(flow.rung.nodes.find((n) => n.id === 'n2')?.selected).toBe(false)
  })

  // -------------------------------------------------------------------------
  // setEdges
  // -------------------------------------------------------------------------
  it('setEdges replaces all edges', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const edges = [makeEdge({ id: 'e1' }), makeEdge({ id: 'e2' })]

    store.getState().fbdFlowActions.setEdges({ editorName: 'editor-1', edges })

    expect(store.getState().fbdFlows[0].rung.edges).toHaveLength(2)
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // updateEdge
  // -------------------------------------------------------------------------
  it('updateEdge replaces a specific edge', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setEdges({
      editorName: 'editor-1',
      edges: [makeEdge({ id: 'e1', source: 'a' })],
    })

    const updated = makeEdge({ id: 'e1', source: 'b' })
    store.getState().fbdFlowActions.updateEdge({ editorName: 'editor-1', edgeId: 'e1', edge: updated })

    expect(store.getState().fbdFlows[0].rung.edges[0].source).toBe('b')
  })

  it('updateEdge does nothing for nonexistent edge', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setEdges({
      editorName: 'editor-1',
      edges: [makeEdge({ id: 'e1' })],
    })

    store.getState().fbdFlowActions.updateEdge({ editorName: 'editor-1', edgeId: 'missing', edge: makeEdge() })

    expect(store.getState().fbdFlows[0].rung.edges).toHaveLength(1)
    expect(store.getState().fbdFlows[0].rung.edges[0].id).toBe('e1')
  })

  // -------------------------------------------------------------------------
  // addEdge
  // -------------------------------------------------------------------------
  it('addEdge pushes a new edge', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    store.getState().fbdFlowActions.addEdge({ editorName: 'editor-1', edge: makeEdge({ id: 'e1' }) })

    expect(store.getState().fbdFlows[0].rung.edges).toHaveLength(1)
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  // -------------------------------------------------------------------------
  // removeEdges
  // -------------------------------------------------------------------------
  it('removeEdges removes specified edges', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    store.getState().fbdFlowActions.setEdges({
      editorName: 'editor-1',
      edges: [makeEdge({ id: 'e1' }), makeEdge({ id: 'e2' }), makeEdge({ id: 'e3' })],
    })

    store.getState().fbdFlowActions.removeEdges({
      editorName: 'editor-1',
      edges: [makeEdge({ id: 'e1' }), makeEdge({ id: 'e3' })],
    })

    const { edges } = store.getState().fbdFlows[0].rung
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('e2')
  })

  // -------------------------------------------------------------------------
  // setFlowUpdated
  // -------------------------------------------------------------------------
  it('setFlowUpdated sets the updated flag', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    store.getState().fbdFlowActions.setFlowUpdated({ editorName: 'editor-1', updated: false })
    expect(store.getState().fbdFlows[0].updated).toBe(false)

    store.getState().fbdFlowActions.setFlowUpdated({ editorName: 'editor-1', updated: true })
    expect(store.getState().fbdFlows[0].updated).toBe(true)
  })

  it('setFlowUpdated does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.setFlowUpdated({ editorName: 'nonexistent', updated: true })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // applyFBDFlowSnapshot
  // -------------------------------------------------------------------------
  it('applyFBDFlowSnapshot adds a new flow when snapshot is provided and flow does not exist', () => {
    const snapshot = makeFlow({ name: 'other', rung: makeRung({ comment: 'snap', selectedNodes: [makeNode()] }) })

    store.getState().fbdFlowActions.applyFBDFlowSnapshot({ editorName: 'editor-1', snapshot })

    const flow = store.getState().fbdFlows[0]
    expect(flow.name).toBe('editor-1')
    expect(flow.rung.comment).toBe('snap')
    expect(flow.rung.selectedNodes).toEqual([])
    // applyFBDFlowSnapshot does not set updated: true — snapshot restore is managed
    // by the undo/redo handler which controls the saved flag directly.
    expect(flow.updated).toBe(false)
  })

  it('applyFBDFlowSnapshot replaces existing flow when snapshot is provided', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const snapshot = makeFlow({ rung: makeRung({ comment: 'replaced' }) })

    store.getState().fbdFlowActions.applyFBDFlowSnapshot({ editorName: 'editor-1', snapshot })

    expect(store.getState().fbdFlows).toHaveLength(1)
    expect(store.getState().fbdFlows[0].rung.comment).toBe('replaced')
  })

  it('applyFBDFlowSnapshot removes flow when snapshot is null', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })

    store.getState().fbdFlowActions.applyFBDFlowSnapshot({ editorName: 'editor-1', snapshot: null })

    expect(store.getState().fbdFlows).toEqual([])
  })

  it('applyFBDFlowSnapshot with null snapshot does nothing when flow does not exist', () => {
    store.getState().fbdFlowActions.applyFBDFlowSnapshot({ editorName: 'nonexistent', snapshot: null })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Guard clause coverage — nonexistent editor
  // -------------------------------------------------------------------------
  it('onConnect does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.onConnect({
      editorName: 'nonexistent',
      changes: { source: 'a', target: 'b', sourceHandle: 'h1', targetHandle: 'h2' },
    })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('updateNode does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.updateNode({ editorName: 'nonexistent', nodeId: 'n', node: makeNode() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('addNode does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.addNode({ editorName: 'nonexistent', node: makeNode() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('addSelectedNode does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'nonexistent', node: makeNode() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('setSelectedNodes does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.setSelectedNodes({ editorName: 'nonexistent', nodes: [] })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('setEdges does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.setEdges({ editorName: 'nonexistent', edges: [] })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('updateEdge does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.updateEdge({ editorName: 'nonexistent', edgeId: 'e', edge: makeEdge() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('addEdge does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.addEdge({ editorName: 'nonexistent', edge: makeEdge() })
    expect(store.getState().fbdFlows).toEqual([])
  })

  it('removeEdges does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.removeEdges({ editorName: 'nonexistent', edges: [] })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // clearSelections
  // -------------------------------------------------------------------------
  it('clearSelections resets all node selections in a flow', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const node = makeNode({ id: 'n1', data: { draggable: true }, selected: true })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })
    store.getState().fbdFlowActions.setSelectedNodes({ editorName: 'editor-1', nodes: [node] })

    store.getState().fbdFlowActions.clearSelections({ editorName: 'editor-1' })

    const flow = store.getState().fbdFlows[0]
    expect(flow.rung.nodes.every((n) => !n.selected)).toBe(true)
  })

  it('clearSelections does nothing for nonexistent editor', () => {
    store.getState().fbdFlowActions.clearSelections({ editorName: 'nonexistent' })
    expect(store.getState().fbdFlows).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Defensive guard coverage — unreachable under TypeScript but present as runtime safety
  // -------------------------------------------------------------------------
  it('addSelectedNode initializes selectedNodes when undefined', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    // Artificially nullify selectedNodes to exercise the defensive guard
    store.setState(
      produce((state: FBDFlowSlice) => {
        state.fbdFlows[0].rung.selectedNodes = undefined as unknown as Node[]
      }),
    )
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })
    store.getState().fbdFlowActions.addSelectedNode({ editorName: 'editor-1', node })

    expect(store.getState().fbdFlows[0].rung.selectedNodes).toBeDefined()
  })

  it('setSelectedNodes initializes selectedNodes when undefined', () => {
    store.getState().fbdFlowActions.startFBDRung({ editorName: 'editor-1' })
    const node = makeNode({ id: 'n1', data: { draggable: true } })
    store.getState().fbdFlowActions.setNodes({ editorName: 'editor-1', nodes: [node] })
    // Artificially nullify selectedNodes to exercise the defensive guard
    store.setState(
      produce((state: FBDFlowSlice) => {
        state.fbdFlows[0].rung.selectedNodes = undefined as unknown as Node[]
      }),
    )
    store.getState().fbdFlowActions.setSelectedNodes({ editorName: 'editor-1', nodes: [node] })

    expect(store.getState().fbdFlows[0].rung.selectedNodes).toBeDefined()
  })
})
