import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { z } from 'zod'

import { zodLadderFlowSchema, zodRungLadderStateSchema } from '../../../../middleware/shared/ports/flow-schemas'

type ZodLadderRungType = z.infer<typeof zodRungLadderStateSchema>
type ZodLadderFlowType = z.infer<typeof zodLadderFlowSchema>

const zodLadderFlowStateSchema = z.object({
  ladderFlows: z.array(zodLadderFlowSchema),
})
type ZodLadderFlowState = z.infer<typeof zodLadderFlowStateSchema>

const zodLadderNodeTypesSchema = z.enum(['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable'])
type ZodLadderNodeType = z.infer<typeof zodLadderNodeTypesSchema>

import type { HandleBranch, RungLadderState } from '../../../../middleware/shared/ports/types'

export type { HandleBranch, RungLadderState }

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
   * Rekey the ladder-flow entry from `oldName` → `newName`.
   *
   * Called when a POU is renamed.  The ladder editor looks up its
   * rungs by `flow.name === editorName`, so without this rekey a
   * renamed LD POU's editor would show an empty canvas — and worse,
   * any subsequent rung edits would seed a fresh flow entry under
   * the new name, leaving the original rungs orphaned in the
   * `ladderFlows` array (they'd persist in memory but never reach
   * the editor surface, and on save the empty new flow would
   * overwrite the on-disk rungs).
   */
  renameLadderFlow: (oldName: string, newName: string) => void

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
    transient,
  }: {
    node: Node
    nodeId: string
    rungId: string
    editorName: string
    /** UI-only update (e.g. drag-lock while a variable input is focused) —
     *  writes the node without marking the flow as edited, so merely
     *  focusing/blurring an element never dirties the POU. */
    transient?: boolean
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
