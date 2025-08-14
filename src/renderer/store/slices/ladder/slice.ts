import { defaultCustomNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/graphical-editor/ladder'
import type { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils/types'
import { removeElements } from '@root/renderer/components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { LadderFlowSlice, LadderFlowState } from './types'
import { duplicateLadderRung } from './utils'

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
    startLadderRung: ({ editorName, rungId, defaultBounds, reactFlowViewport }) => {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          if (!ladderFlows.find((flow) => flow.name === editorName)) {
            ladderFlows.push({
              name: editorName,
              updated: true,
              rungs: [],
            })
          }

          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const { powerRail } = defaultCustomNodesStyles
          const railNodes = [
            nodesBuilder.powerRail({
              id: 'left-rail',
              posX: 0,
              posY: defaultBounds[1] / 2 - powerRail.height / 2,
              connector: 'right',
              handleX: powerRail.width,
              handleY: defaultBounds[1] / 2,
            }),
            nodesBuilder.powerRail({
              id: 'right-rail',
              posX: defaultBounds[0],
              posY: defaultBounds[1] / 2 - powerRail.height / 2,
              connector: 'left',
              handleX: defaultBounds[0] - powerRail.width,
              handleY: defaultBounds[1] / 2,
            }),
          ]
          flow.rungs.push({
            id: rungId,
            comment: '',
            defaultBounds,
            reactFlowViewport:
              reactFlowViewport && reactFlowViewport > defaultBounds ? reactFlowViewport : defaultBounds,
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
            selectedNodes: [],
          })
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
    duplicateRung({ editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return
          const rungIndex = flow.rungs.findIndex((rung) => rung.id === rungId)

          const newRung = duplicateLadderRung(flow.name, rung)

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

          const { nodes: newNodes, edges: newEdges } = removeElements(rung, nodes)
          rung.nodes = newNodes
          rung.edges = newEdges
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
                  draggable: (node.data as BasicNodeData).draggable,
                }
              }
              return {
                ...node,
                selected: false,
                draggable: (node.data as BasicNodeData).draggable,
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
  },
})
