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
  reactFlowViewport: z.array(z.number()),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})
type ZodRungType = z.infer<typeof zodRungStateSchema>

const zodLadderFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(zodRungStateSchema).default([]),
})
type ZodLadderFlowType = z.infer<typeof zodLadderFlowSchema>

const zodFlowStateSchema = z.object({
  ladderFlows: z.array(zodLadderFlowSchema),
})
type ZodFlowState = z.infer<typeof zodFlowStateSchema>

const zodNodeTypesSchema = z.enum(['block', 'contact', 'coil', 'parallel', 'powerRail', 'variable'])
type ZodNodeType = z.infer<typeof zodNodeTypesSchema>

/**
 * Types used at the slice
 */

type RungState = {
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
  rungs: RungState[]
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
  setRungs: ({ rungs, editorName }: { rungs: RungState[]; editorName: string }) => void
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
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type LadderFlowSlice = LadderFlowState & {
  ladderFlowActions: LadderFlowActions
}

export { LadderFlowActions, LadderFlowSlice, LadderFlowState, LadderFlowType, RungState }

/**
 * Zod exports
 */
export { edgeSchema, nodeSchema, zodFlowStateSchema, zodLadderFlowSchema, zodNodeTypesSchema,zodRungStateSchema }

export type { EdgeType, NodeType, ZodFlowState, ZodLadderFlowType, ZodNodeType,ZodRungType }
