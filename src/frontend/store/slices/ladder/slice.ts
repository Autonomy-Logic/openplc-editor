/**
 * Whether a rung's coordinates are unusable and have to be rebuilt.
 *
 * Ladder is a rigid matrix — every element sits on the rung's power line at a step the layout
 * computes — so a rung is either laid out or it is broken; there is no "arranged differently
 * but fine". That makes the damage detectable rather than guessed at. Three signals, none of
 * them things this editor writes:
 *
 *   - a `position` that IS there but holds non-finite numbers, which cannot be drawn;
 *   - an element at the ORIGIN. The rails live at x=0 and the layout never puts an element
 *     there, so one element at `{0,0}` is already conclusive — a rung holding a single coil
 *     would otherwise go undetected and draw on top of the left rail; and
 *   - two elements sharing one point, which is what a writer that computes no geometry emits
 *     for a rung of several elements, and what a partial parse leaves behind.
 *
 * A node with NO `position` at all is deliberately not a signal. That is not a damaged
 * diagram, it is one assembled programmatically — a fixture, a test, a caller building a rung
 * by hand — and re-laying those out would rewrite nodes their author is still holding.
 *
 * Anything else is left exactly as the file has it. A diagram someone arranged by hand is not
 * this editor's to rearrange on open.
 */
// Exported for its own tests: the predicate decides whether a project's geometry is thrown
// away and rebuilt, and every branch of it is a judgement about data this editor did not write.
export const needsPositionRecovery = (rung: RungLadderState): boolean => {
  // Rails are placed by the rung itself, not by the element layout, so they never make a rung
  // look broken and never rescue one that is.
  const elements = rung.nodes.filter((node) => node.type !== 'powerRail')
  if (elements.length === 0) return false

  const seen = new Set<string>()
  for (const node of elements) {
    if (!node.position) continue
    const { x, y } = node.position
    if (!Number.isFinite(x) || !Number.isFinite(y)) return true
    if (x === 0 && y === 0) return true
    // `+ 0` normalises negative zero: `-0` and `0` are the same point but stringify
    // differently, so without it two elements on top of each other slip through whenever one
    // axis arrives as `-0` — which `JSON.parse` preserves.
    const point = `${x + 0},${y + 0}`
    if (seen.has(point)) return true
    seen.add(point)
  }
  return false
}

import type { Node } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PLCVariable, RungLadderState } from '../../../../middleware/shared/ports/types'
import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '../../../components/_atoms/graphical-editor/ladder/node-builders'
import type {
  BlockVariant,
  LadderBlockConnectedVariables,
} from '../../../components/_atoms/graphical-editor/ladder/utils/types'
import { getBlockSize } from '../../../components/_atoms/graphical-editor/ladder/utils/utils'
import { removeElements } from '../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements'
import { updateDiagramElementsPosition } from '../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram'
import { deriveHandleBranches } from '../../../components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/handle-branch'
import { LadderFlowSlice, LadderFlowState } from './types'
import { duplicateLadderRung } from './utils'

/**
 * Whether a value carries everything `getBlockSize` reads off a variant.
 *
 * A block node is not required to carry a complete variant — a placeholder dropped on the
 * canvas, or a fixture, may have neither name nor pins. Sizing is an improvement on such a
 * node, never a precondition for loading it, so anything incomplete is left exactly as it is.
 * The entries are checked and not just the array, because `getBlockSize` reads every one's
 * `name` and `class`.
 *
 * A guard rather than an assertion: this runs against project-file data, which is whatever
 * the file said, and `as` would only silence the compiler about that.
 */
const isSizableVariant = (value: unknown): value is BlockVariant => {
  if (typeof value !== 'object' || value === null) return false
  const { name, variables } = value as { name?: unknown; variables?: unknown }
  return (
    typeof name === 'string' &&
    Array.isArray(variables) &&
    variables.every(
      (entry): boolean =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { name?: unknown }).name === 'string' &&
        typeof (entry as { class?: unknown }).class === 'string',
    )
  )
}

