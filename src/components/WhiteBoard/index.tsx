import 'reactflow/dist/style.css'

import { CONSTANTS } from '@shared/constants'
import { useCallback } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  ConnectionMode,
  Controls,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import { gray } from 'tailwindcss/colors'

import { useTheme } from '@/hooks'

import { DefaultEdge } from './edges'
import { Comment, PowerRail } from './nodes'

const {
  theme: { variants },
} = CONSTANTS

const NODE_TYPES = {
  comment: Comment,
  powerRail: PowerRail,
}

const EDGE_TYPES = {
  default: DefaultEdge,
}

const WhiteBoard = () => {
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [nodes, , onNodesChange] = useNodesState([])
  const { theme } = useTheme()

  const onConnect = useCallback(
    (connection: Connection) => setEdges((edges) => addEdge(connection, edges)),
    [setEdges],
  )

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        connectionMode={ConnectionMode.Loose}
        fitView
        defaultEdgeOptions={{
          type: 'default',
        }}
      >
        <Background
          gap={12}
          size={2}
          color={theme === variants.DARK ? gray[600] : gray[300]}
        />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default WhiteBoard
