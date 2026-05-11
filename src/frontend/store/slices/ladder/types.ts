import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { z } from 'zod'

import { zodLadderFlowSchema, zodRungLadderStateSchema } from '../../../../middleware/shared/ports/flow-schemas'
import type { HandleBranch, RungLadderState as PortRungLadderState } from '../../../../middleware/shared/ports/types'
import type { RungNode } from '../../../components/_atoms/graphical-editor/ladder/utils/types'

type ZodLadderRungType = z.infer<typeof zodRungLadderStateSchema>
type ZodLadderFlowType = z.infer<typeof zodLadderFlowSchema>

const zodLadderFlowStateSchema = z.object({
  ladderFlows: z.array(zodLadderFlowSchema),
})
type ZodLadderFlowState = z.infer<typeof zodLadderFlowStateSchema>

const zodLadderNodeTypesSchema = z.enum(['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable'])
type ZodLadderNodeType = z.infer<typeof zodLadderNodeTypesSchema>

/**
 * Editor-narrowed view of `RungLadderState`. The cross-platform port type
 * keeps `nodes` / `selectedNodes` as the generic `Node[]` from `@xyflow/react`
 * (the compiler adapter doesn't care about the discriminated union); the
 * frontend tightens both to the `RungNode` discriminated union so call sites
 * narrow on `node.type` instead of casting.
 */
export type RungLadderState = Omit<PortRungLadderState, 'nodes' | 'selectedNodes'> & {
  nodes: RungNode[]
  selectedNodes: RungNode[]
}

/**
 * Types used at the slice
 */

type LadderFlowType = {
  name: string
  updated: boolean
  rungs: RungLadderState[]
}

type LadderFlowState = {
  ladderFlows: LadderFlowType[]
}

type LadderFlowActions = {
  clearLadderFlows: () => void
  addLadderFlow: (flow: LadderFlowType) => void
  removeLadderFlow: (flowId: string) => void

  /**
   * Control the rungs of the flow
   */
  startLadderRung: ({
    editorName,
    rungId,
    defaultBounds,
    reactFlowViewport,
  }: {
    editorName: string
    rungId: string
    defaultBounds: [number, number]
    reactFlowViewport?: [number, number]
  }) => void
  setRungs: ({ rungs, editorName }: { rungs: RungLadderState[]; editorName: string }) => void
  removeRung: (editorName: string, rungId: string) => void
  addComment: ({ editorName, rungId, comment }: { editorName: string; rungId: string; comment: string }) => void
  duplicateRung: ({ editorName, rungId }: { editorName: string; rungId: string }) => void

  /**
   * Control the rungs transactions
   */
  onNodesChange: ({
    changes,
    rungId,
    editorName,
  }: {
    changes: NodeChange<Node>[]
    rungId: string
    editorName: string
  }) => void
  onEdgesChange: ({
    changes,
    rungId,
    editorName,
  }: {
    changes: EdgeChange<Edge>[]
    rungId: string
    editorName: string
  }) => void
  onConnect: ({ changes, rungId, editorName }: { changes: Connection; rungId: string; editorName: string }) => void

  setNodes: ({ nodes, rungId, editorName }: { nodes: Node[]; rungId: string; editorName: string }) => void
  updateNode: ({
    node,
    nodeId,
    rungId,
    editorName,
  }: {
    node: Node
    nodeId: string
    rungId: string
    editorName: string
  }) => void
  addNode: ({ node, rungId, editorName }: { node: Node; rungId: string; editorName: string }) => void
  removeNodes: ({ nodes, rungId, editorName }: { nodes: Node[]; rungId: string; editorName: string }) => void
  setSelectedNodes: ({ nodes, rungId, editorName }: { nodes: Node[]; rungId: string; editorName: string }) => void

  setEdges: ({ edges, rungId, editorName }: { edges: Edge[]; rungId: string; editorName: string }) => void
  updateEdge: ({
    edge,
    edgeId,
    rungId,
    editorName,
  }: {
    edge: Edge
    edgeId: string
    rungId: string
    editorName: string
  }) => void
  addEdge: ({ edge, rungId, editorName }: { edge: Edge; rungId: string; editorName: string }) => void

  /**
   * Replace the per-rung handle-branch index. The structural data (the
   * branch nodes / edges themselves) lives in `nodes` / `edges`; this action
   * only updates the denormalized lookup.
   */
  setHandleBranches: ({
    handleBranches,
    rungId,
    editorName,
  }: {
    handleBranches: HandleBranch[]
    rungId: string
    editorName: string
  }) => void

  /**
   * Atomic update of every per-rung field that an editor mutation touches —
   * nodes, edges, and (optionally) handleBranches. Use this instead of a
   * sequence of `setNodes` + `setEdges` + `setHandleBranches` calls when the
   * three need to land as one store transition. The intermediate states from
   * sequential setters can have ReactFlow render edges that reference
   * not-yet-committed nodes, producing handle-not-found warnings.
   */
  updateRungData: ({
    nodes,
    edges,
    handleBranches,
    rungId,
    editorName,
  }: {
    nodes: Node[]
    edges: Edge[]
    handleBranches?: HandleBranch[]
    rungId: string
    editorName: string
  }) => void

  /**
   * Control the flow viewport of the rung
   */
  updateReactFlowViewport: ({
    reactFlowViewport,
    rungId,
    editorName,
  }: {
    reactFlowViewport: [number, number]
    rungId: string
    editorName: string
  }) => void

  setFlowUpdated: ({ editorName, updated }: { editorName: string; updated: boolean }) => void
  clearSelections: ({ editorName }: { editorName: string }) => void

  applyLadderFlowSnapshot: ({ editorName, snapshot }: { editorName: string; snapshot: LadderFlowType | null }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type LadderFlowSlice = LadderFlowState & {
  ladderFlowActions: LadderFlowActions
}

export type { LadderFlowActions, LadderFlowSlice, LadderFlowState, LadderFlowType }

/**
 * Zod exports
 */
export { zodLadderFlowSchema, zodLadderFlowStateSchema, zodLadderNodeTypesSchema, zodRungLadderStateSchema }

export type { ZodLadderFlowState, ZodLadderFlowType, ZodLadderNodeType, ZodLadderRungType }
