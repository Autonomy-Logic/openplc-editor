import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { z } from 'zod'

import { edgeSchema, nodeSchema } from '../react-flow'

/**
 * Types used to save at the json
 */
const zodRungLadderStateSchema = z.object({
  id: z.string(),
  comment: z.string().default(''),
  defaultBounds: z.array(z.number()),
  reactFlowViewport: z.array(z.number()),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})
type ZodLadderRungType = z.infer<typeof zodRungLadderStateSchema>

const zodLadderFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(zodRungLadderStateSchema).default([]),
})
type ZodLadderFlowType = z.infer<typeof zodLadderFlowSchema>

const zodLadderFlowStateSchema = z.object({
  ladderFlows: z.array(zodLadderFlowSchema),
})
type ZodLadderFlowState = z.infer<typeof zodLadderFlowStateSchema>

const zodLadderNodeTypesSchema = z.enum(['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable'])
type ZodLadderNodeType = z.infer<typeof zodLadderNodeTypesSchema>

/**
 * Types used at the slice
 */

type RungLadderState = {
  id: string
  comment: string
  defaultBounds: number[]
  reactFlowViewport: number[]
  selectedNodes: Node[]
  nodes: Node[]
  edges: Edge[]
}

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

  applyLadderFlowSnapshot: ({ editorName, snapshot }: { editorName: string; snapshot: LadderFlowType | null }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type LadderFlowSlice = LadderFlowState & {
  ladderFlowActions: LadderFlowActions
}

export { LadderFlowActions, LadderFlowSlice, LadderFlowState, LadderFlowType, RungLadderState }

/**
 * Zod exports
 */
export { zodLadderFlowSchema, zodLadderFlowStateSchema, zodLadderNodeTypesSchema, zodRungLadderStateSchema }

export type { ZodLadderFlowState, ZodLadderFlowType, ZodLadderNodeType, ZodLadderRungType }
