import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { LadderFlowSlice, LadderFlowState } from './types'

export const createLadderFlowSlice: StateCreator<LadderFlowSlice, [], [], LadderFlowSlice> = (setState) => ({
  ladderFlows: [],

  ladderFlowActions: {
    clearLadderFlows: () => {
      setState({ ladderFlows: [] })
    },
    addLadderFlow: (flow) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flowIndex = ladderFlows.findIndex((f) => f.name === flow.name)
          const rungs = flow.rungs.map((rung) => ({
            ...rung,
            selectedNodes: [],
          }))
          const newFlow = { ...flow, rungs }

          if (flowIndex === -1) {
            ladderFlows.push(newFlow)
          } else {
            ladderFlows[flowIndex] = newFlow
          }
        }),
      )
    },
    removeLadderFlow: (flowId) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flowIndex = ladderFlows.findIndex((f) => f.name === flowId)
          if (flowIndex === -1) return

          ladderFlows.splice(flowIndex, 1)
        }),
      )
    },

    /**
     * Control the rungs of the flow
     */
    startLadderRung: ({ editorName, rung }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          let flow = ladderFlows.find((f) => f.name === editorName)
          if (!flow) {
            flow = {
              name: editorName,
              updated: true,
              rungs: [],
            }
            ladderFlows.push(flow)
          }

          flow.rungs.push(rung)
        }),
      )
    },
    setRungs: ({ editorName, rungs }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          if (!Array.isArray(rungs)) return

          // Validate each rung has required structure
          if (
            !rungs.every(
              (rung) =>
                rung.id &&
                Array.isArray(rung.nodes) &&
                Array.isArray(rung.edges) &&
                rung.nodes.some((node) => node.id.startsWith('left-rail')) &&
                rung.nodes.some((node) => node.id.startsWith('right-rail')),
            )
          )
            return

          flow.rungs = rungs
          flow.updated = true
        }),
      )
    },
    removeRung: (editorName, rungId) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rungs = flow.rungs.filter((rung) => rung.id !== rungId)
          flow.updated = true
        }),
      )
    },
    addComment({ editorName, rungId, comment }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.comment = comment
          flow.updated = true
        }),
      )
    },
    duplicateRung({ editorName, rungId, newRung }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rungIndex = flow.rungs.findIndex((rung) => rung.id === rungId)
          if (rungIndex === -1) return

          flow.rungs.splice(rungIndex + 1, 0, newRung)
          flow.updated = true
        }),
      )
    },

    /**
     * Control the rungs transactions
     */
    onNodesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes = applyNodeChanges(changes, rung.nodes)
        }),
      )
    },
    onEdgesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = applyEdgeChanges(changes, rung.edges)
        }),
      )
    },
    onConnect: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = addEdge(changes, rung.edges)
        }),
      )
    },

    setNodes: ({ editorName, nodes, rungId }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes = nodes
          flow.updated = true
        }),
      )
    },
    updateNode({ editorName, node, nodeId, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const nodeIndex = rung.nodes.findIndex((n) => n.id === nodeId)
          if (nodeIndex === -1) return

          rung.nodes[nodeIndex] = node
          flow.updated = true
        }),
      )
    },
    addNode({ editorName, node, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes.push(node)
          rung.nodes = rung.nodes.map((n) => {
            if (n.id === node.id) {
              return {
                ...n,
                selected: true,
              }
            }
            return {
              ...n,
              selected: false,
            }
          })

          flow.updated = true
        }),
      )
    },
    removeNodes({ editorName, nodes, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const removedIds = new Set(nodes.map((n) => n.id))
          rung.nodes = rung.nodes.filter((node) => !removedIds.has(node.id))
          rung.edges = rung.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target))
          rung.selectedNodes = rung.selectedNodes.filter((node) => !removedIds.has(node.id))
          flow.updated = true
        }),
      )
    },
    setSelectedNodes({ nodes, rungId, editorName }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const selectedNodes = nodes
          if (!rung.selectedNodes) rung.selectedNodes = []
          rung.selectedNodes = selectedNodes

          if (selectedNodes.length > 1) {
            rung.nodes = rung.nodes.map((node) => {
              if (selectedNodes.find((n) => n.id === node.id)) {
                return {
                  ...node,
                  selected: true,
                  draggable: false,
                }
              }
              return {
                ...node,
                selected: false,
                draggable: false,
              }
            })
          } else {
            rung.nodes = rung.nodes.map((node) => {
              if (selectedNodes.find((n) => n.id === node.id)) {
                return {
                  ...node,
                  selected: true,
                  draggable: (node.data as { draggable?: boolean }).draggable,
                }
              }
              return {
                ...node,
                selected: false,
                draggable: (node.data as { draggable?: boolean }).draggable,
              }
            })
          }

          if (selectedNodes.length > 0) {
            flow.rungs = flow.rungs.map((r) => {
              const changedRung = r.id === rungId

              if (changedRung) {
                return { ...rung }
              } else {
                return {
                  ...r,
                  selectedNodes: [],
                  nodes: r.nodes.map((node) => ({
                    ...node,
                    selected: false,
                    draggable: false,
                  })),
                }
              }
            })
          }
        }),
      )
    },

    setEdges({ edges, editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = edges
          flow.updated = true
        }),
      )
    },
    updateEdge({ edge, edgeId, editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const edgeIndex = rung.edges.findIndex((e) => e.id === edgeId)
          if (edgeIndex === -1) return

          rung.edges[edgeIndex] = edge
          flow.updated = true
        }),
      )
    },
    addEdge({ edge, editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges.push(edge)
          flow.updated = true
        }),
      )
    },

    /**
     * Control the flow viewport of the rung
     */
    updateReactFlowViewport({ editorName, reactFlowViewport, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.reactFlowViewport = reactFlowViewport
        }),
      )
    },

    setFlowUpdated({ editorName, updated }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.updated = updated
        }),
      )
    },

    /**
     * Control the undo and redo actions
     */
    applyLadderFlowSnapshot: ({ editorName, snapshot }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          if (snapshot) {
            const flowIndex = ladderFlows.findIndex((ladderFlow) => ladderFlow.name === editorName)
            const rungs = snapshot.rungs.map((rung) => ({ ...rung, selectedNodes: [] }))
            const newFlow = { ...snapshot, name: editorName, rungs }

            if (flowIndex === -1) {
              ladderFlows.push(newFlow)
            } else {
              ladderFlows[flowIndex] = newFlow
            }
          } else {
            const flowIndex = ladderFlows.findIndex((ladderFlow) => ladderFlow.name === editorName)
            if (flowIndex !== -1) ladderFlows.splice(flowIndex, 1)
          }
        }),
      )
    },
  },
})
