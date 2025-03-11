import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
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
    onNodesChange: ({ changes, editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.nodes = applyNodeChanges(changes, flow.rung.nodes)
        }),
      )
    },
    onEdgesChange: ({ changes, editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges = applyEdgeChanges(changes, flow.rung.edges)
        }),
      )
    },
    onConnect: ({ changes, editorName }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rung.edges = addEdge(changes, flow.rung.edges)
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
          flow.updated = true
        }),
      )
    },
    removeNodes({ editorName, nodes: _nodes }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rung
          if (!rung) return

          // const { nodes: newNodes, edges: newEdges } = removeElements(rung, nodes)
          // rung.nodes = newNodes
          // rung.edges = newEdges
          flow.updated = true
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

          if (selectedNodes.length > 1) {
            flow.rung.nodes = flow.rung.nodes.map((node) => {
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
            return
          }

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

    setFlowUpdated({ editorName, updated }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.updated = updated
        }),
      )
    },
  },
})
