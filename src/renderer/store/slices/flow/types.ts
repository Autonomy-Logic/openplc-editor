import { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'

type RungState = {
  id: string
  defaultBounds: [number, number]
  flowViewport?: [number, number]
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
  addRung: (editorName: string, rung: RungState) => void
  removeRung: (editorName: string, rungId: string) => void

  onNodesChange: ({ changes, rungId, editorName }: { changes: NodeChange<Node>[]; rungId: string, editorName: string }) => void
  onEdgesChange: ({ changes, rungId, editorName }: { changes: EdgeChange<Edge>[]; rungId: string, editorName: string }) => void
  onConnect: ({ changes, rungId, editorName }: { changes: Connection; rungId: string, editorName: string }) => void

  setNodes: ({ nodes, rungId, editorName }: { nodes: Node[]; rungId: string, editorName: string }) => void
  updateNode: ({ node, rungId, editorName }: { node: Node; rungId: string, editorName: string }) => void

  setEdges: ({ edges, rungId, editorName }: { edges: Edge[]; rungId: string, editorName: string }) => void
  updateEdge: ({ edge, rungId, editorName }: { edge: Edge; rungId: string, editorName: string }) => void

  updateFlowViewport: ({ flowViewport, rungId, editorName }: { flowViewport: [number, number]; rungId: string, editorName: string }) => void
}

/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type FlowSlice = FlowState & {
  flowActions: FlowActions
}

export { FlowActions, FlowSlice, FlowState, RungState }
