import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import { z } from 'zod'

/**
 * Types used to save at the json
 */
const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  height: z.number(),
  width: z.number(),
  measured: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  draggable: z.boolean(),
  selectable: z.boolean(),
  data: z.any(),
})
type NodeType = z.infer<typeof nodeSchema>

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string(),
})
type EdgeType = z.infer<typeof edgeSchema>

const zodRungStateSchema = z.object({
  id: z.string(),
  comment: z.string().default(''),
  defaultBounds: z.array(z.number()),
  flowViewport: z.array(z.number()),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})
type ZodRungType = z.infer<typeof zodRungStateSchema>

const zodFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(zodRungStateSchema).default([]),
})
type ZodFlowType = z.infer<typeof zodFlowSchema>

const zodFlowStateSchema = z.object({
  flows: z.array(zodFlowSchema),
})
type ZodFlowState = z.infer<typeof zodFlowStateSchema>

/**
 * Types used at the slice
 */

type RungState = {
  id: string
  comment: string
  defaultBounds: number[]
  flowViewport: number[]
  nodes: Node[]
  edges: Edge[]
}

type FlowType = {
  name: string
  rungs: RungState[]
}

type FlowState = {
  flows: FlowType[]
}

type FlowActions = {
  addFlow: (flow: FlowType) => void

  /**
   * Control the rungs of the flow
   */
  startLadderRung: ({
    editorName,
    rungId,
    defaultBounds,
    flowViewport,
  }: {
    editorName: string
    rungId: string
    defaultBounds: [number, number]
    flowViewport?: [number, number]
  }) => void
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
  updateNode: ({ node, nodeId, rungId, editorName }: { node: Node; nodeId: string, rungId: string; editorName: string }) => void
  addNode: ({ node, rungId, editorName }: { node: Node; rungId: string; editorName: string }) => void

  setEdges: ({ edges, rungId, editorName }: { edges: Edge[]; rungId: string; editorName: string }) => void
  updateEdge: ({ edge, edgeId, rungId, editorName }: { edge: Edge; edgeId: string, rungId: string; editorName: string }) => void
  addEdge: ({ edge, rungId, editorName }: { edge: Edge; rungId: string; editorName: string }) => void

  /**
   * Control the flow viewport of the rung
   */
  updateFlowViewport: ({
    flowViewport,
    rungId,
    editorName,
  }: {
    flowViewport: [number, number]
    rungId: string
    editorName: string
  }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FlowSlice = FlowState & {
  flowActions: FlowActions
}

export { FlowActions, FlowSlice, FlowState, FlowType,RungState }

/**
 * Zod exports
 */
export { edgeSchema, nodeSchema, zodFlowSchema, zodFlowStateSchema, zodRungStateSchema }

export type { EdgeType, NodeType, ZodFlowState, ZodFlowType, ZodRungType }
