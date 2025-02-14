import { defaultCustomNodesStyles, nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import type { BlockNode, BlockVariant } from '@root/renderer/components/_atoms/react-flow/custom-nodes/block'
import type { CoilNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/coil'
import type { ContactNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/contact'
import type { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import type { PowerRailNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/power-rail'
import type { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { VariableNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/variable'
import { removeElements } from '@root/renderer/components/_molecules/rung/ladder-utils/elements'
import { generateNumericUUID } from '@root/utils'
import type { Edge, Node } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { FlowSlice, FlowState } from './types'

export const createFlowSlice: StateCreator<FlowSlice, [], [], FlowSlice> = (setState) => ({
  flows: [],

  flowActions: {
    clearFlows: () => {
      setState({ flows: [] })
    },
    addFlow: (flow) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flowIndex = flows.findIndex((f) => f.name === flow.name)
          const rungs = flow.rungs.map((rung) => ({
            ...rung,
            selectedNodes: [],
          }))
          const newFlow = { ...flow, rungs }

          if (flowIndex === -1) {
            flows.push(newFlow)
          } else {
            flows[flowIndex] = newFlow
          }
        }),
      )
    },
    removeFlow: (flowId) => {
      setState(
        produce(({ flows }: FlowState) => {
          const flowIndex = flows.findIndex((f) => f.name === flowId)
          if (flowIndex === -1) return

          flows.splice(flowIndex, 1)
        }),
      )
    },

    /**
     * Control the rungs of the flow
     */
    startLadderRung: ({ editorName, rungId, defaultBounds, flowViewport }) => {
      setState(
        produce(({ flows }: FlowState) => {
          if (!flows.find((flow) => flow.name === editorName)) {
            flows.push({
              name: editorName,
              updated: true,
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
            flowViewport: flowViewport && flowViewport > defaultBounds ? flowViewport : defaultBounds,
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.rungs = flow.rungs.filter((rung) => rung.id !== rungId)
          flow.updated = true
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
          flow.updated = true
        }),
      )
    },
    duplicateRung({ editorName, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const rungIndex = flow.rungs.findIndex((rung) => rung.id === rungId)

          const nodeMaps: { [key: string]: Node } = rung.nodes.reduce(
            (acc, node) => {
              acc[node.id] = {
                ...node,
                id: node.type === 'powerRail' ? node.id : `${node.type?.toUpperCase()}_${crypto.randomUUID()}`,
              }
              return acc
            },
            {} as { [key: string]: Node },
          )
          const edgeMaps: { [key: string]: Edge } = rung.edges.reduce(
            (acc, edge) => {
              acc[edge.id] = {
                id: `e_${nodeMaps[edge.source].id}_${nodeMaps[edge.target].id}__${edge.sourceHandle}_${edge.targetHandle}`,
                source: nodeMaps[edge.source].id,
                target: nodeMaps[edge.target].id,
              }
              return acc
            },
            {} as { [key: string]: Edge },
          )

          const newNodes = rung.nodes.map((node) => {
            switch (node.type) {
              case 'block': {
                const newBlock = nodesBuilder.block({
                  id: nodeMaps[node.id].id,
                  posX: node.position.x,
                  posY: node.position.y,
                  handleX: (node as BlockNode<BlockVariant>).data.inputConnector?.glbPosition.x ?? 0,
                  handleY: (node as BlockNode<BlockVariant>).data.inputConnector?.glbPosition.y ?? 0,
                  variant: (node as BlockNode<BlockVariant>).data.variant,
                  executionControl: (node as BlockNode<BlockVariant>).data.executionControl,
                })
                return {
                  ...newBlock,
                  data: {
                    ...newBlock.data,
                    variable:
                      (node as BlockNode<BlockVariant>).data.variant.type === 'function-block'
                        ? { name: '' }
                        : node.data.variable,
                  },
                } as BlockNode<BlockVariant>
              }
              case 'coil': {
                const newCoil = nodesBuilder.coil({
                  id: nodeMaps[node.id].id,
                  posX: node.position.x,
                  posY: node.position.y,
                  handleX: (node as CoilNode).data.inputConnector?.glbPosition.x ?? 0,
                  handleY: (node as CoilNode).data.inputConnector?.glbPosition.y ?? 0,
                  variant: 'default',
                })
                return {
                  ...newCoil,
                  data: {
                    ...newCoil.data,
                    numericId: generateNumericUUID(),
                    variable: (node as CoilNode).data.variable,
                  },
                } as CoilNode
              }
              case 'contact': {
                const newContact = nodesBuilder.contact({
                  id: nodeMaps[node.id].id,
                  posX: node.position.x,
                  posY: node.position.y,
                  handleX: (node as ContactNode).data.inputConnector?.glbPosition.x ?? 0,
                  handleY: (node as ContactNode).data.inputConnector?.glbPosition.y ?? 0,
                  variant: 'default',
                })
                return {
                  ...newContact,
                  data: {
                    ...newContact.data,
                    numericId: generateNumericUUID(),
                    variable: (node as ContactNode).data.variable,
                  },
                } as ContactNode
              }
              case 'parallel': {
                return {
                  ...node,
                  id: nodeMaps[node.id].id,
                  data: {
                    ...node.data,
                    numericId: generateNumericUUID(),
                  },
                } as ParallelNode
              }
              case 'powerRail': {
                return {
                  ...node,
                  id: nodeMaps[node.id].id,
                  data: {
                    ...node.data,
                    numericId: generateNumericUUID(),
                  },
                } as PowerRailNode
              }
              case 'variable': {
                return {
                  ...node,
                  id: nodeMaps[node.id].id,
                  data: {
                    ...node.data,
                    numericId: generateNumericUUID(),
                    block: {
                      ...(node as VariableNode).data.block,
                      id: nodeMaps[(node as VariableNode).data.block.id].id,
                    },
                  },
                } as VariableNode
              }
              default: {
                return node
              }
            }
          })

          const newEdges = rung.edges.map((edge) => ({
            ...edge,
            id: edgeMaps[edge.id].id,
            source: edgeMaps[edge.id].source,
            target: edgeMaps[edge.id].target,
          }))

          const newRung = {
            id: `rung_${editorName}_${crypto.randomUUID()}`,
            comment: rung.comment,
            defaultBounds: rung.defaultBounds,
            flowViewport: rung.flowViewport,
            selectedNodes: [],
            nodes: newNodes,
            edges: newEdges,
          }

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
          flow.updated = true
        }),
      )
    },
    updateNode({ editorName, node, nodeId, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.nodes.push(node)
          flow.updated = true
        }),
      )
    },
    removeNodes({ editorName, nodes, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
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
    updateFlowViewport({ editorName, flowViewport, rungId }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.flowViewport = flowViewport
          flow.updated = true
        }),
      )
    },

    setFlowUpdated({ editorName, updated }) {
      setState(
        produce(({ flows }: FlowState) => {
          const flow = flows.find((flow) => flow.name === editorName)
          if (!flow) return

          flow.updated = updated
        }),
      )
    },
  },
})
