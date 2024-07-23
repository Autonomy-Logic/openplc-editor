import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FlowSlice, RungsState } from './types'

export const createFlowSlice: StateCreator<FlowSlice, [], [], FlowSlice> = (setState) => ({
  rungs: [],

  flowActions: {
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

    setEdges({ edges, rungId }) {
      setState(
        produce((state: RungsState) => {
          const rung = state.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          rung.edges = edges
        }),
      )
    },
  },
})
