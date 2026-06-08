import { addEdge, Node } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FBDFlowSlice, FBDFlowState } from './types'

export const createFBDFlowSlice: StateCreator<FBDFlowSlice, [], [], FBDFlowSlice> = (setState) => ({
  fbdFlows: [],

  fbdFlowActions: {
    clearFBDFlows: () => {
      setState({ fbdFlows: [] })
    },
    addFBDFlow: (flow) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flowIndex = fbdFlows.findIndex((f) => f.name === flow.name)
          const rung = {
            ...flow.rung,
            selectedNodes: [],
          }
          // Reset updated to false on load — the flow is being loaded from a saved project.
          const newFlow = { ...flow, rung, updated: false }

          if (flowIndex === -1) {
            fbdFlows.push(newFlow)
          } else {
            fbdFlows[flowIndex] = newFlow
          }
        }),
      )
    },
    removeFBDFlow: (flowId) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flowIndex = fbdFlows.findIndex((f) => f.name === flowId)
          if (flowIndex === -1) return

          fbdFlows.splice(flowIndex, 1)
        }),
      )
    },
    renameFBDFlow: (oldName, newName) => {
      if (oldName === newName) return
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((f) => f.name === oldName)
          if (!flow) return
          // Defensive: drop a stale empty placeholder under `newName`
          // if one snuck in via the editor's cold-seed path before
          // this rename ran.  Mirrors the ladder-flow rename logic.
          const existingIndex = fbdFlows.findIndex((f) => f.name === newName)
          if (existingIndex !== -1) fbdFlows.splice(existingIndex, 1)
          flow.name = newName
        }),
      )
    },

    /**
     * Control the rungs of the flow
     */
    startFBDRung: ({ editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          let flow = fbdFlows.find((f) => f.name === editorName)
          if (!flow) {
            flow = {
              name: editorName,
              updated: true,
              rung: {
                comment: '',
                selectedNodes: [],
                nodes: [],
                edges: [],
              },
            }
            fbdFlows.push(flow)
          }

          flow.rung = {
            comment: '',
            nodes: [],
            edges: [],
            selectedNodes: [],
          }
        }),
      )
    },
    setRung: ({ editorName, rung }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung = rung
          flow.updated = true
        }),
      )
    },
    addComment({ editorName, comment }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.comment = comment
          flow.updated = true
        }),
      )
    },

    /**
     * Control the rungs transactions
     */
    onConnect: ({ changes, editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges = addEdge(changes, flow.rung.edges)
          flow.updated = true
        }),
      )
    },

    setNodes: ({ editorName, nodes }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.nodes = nodes
          flow.updated = true
        }),
      )
    },
    updateNode({ editorName, node, nodeId }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const nodeIndex = flow.rung.nodes.findIndex((n) => n.id === nodeId)
          if (nodeIndex === -1) return

          flow.rung.nodes[nodeIndex] = node
          flow.updated = true
        }),
      )
    },
    addNode({ editorName, node }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.nodes.push(node)

          const selectedNodes: Node[] = []
          flow.rung.nodes = flow.rung.nodes.map((n) => {
            if (n.id === node.id) {
              selectedNodes.push(n)
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

          flow.rung.selectedNodes = selectedNodes
          flow.updated = true
        }),
      )
    },
    removeNodes({ editorName, nodes }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.nodes = flow.rung.nodes.filter((node) => !nodes.find((n) => n.id === node.id))
          flow.rung.selectedNodes = flow.rung.selectedNodes.filter(
            (selectedNode) => !nodes.find((n) => n.id === selectedNode.id),
          )
          flow.updated = true
        }),
      )
    },

    addSelectedNode({ editorName, node }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const selectedNodes = flow.rung.selectedNodes
          if (!selectedNodes) flow.rung.selectedNodes = []
          if (!flow.rung.selectedNodes.find((n) => n.id === node.id)) {
            flow.rung.selectedNodes.push(node)
            flow.updated = true
          }

          flow.rung.nodes = flow.rung.nodes.map((n) => {
            if (n.id === node.id) {
              return {
                ...n,
                selected: true,
                draggable: (node.data as { draggable?: boolean }).draggable,
              }
            }
            return n
          })
        }),
      )
    },
    removeSelectedNode({ editorName, node }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const selectedNodes = flow.rung.selectedNodes.filter((n) => n.id !== node.id)
          flow.rung.selectedNodes = selectedNodes

          flow.rung.nodes = flow.rung.nodes.map((n) => {
            if (n.id === node.id) {
              return {
                ...n,
                selected: false,
              }
            }
            return n
          })
        }),
      )
    },
    setSelectedNodes({ nodes, editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const selectedNodes = nodes
          if (!flow.rung.selectedNodes) flow.rung.selectedNodes = []
          flow.rung.selectedNodes = selectedNodes

          flow.rung.nodes = flow.rung.nodes.map((node) => {
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
        }),
      )
    },

    setEdges({ edges, editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges = edges
          flow.updated = true
        }),
      )
    },
    updateEdge({ edge, edgeId, editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const edgeIndex = flow.rung.edges.findIndex((e) => e.id === edgeId)
          if (edgeIndex === -1) return

          flow.rung.edges[edgeIndex] = edge
          flow.updated = true
        }),
      )
    },
    addEdge({ edge, editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges.push(edge)
          flow.updated = true
        }),
      )
    },
    removeEdges({ editorName, edges }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges = flow.rung.edges.filter((edge) => !edges.find((e) => e.id === edge.id))
          flow.updated = true
        }),
      )
    },

    setFlowUpdated({ editorName, updated }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.updated = updated
        }),
      )
    },

    /** Clear all node selections without triggering flow.updated (used after save). */
    clearSelections({ editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.nodes = flow.rung.nodes.map((node) => ({ ...node, selected: false }))
        }),
      )
    },

    /**
     * Control the undo and redo actions
     */

    applyFBDFlowSnapshot: ({ editorName, snapshot }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const index = fbdFlows.findIndex((fbdFlow) => fbdFlow.name === editorName)

          if (snapshot) {
            const newFlow = {
              ...snapshot,
              name: editorName,
              rung: {
                ...snapshot.rung,
                selectedNodes: [],
              },
              // Don't set updated: true — snapshot restore is managed by the undo/redo
              // handler which controls the saved flag directly.
              updated: false,
            }

            if (index === -1) {
              fbdFlows.push(newFlow)
            } else {
              fbdFlows[index] = newFlow
            }
          } else {
            if (index !== -1) fbdFlows.splice(index, 1)
          }
        }),
      )
    },
  },
})