/** Give a block node the size the editor computes for its variant; leave anything else be. */
const sizeBlockNode = (node: Node): Node => {
  if (node.type !== 'block') return node
  const variant: unknown = node.data?.variant
  if (!isSizableVariant(variant)) return node
  const { width, height } = getBlockSize(variant, { x: 0, y: 0 })
  return {
    ...node,
    width,
    height,
    measured: { width, height },
  }
}

/**
 * The rung's bounds, or the default when the file's are unusable.
 *
 * A short or malformed `defaultBounds` would otherwise reach the layout as `undefined` or a
 * negative extent, which is not a shape it is written against.
 */
const rungBounds = (rung: RungLadderState): [number, number] => {
  // `?? []` would only cover null/undefined; an object in the file makes the destructuring
  // throw, which costs the rung its recovery.
  const [width, height] = Array.isArray(rung.defaultBounds) ? rung.defaultBounds : []
  return [
    Number.isFinite(width) && width > 0 ? width : DEFAULT_RUNG_BOUNDS[0],
    Number.isFinite(height) && height > 0 ? height : DEFAULT_RUNG_BOUNDS[1],
  ]
}

/**
 * Whether every element the rung came in with is still there.
 *
 * Variable boxes are exempt, and not as a convenience: they are DERIVED from a block's
 * `connectedVariables`, and `updateVariableBlockPosition` rebuilds them with fresh ids rather
 * than moving them — a rung that arrives with one can legitimately come back with two, or with
 * none. Counting nodes therefore says nothing, while every contact, coil, block and parallel
 * marker must survive as itself: same id AND same type, so a contact that came back as some
 * other kind of node counts as lost rather than as moved.
 */
export const elementsSurvived = (before: Node[], after: Node[]): boolean => {
  const present = new Set(after.map((node) => `${node.type}\u0000${node.id}`))
  return before.every((node) => node.type === 'variable' || present.has(`${node.type}\u0000${node.id}`))
}

/** Whether the layout actually moved anything, comparing node for node by id. */
const positionsChanged = (before: Node[], after: Node[]): boolean => {
  const priorById = new Map(before.map((node) => [node.id, node.position]))
  return after.some((node) => {
    const prior = priorById.get(node.id)
    if (!prior) return true
    return prior.x !== node.position.x || prior.y !== node.position.y
  })
}

