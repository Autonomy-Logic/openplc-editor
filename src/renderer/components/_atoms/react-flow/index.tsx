import '@xyflow/react/dist/style.css'

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundProps,
  Connection,
  ControlProps,
  Controls,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowProps,
  ReactFlowProvider,
} from '@xyflow/react'
import { Dispatch, SetStateAction, useCallback, useEffect } from 'react'

type FlowPanelProps = {
  edges: Edge[]
  setEdges: Dispatch<SetStateAction<Edge[]>>
  nodes: Node[]
  setNodes: Dispatch<SetStateAction<Node[]>>
  backgroundConfig?: BackgroundProps
  viewportConfig?: Omit<ReactFlowProps, 'nodes' | 'edges' | 'onNodesChange' | 'onEdgesChange' | 'onConnect'>
  controls?: boolean
  controlsConfig?: ControlProps
  constrolsStyle?: string
}

export const FlowPanel = ({
  edges,
  setEdges,
  nodes,
  setNodes,
  backgroundConfig,
  viewportConfig,
  controls = false,
  controlsConfig,
  constrolsStyle,
}: FlowPanelProps) => {
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => setEdges((prevEdges) => applyEdgeChanges(changes, prevEdges)),
    [setEdges],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes],
  )

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  useEffect(() => {
    setNodes([
      {
        id: '1',
        data: { label: 'Hello' },
        position: { x: 0, y: 0 },
        type: 'input',
      },
      {
        id: '2',
        data: { label: 'World' },
        position: { x: 100, y: 100 },
      },
    ])
  }, [])

  return (
    <ReactFlowProvider>
      <ReactFlow
        edges={edges}
        onEdgesChange={onEdgesChange}
        nodes={nodes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        {...viewportConfig}
      >
        <Background {...backgroundConfig} />
        {controls && <Controls {...controlsConfig} className={constrolsStyle} />}
      </ReactFlow>
    </ReactFlowProvider>
  )
}
