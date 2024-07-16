import '@xyflow/react/dist/style.css'

import {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type {
  BackgroundProps,
  ConnectionLineType,
  ControlProps,
  CoordinateExtent,
  ReactFlowProps,
} from '@xyflow/react'
import { useCallback, useEffect } from 'react'

type FlowPanelProps = {
  /**
   * Initial value for edges and nodes
   * @WIP - must be refactored to use workspace slice
   */
  edgesInitialValue: Edge[]
  nodesInitialValue: Node[]
  setNodesInitialValue: (nodes: Node[]) => void
  setEdgesInitialValue: (edges: Edge[]) => void

  backgroundConfig?: BackgroundProps
  viewportConfig?: Omit<ReactFlowProps, 'nodes' | 'edges' | 'onNodesChange' | 'onEdgesChange' | 'onConnect'>
  controls?: boolean
  controlsConfig?: ControlProps
  constrolsStyle?: string
}

export const FlowPanel = ({
  edgesInitialValue,
  nodesInitialValue,
  setEdgesInitialValue,
  setNodesInitialValue,
  backgroundConfig,
  viewportConfig,
  controls = false,
  controlsConfig,
  constrolsStyle,
}: FlowPanelProps) => {
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesInitialValue)
  const [nodes, setNodes, onNodesChange] = useNodesState(nodesInitialValue)

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  useEffect(() => {
    setEdges(edgesInitialValue)
    setNodes(nodesInitialValue)
    return () => {
      setEdgesInitialValue(edges)
      setNodesInitialValue(nodes)
    }
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
