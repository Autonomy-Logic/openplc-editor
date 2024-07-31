import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FlowSlice, RungsState } from './types'

export const createFlowSlice: StateCreator<FlowSlice, [], [], FlowSlice> = (setState) => ({
  rungs: [],

  flowActions: {
    addRung: (rung) => {
      setState(
        produce((state: RungsState) => {
          state.rungs.push(rung)
        }),
      )
    },
    removeRung: (rungId) => {
      setState(
        produce((state: RungsState) => {
          state.rungs = state.rungs.filter((rung) => rung.id !== rungId)
        }),
      )
    },

    onNodesChange: ({ changes, rungId }) => {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.nodes = applyNodeChanges(changes, rung.nodes)
        }),
      )
    },
    onEdgesChange: ({ changes, rungId }) => {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.edges = applyEdgeChanges(changes, rung.edges)
        }),
      )
    },
    onConnect: ({ changes, rungId }) => {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.edges = addEdge(changes, rung.edges)
        }),
      )
    },

    setNodes: ({ nodes, rungId }) => {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.nodes = nodes
        }),
      )
    },
    updateNode({ node, rungId }) {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          const nodeIndex = rung.nodes.findIndex((n) => n.id === node.id)
          if (nodeIndex === -1) return
          rung.nodes[nodeIndex] = node
        }),
      )
    },

    setEdges({ edges, rungId }) {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.edges = edges
        }),
      )
    },
    updateEdge({ edge, rungId }) {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          const edgeIndex = rung.edges.findIndex((e) => e.id === edge.id)
          if (edgeIndex === -1) return
          rung.edges[edgeIndex] = edge
        }),
      )
    },
  },
})
