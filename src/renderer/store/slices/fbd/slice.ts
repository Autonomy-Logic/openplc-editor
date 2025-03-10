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
          const rungs = flow.rungs.map((rung) => ({
            ...rung,
            selectedNodes: [],
          }))
          const newFlow = { ...flow, rungs }

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
    startFBDRung: ({ editorName, rungId, defaultBounds, reactFlowViewport }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          if (!fbdFlows.find((flow) => flow.name === editorName)) {
            fbdFlows.push({
              name: editorName,
              updated: true,
              rungs: [],
            })
          }

          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rungs.push({
            id: rungId,
            comment: '',
            defaultBounds,
            reactFlowViewport:
              reactFlowViewport && reactFlowViewport > defaultBounds ? reactFlowViewport : defaultBounds,
            nodes: [],
            edges: [],
            selectedNodes: [],
          })
        }),
      )
    },
    setRungs: ({ editorName, rungs }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          if (!Array.isArray(rungs)) return

          // Validate each rung has required structure
          if (
            !rungs.every(
              (rung) =>
                rung.id &&
                Array.isArray(rung.nodes) &&
                Array.isArray(rung.edges) &&
                rung.nodes.some((node) => node.id === 'left-rail') &&
                rung.nodes.some((node) => node.id === 'right-rail'),
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rungs = flow.rungs.filter((rung) => rung.id !== rungId)
          flow.updated = true
        }),
      )
    },
    addComment({ editorName, rungId, comment }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.comment = comment
          flow.updated = true
        }),
      )
    },

    /**
     * Control the rungs transactions
     */
    onNodesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes = applyNodeChanges(changes, rung.nodes)
        }),
      )
    },
    onEdgesChange: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = applyEdgeChanges(changes, rung.edges)
        }),
      )
    },
    onConnect: ({ changes, editorName, rungId }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.edges = addEdge(changes, rung.edges)
        }),
      )
    },

    setNodes: ({ editorName, nodes, rungId }) => {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes.push(node)
          flow.updated = true
        }),
      )
    },
    removeNodes({ editorName, nodes: _nodes, rungId }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          // const { nodes: newNodes, edges: newEdges } = removeElements(rung, nodes)
          // rung.nodes = newNodes
          // rung.edges = newEdges
          flow.updated = true
        }),
      )
    },
    setSelectedNodes({ nodes, rungId, editorName }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
            return
          }

          rung.nodes = rung.nodes.map((node) => {
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

    setEdges({ edges, editorName, rungId }) {
      setState(
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
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
        produce(({ fbdFlows }: FBDFlowState) => {
          const flow = fbdFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.reactFlowViewport = reactFlowViewport
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