/** Bounds a rung falls back to when the file does not carry usable ones. */
const DEFAULT_RUNG_BOUNDS: [number, number] = [300, 100]

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

          // A VAR_IN_OUT pin no longer has an output side, but loading NEVER converts a rung
          // that still carries the old two-sided pin. In Ladder an edge leaving a block IS the
          // rung chain, so re-pointing it automatically would route the rail around the block
          // or drop it outright, with no signal and no way back. The block's update badge does
          // it on demand instead: see `hasLegacyInOutOutputHandle` for the detection.

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

          // Rebuild the geometry of any rung whose coordinates cannot be used, and ONLY
          // those.
          //
          // Where a ladder element sits is derived from the graph — element order, which pins
          // carry branches, how tall a block must be to fit them — by
          // `updateDiagramElementsPosition` and the passes it runs. Those rules live here and
          // change as the editor grows, so anything writing a .ld from outside (the CODESYS
          // converter, a PLCopen import) can emit the graph and leave geometry alone: this
          // recovers it.
          //
          // Running it on every load instead would re-lay-out projects that are already
          // correct, moving elements on open for no reason the user asked for. So it is a
          // recovery path, gated on `needsPositionRecovery`, not a load step.
          let recovered = false
          const laidOutRungs = rungsWithBranches.map((rung) => {
            if (!needsPositionRecovery(rung)) return rung
            try {
              // Sizing is INSIDE the try. A block whose variant is incomplete would otherwise
              // throw here and take the project load with it — and this path exists precisely
              // to cope with a rung whose contents cannot be trusted.
              //
              // `updateDiagramElementsPosition` spaces a block's pin rows and grows it to fit
              // its branches, but block WIDTH comes from the variant and is otherwise only
              // computed when one is created or edited, so a rung recovered without this lays
              // out around blocks of zero width.
              const sized = { ...rung, nodes: rung.nodes.map(sizeBlockNode) }
              const { nodes, edges } = updateDiagramElementsPosition(sized, rungBounds(sized))

              // Recovery may MOVE an element; it may never lose one. The layout can return a
              // set that has dropped elements for a rung it did not understand — on a skeletal
              // or unwired rung it comes back empty — and accepting that deletes part of the
              // user's diagram on open, silently.
              if (!elementsSurvived(sized.nodes, nodes)) return rung

              // The layout hands the ORIGINAL geometry straight back when it cannot walk the
              // rung (`diagram/index.ts`, the `previousLinkedNodes` early return) — no throw,
              // nothing rebuilt. Treating that as a recovery marks the flow dirty on its
              // behalf: the user is prompted to save a project they never edited, the save
              // writes the same unusable coordinates back, and the next open recovers again.
              if (!positionsChanged(rung.nodes, nodes)) return rung

              recovered = true
              return { ...sized, nodes, edges }
            } catch {
              // Best-effort by definition: a rung the layout cannot walk keeps the geometry it
              // arrived with, and `recovered` is left alone — one rung failing must not erase
              // another rung's success, which is what marks the flow dirty so the rebuilt
              // coordinates reach disk.
              return rung
            }
          })

          // A recovered rung marks the flow dirty for the same reason a migrated one does: the
          // file still holds the unusable coordinates until the next save writes the rebuilt
          // ones, and recovering again on every open is work nobody needs.
          const newFlow = {
            ...flow,
            rungs: laidOutRungs,
            updated: needsMigration || recovered,
          }

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
    updateNodes(updates) {
      setState(
        produce(({ ladderFlows }: LadderFlowState) => {
          for (const { editorName, node, nodeId, rungId } of updates) {
            const flow = ladderFlows.find((flow) => flow.name === editorName)
            if (!flow) continue

            const rung = flow.rungs.find((rung) => rung.id === rungId)
            if (!rung) continue

            const nodeIndex = rung.nodes.findIndex((n) => n.id === nodeId)
            if (nodeIndex === -1) continue

            rung.nodes[nodeIndex] = node
            flow.updated = true
          }
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

          // Conditional in-place writes: immer only copies nodes whose values
          // actually change, so unchanged siblings keep their identity.
          for (const n of rung.nodes) {
            if (n.selected !== false) n.selected = false
          }
          rung.nodes.push({ ...node, selected: true })

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
          rung.selectedNodes = selectedNodes

          // Conditional in-place writes: immer only copies nodes whose values
          // actually change, so unchanged siblings (and untouched rungs below)
          // keep their identity instead of the previous all-rungs rebuild.
          const multiSelect = selectedNodes.length > 1
          for (const node of rung.nodes) {
            const isSelected = selectedNodes.some((n) => n.id === node.id)
            const draggable = multiSelect ? false : (node.data as { draggable?: boolean }).draggable
            if (node.selected !== isSelected) node.selected = isSelected
            if (node.draggable !== draggable) node.draggable = draggable
          }

          if (selectedNodes.length > 0) {
            for (const r of flow.rungs) {
              if (r.id === rungId) continue
              if (!r.selectedNodes || r.selectedNodes.length > 0) r.selectedNodes = []
              for (const node of r.nodes) {
                if (node.selected !== false) node.selected = false
                if (node.draggable !== false) node.draggable = false
              }
            }
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

          // Skip value-equal writes so RungBody's bounds effect doesn't churn
          // the rung's identity every time it recomputes the same extent.
          if (
            rung.reactFlowViewport?.[0] === reactFlowViewport[0] &&
            rung.reactFlowViewport?.[1] === reactFlowViewport[1]
          )
            return

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
