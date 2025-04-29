import { Connection, Edge, Node } from '@xyflow/react'
import { z } from 'zod'

import { edgeSchema, nodeSchema } from '../react-flow'

const zodFBDRungStateSchema = z.object({
  comment: z.string().default(''),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})
type ZodFBDRungType = z.infer<typeof zodFBDRungStateSchema>

const zodFBDFlowSchema = z.object({
  name: z.string(),
  rung: zodFBDRungStateSchema,
})
type ZodFBDFlowType = z.infer<typeof zodFBDFlowSchema>

const zodFBDFlowStateSchema = z.object({
  fbdFlows: z.array(zodFBDFlowSchema),
})
type ZodFBDFlowState = z.infer<typeof zodFBDFlowStateSchema>

const zodFBDNodeTypesSchema = z.enum([
  'block',
  'comment',
  'connector',
  'connection',
  'input-variable',
  'output-variable',
  'inout-variable',
])
type ZodFBDNodeType = z.infer<typeof zodFBDNodeTypesSchema>

/**
 * Types used at the slice
 */

type FBDRungState = {
  comment: string
  selectedNodes: Node[]
  nodes: Node[]
  edges: Edge[]
}

type FBDFlowType = {
  name: string
  updated: boolean
  rung: FBDRungState
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
  startFBDRung: ({ editorName }: { editorName: string }) => void
  setRung: ({ rung, editorName }: { rung: FBDRungState; editorName: string }) => void
  addComment: ({ editorName, comment }: { editorName: string; comment: string }) => void

  /**
   * Control the rungs transactions
   */
  onConnect: ({ changes, editorName }: { changes: Connection; editorName: string }) => void

  setNodes: ({ nodes, editorName }: { nodes: Node[]; editorName: string }) => void
  updateNode: ({ node, nodeId, editorName }: { node: Node; nodeId: string; editorName: string }) => void

  addNode: ({ node, editorName }: { node: Node; editorName: string }) => void
  removeNodes: ({ nodes, editorName }: { nodes: Node[]; editorName: string }) => void

  addSelectedNode: ({ node, editorName }: { node: Node; editorName: string }) => void
  removeSelectedNode: ({ node, editorName }: { node: Node; editorName: string }) => void
  setSelectedNodes: ({ nodes, editorName }: { nodes: Node[]; editorName: string }) => void

  setEdges: ({ edges, editorName }: { edges: Edge[]; editorName: string }) => void
  updateEdge: ({ edge, edgeId, editorName }: { edge: Edge; edgeId: string; editorName: string }) => void
  addEdge: ({ edge, editorName }: { edge: Edge; editorName: string }) => void
  removeEdges: ({ edges, editorName }: { edges: Edge[]; editorName: string }) => void

  setFlowUpdated: ({ editorName, updated }: { editorName: string; updated: boolean }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FBDFlowSlice = FBDFlowState & {
  fbdFlowActions: FBDFlowActions
}

export { FBDFlowActions, FBDFlowSlice, FBDFlowState, FBDFlowType, FBDRungState }

/**
 * Zod exports
 */
export { zodFBDFlowSchema, zodFBDFlowStateSchema, zodFBDNodeTypesSchema, zodFBDRungStateSchema }

export type { ZodFBDFlowState, ZodFBDFlowType, ZodFBDNodeType, ZodFBDRungType }
