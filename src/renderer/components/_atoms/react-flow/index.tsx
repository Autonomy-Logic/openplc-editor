import '@xyflow/react/dist/style.css'

import type { BackgroundProps, ControlProps, Edge, Node, ReactFlowProps } from '@xyflow/react'
import { addEdge, Background, Connection, Controls, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import { PropsWithChildren, useCallback } from 'react'

type FlowPanelProps = PropsWithChildren & {
  background?: boolean
  backgroundConfig?: BackgroundProps
  viewportConfig?: Omit<ReactFlowProps, 'nodes' | 'edges' | 'onNodesChange' | 'onEdgesChange' | 'onConnect'>
  controls?: boolean
  controlsConfig?: ControlProps
  constrolsStyle?: string
}

export const FlowPanel = ({
  children,
  background,
  backgroundConfig,
  viewportConfig,
  controls = false,
  controlsConfig,
  constrolsStyle,
}: FlowPanelProps) => {
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const [nodes, _setNodes, onNodesChange] = useNodesState([] as Node[])

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  return (
    <ReactFlow
      edges={edges}
      onEdgesChange={onEdgesChange}
      nodes={nodes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      {...viewportConfig}
    >
      {background && <Background {...backgroundConfig} />}
      {controls && <Controls {...controlsConfig} className={constrolsStyle} />}
      {children}
    </ReactFlow>
  )
}
