import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'

type AppNode = Node

type FlowState = {
  id: string
  nodes: AppNode[]
  edges: Edge[]
}

type RungsState = {
  rungs: FlowState[]
}

type FlowActions = {
  onNodesChange: ({ changes, rungId }: { changes: NodeChange<Node>[]; rungId: string }) => void
  onEdgesChange: ({ changes, rungId }: { changes: EdgeChange<Edge>[]; rungId: string }) => void
  onConnect: ({ changes, rungId }: { changes: Connection; rungId: string }) => void
  setNodes: ({ nodes, rungId }: { nodes: AppNode[]; rungId: string }) => void
  setEdges: ({ edges, rungId }: { edges: Edge[]; rungId: string }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FlowSlice = RungsState & {
  flowActions: FlowActions
}

export { FlowActions, FlowSlice, FlowState, RungsState }
