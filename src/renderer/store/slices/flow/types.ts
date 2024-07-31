import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'

type FlowState = {
  id: string
  nodes: Node[]
  edges: Edge[]
}

type RungsState = {
  rungs: FlowState[]
}

type FlowActions = {
  addRung: (rung: FlowState) => void
  removeRung: (rungId: string) => void

  onNodesChange: ({ changes, rungId }: { changes: NodeChange<Node>[]; rungId: string }) => void
  onEdgesChange: ({ changes, rungId }: { changes: EdgeChange<Edge>[]; rungId: string }) => void
  onConnect: ({ changes, rungId }: { changes: Connection; rungId: string }) => void

  setNodes: ({ nodes, rungId }: { nodes: Node[]; rungId: string }) => void
  updateNode: ({ node, rungId }: { node: Node; rungId: string }) => void

  setEdges: ({ edges, rungId }: { edges: Edge[]; rungId: string }) => void
  updateEdge: ({ edge, rungId }: { edge: Edge; rungId: string }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FlowSlice = RungsState & {
  flowActions: FlowActions
}

export { FlowActions, FlowSlice, FlowState, RungsState }
