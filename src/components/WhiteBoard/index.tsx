import 'reactflow/dist/style.css'

import { CONSTANTS } from '@shared/constants'
import { DragEvent, useCallback, useEffect, useRef, useState } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  ConnectionMode,
  Controls,
  Edge,
  MiniMap,
  Node,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
  useStore,
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

const INITIAL_NODES: Node[] = [
  {
    id: crypto.randomUUID(),
    type: 'powerRail',
    position: {
      x: 200,
      y: 200,
    },
    data: {
      pins: [
        {
          id: crypto.randomUUID(),
          position: 'right',
        },
      ],
    },
  },
  {
    id: crypto.randomUUID(),
    type: 'powerRail',
    position: {
      x: 800,
      y: 200,
    },
    data: {
      pins: [
        {
          id: crypto.randomUUID(),
          position: 'left',
        },
      ],
    },
  },
]

const INITIAL_EDGES: Edge[] = [
  {
    id: crypto.randomUUID(),
    type: 'default',
    source: INITIAL_NODES[0].id,
    target: INITIAL_NODES[1].id,
    sourceHandle: INITIAL_NODES[0].data.pins[0].id,
    targetHandle: INITIAL_NODES[1].data.pins[0].id,
  },
]

const WhiteBoard = () => {
  const width = useStore(({ width }) => width)
  const height = useStore(({ height }) => height)

  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES)
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null)

  const { theme } = useTheme()

  useEffect(() => {
    reactFlowInstance?.fitView()
  }, [height, reactFlowInstance, width])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((edges) => addEdge(connection, edges)),
    [setEdges],
  )

  const onEdgesDelete = useCallback(
    ([edge]: Edge[]) => {
      const target = nodes.find(({ id }) => edge.target === id) as Node
      const source = nodes.find(({ id }) => edge.source === id) as Node

      if (target.type === 'powerRail' && source.type === 'powerRail') {
        setNodes((state) =>
          state.map((node) => {
            if (node.id === source.id) {
              node.data.pins = node.data.pins.filter(
                ({ id }: Node<'powerRail'>) => id !== edge.sourceHandle,
              )
            }
            if (node.id === target.id) {
              node.data.pins = node.data.pins.filter(
                ({ id }: Node<'powerRail'>) => id !== edge.targetHandle,
              )
            }
            return node
          }),
        )
      }
    },
    [nodes, setNodes],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (!reactFlowInstance || !reactFlowWrapper.current) return

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect()
      const type = event.dataTransfer.getData('application/reactflow')

      // check if the dropped element is valid
      if (typeof type === 'undefined' || !type) {
        return
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      })
      const newNode = {
        id: crypto.randomUUID(),
        type,
        position,
        data: { label: `${type} node` },
      }

      setNodes((nds) => nds.concat(newNode))
    },
    [reactFlowInstance, setNodes],
  )

  return (
    <div className="reactflow-wrapper h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesChange={onNodesChange}
        connectionMode={ConnectionMode.Loose}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
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
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default WhiteBoard
