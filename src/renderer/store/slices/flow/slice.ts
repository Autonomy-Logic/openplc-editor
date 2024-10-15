import { defaultCustomNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FlowSlice, FlowState } from './types'

export const createFlowSlice: StateCreator<FlowSlice, [], [], FlowSlice> = (setState) => ({
  flows: [],

  flowActions: {
    addFlow: (flow) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flowIndex = flows.findIndex((f) => f.name === flow.name)
          if (flowIndex === -1) {
            flows.push(flow)
          } else {
            flows[flowIndex] = flow
          }
        }),
      )
    },

    /**
     * Controll the rungs of the flow
     */
    startLadderRung: ({ editorName, rungId, defaultBounds, flowViewport }) => {
      setState(
        produce(({ flows }: FlowState) => {
          if (!flows.find((flow) => flow.name === editorName)) {
            flows.push({
              name: editorName,
              rungs: [],
            })
          }

          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const { powerRail } = defaultCustomNodesStyles
          const railNodes = [
            nodesBuilder.powerRail({
              id: 'left-rail',
              posX: 0,
              posY: 0,
              connector: 'right',
              handleX: powerRail.width,
              handleY: powerRail.height / 2,
            }),
            nodesBuilder.powerRail({
              id: 'right-rail',
              posX: 1530 - powerRail.width,
              posY: 0,
              connector: 'left',
              handleX: defaultBounds[0] - powerRail.width,
              handleY: powerRail.height / 2,
            }),
          ]
          flow.rungs.push({
            id: rungId,
            comment: '',
            defaultBounds,
            flowViewport: flowViewport ?? defaultBounds,
            nodes: [...railNodes],
            edges: [
              {
                id: `e_${railNodes[0].id}_${railNodes[1].id}`,
                source: railNodes[0].id,
                target: railNodes[1].id,
                sourceHandle: railNodes[0].data.handles[0].id,
                targetHandle: railNodes[1].data.handles[0].id,
                type: 'smoothstep',
              },
            ],
          })
        }),
      )
    },
    removeRung: (editorName, rungId) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rungs = flow.rungs.filter((rung) => rung.id !== rungId)
        }),
      )
    },
    addComment({ editorName, rungId, comment }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.comment = comment
        }),
      )
    },

    /**
     * Controll the rungs transactions
     */
    onNodesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes = applyNodeChanges(changes, rung.nodes)
        }),
      )
    },
    onEdgesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = applyEdgeChanges(changes, rung.edges)
        }),
      )
    },
    onConnect: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = addEdge(changes, rung.edges)
        }),
      )
    },

    setNodes: ({ editorName, nodes, rungId }) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes = nodes
        }),
      )
    },
    updateNode({ editorName, node, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const nodeIndex = rung.nodes.findIndex((n) => n.id === node.id)
          if (nodeIndex === -1) return

          rung.nodes[nodeIndex] = node
        }),
      )
    },

    setEdges({ edges, editorName, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = edges
        }),
      )
    },
    updateEdge({ edge, editorName, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const edgeIndex = rung.edges.findIndex((e) => e.id === edge.id)
          if (edgeIndex === -1) return

          rung.edges[edgeIndex] = edge
        }),
      )
    },

    /**
     * Controll the flow viewport of the rung
     */
    updateFlowViewport({ editorName, flowViewport, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.flowViewport = flowViewport
        }),
      )
    },
  },
})
