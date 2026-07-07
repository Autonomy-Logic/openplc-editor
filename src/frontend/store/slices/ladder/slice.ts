import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../components/_atoms/graphical-editor/ladder/node-builders'
import type { LadderBlockConnectedVariables } from '../../../components/_atoms/graphical-editor/ladder/utils/types'
import { removeElements } from '../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { deriveHandleBranches } from '../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/handle-branch'
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

          // Check if any block node has legacy connectedVariables (object instead of array).
          // Only scan + migrate if legacy data is detected — modern projects skip this entirely.
          const needsMigration = flow.rungs.some((rung) =>
            rung.nodes.some((node) => {
              if (node.type !== 'block') return false
              const cv = (node.data as { connectedVariables?: unknown }).connectedVariables
              return cv != null && !Array.isArray(cv)
            }),
          )

          const rungs = needsMigration
            ? flow.rungs.map((rung) => ({
                ...rung,
                selectedNodes: [],
                nodes: rung.nodes.map((node) => {
                  if (node.type !== 'block') return node
                  const data = node.data as { connectedVariables?: unknown }
                  if (data.connectedVariables && !Array.isArray(data.connectedVariables)) {
                    const converted: LadderBlockConnectedVariables = Object.entries(
                      data.connectedVariables as Record<string, { variable?: PLCVariable; type?: string }>,
                    ).map(([key, cv]) => ({
                      handleId: key,
                      variable: cv.variable,
                      type: (cv.type as 'input' | 'output') ?? 'input',
                    }))
                    return { ...node, data: { ...node.data, connectedVariables: converted } }
                  }
                  return node
                }),
              }))
            : flow.rungs.map((rung) => ({ ...rung, selectedNodes: [] }))

          // handleBranches (the index of contacts/coils wired to a block's
          // secondary handles, e.g. CTUD CD/QD) is runtime-only state — it is
          // NOT persisted in the .ld. Without rebuilding it on load, a project
          // containing handle branches comes back with an empty index and the
          // first branch-aware edit (e.g. deleting a coil on a block output)
          // corrupts the diagram. Reconstruct it from the graph here.
          const rungsWithBranches = rungs.map((rung) => ({
            ...rung,
            handleBranches: deriveHandleBranches(rung),
          }))

          // Reset updated to false on load — the flow is being loaded from a saved project.
          // Only mark as updated if legacy data was migrated so the next save writes the new format.
          const newFlow = { ...flow, rungs: rungsWithBranches, updated: needsMigration }

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
    renameLadderFlow: (oldName, newName) => {
      if (oldName === newName) return
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((f) => f.name === oldName)
          if (!flow) return
          // Defensive: if a flow already exists under `newName` (e.g.
          // because the editor cold-seeded an empty one before this
          // rename ran), drop the empty placeholder so the original
          // rungs survive.  The shared rename path validates name
          // uniqueness on the POU side, so by the time we get here
          // `newName` is guaranteed unique on the project — any
          // pre-existing flow under that name is stale.
          const existingIndex = ladderFlows.findIndex((f) => f.name === newName)
          if (existingIndex !== -1) ladderFlows.splice(existingIndex, 1)
          flow.name = newName
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
          /* istanbul ignore next -- unreachable: flow was just pushed above */
          if (!flow) return

          const { powerRail } = defaultCustomNodesStyles
          const railNodes = [
            nodesBuilder.powerRail({
              id: `left-rail-${rungId}`,
              posX: 0,
              posY: defaultBounds[1] / 2 - powerRail.height / 2,
              connector: 'right',
              handleX: powerRail.width,
              handleY: defaultBounds[1] / 2,
            }),
            nodesBuilder.powerRail({
              id: `right-rail-${rungId}`,
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
    duplicateRung({ editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rungIndex = flow.rungs.findIndex((rung) => rung.id === rungId)
          if (rungIndex === -1) return

          const rung = flow.rungs[rungIndex]
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
    updateNode({ editorName, node, nodeId, rungId, transient }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          const nodeIndex = rung.nodes.findIndex((n) => n.id === nodeId)
          if (nodeIndex === -1) return

          rung.nodes[nodeIndex] = node
          if (!transient) flow.updated = true
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

          const { nodes: newNodes, edges: newEdges, handleBranches } = removeElements(rung, nodes)
          rung.nodes = newNodes
          rung.edges = newEdges
          if (handleBranches) rung.handleBranches = handleBranches
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

    setHandleBranches({ handleBranches, editorName, rungId }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          const rung = flow.rungs.find((rung) => rung.id === rungId)
          if (!rung) return

          rung.handleBranches = handleBranches
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

    /** Clear all node selections without triggering flow.updated (used after save). */
    clearSelections({ editorName }) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          const flow = ladderFlows.find((flow) => flow.name === editorName)
          if (!flow) return

          for (const rung of flow.rungs) {
            rung.selectedNodes = []
            rung.nodes = rung.nodes.map((node) => ({ ...node, selected: false }))
          }
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
            // Don't set updated: true — snapshot restore is managed by the undo/redo
            // handler which controls the saved flag directly.
            const newFlow = { ...snapshot, name: editorName, rungs, updated: false }

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
