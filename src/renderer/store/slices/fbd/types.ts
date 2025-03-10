import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { z } from 'zod'

import { edgeSchema, nodeSchema } from '../react-flow'

const zodFBDRungStateSchema = z.object({
  id: z.string(),
  comment: z.string().default(''),
  defaultBounds: z.array(z.number()),
  reactFlowViewport: z.array(z.number()),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})
type ZodFBDRungType = z.infer<typeof zodFBDRungStateSchema>

const zodFBDFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(zodFBDRungStateSchema).default([]),
})
type ZodFBDFlowType = z.infer<typeof zodFBDFlowSchema>

const zodFBDFlowStateSchema = z.object({
  fbdFlows: z.array(zodFBDFlowSchema),
})
type ZodFBDFlowState = z.infer<typeof zodFBDFlowStateSchema>

const zodFBDNodeTypesSchema = z.enum(['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable'])
type ZodFBDNodeType = z.infer<typeof zodFBDNodeTypesSchema>

/**
 * Types used at the slice
 */

type RungFBDState = {
  id: string
  comment: string
  defaultBounds: number[]
  reactFlowViewport: number[]
  selectedNodes: Node[]
  nodes: Node[]
  edges: Edge[]
}

type FBDFlowType = {
  name: string
  updated: boolean
  rungs: RungFBDState[]
}

type FBDFlowState = {
  fbdFlows: FBDFlowType[]
}

type FBDFlowActions = {
  clearFBDFlows: () => void
  addFBDFlow: (flow: FBDFlowType) => void
  removeFBDFlow: (flowId: string) => void

  /**
   * Control the rungs of the flow
   */
  startFBDRung: ({
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
  setRungs: ({ rungs, editorName }: { rungs: RungFBDState[]; editorName: string }) => void
  removeRung: (editorName: string, rungId: string) => void
  addComment: ({ editorName, rungId, comment }: { editorName: string; rungId: string; comment: string }) => void

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
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FBDFlowSlice = FBDFlowState & {
  fbdFlowActions: FBDFlowActions
}

export { FBDFlowActions, FBDFlowSlice, FBDFlowState, FBDFlowType, RungFBDState }

/**
 * Zod exports
 */
export { zodFBDFlowSchema, zodFBDFlowStateSchema,zodFBDNodeTypesSchema, zodFBDRungStateSchema }

export type { ZodFBDFlowState,ZodFBDFlowType, ZodFBDNodeType, ZodFBDRungType }
