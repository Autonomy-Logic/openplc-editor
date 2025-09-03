import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'
import { addEdge } from '@xyflow/react'
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
          const newFlow = { ...flow, rung }

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

    /**
     * Control the rungs of the flow
     */
    startFBDRung: ({ editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          if (!fbdFlows.find((flow) => flow.name === editorName)) {
            fbdFlows.push({
              name: editorName,
              updated: true,
              rung: {
                comment: '',
                selectedNodes: [],
                nodes: [],
                edges: [],
              },
            })
          }

          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

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
                draggable: (node.data as BasicNodeData).draggable,
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
                draggable: (node.data as BasicNodeData).draggable,
              }
            }
            return {
              ...node,
              selected: false,
              draggable: (node.data as BasicNodeData).draggable,
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
              updated: true,
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
