import { CoordinateExtent, Edge, Node } from '@xyflow/react'
import { useEffect, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

export const RungBody = () => {

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [viewport, setViewport] = useState<CoordinateExtent>([
    [0, 0],
    [0, 0],
  ])

  const viewportSize = () => {
    let width: number = 1000
    let height: number = 150
    nodes.forEach((node) => {
      const { position } = node
      const { x, y } = position
      if (x > width) width = x + 10
      if (y > height) height = y + 10
    })
    setViewport([
      [0, 0],
      [width, height],
    ])
  }

  useEffect(() => {
    viewportSize()
  }, [])

  return (
    <div aria-label='Rung body' className='h-52 w-full rounded-b-lg border border-t-0 p-1 dark:border-neutral-800'>
      <FlowPanel
        edges={edges}
        setEdges={setEdges}
        nodes={nodes}
        setNodes={setNodes}
        viewportConfig={{
          snapToGrid: true,
          translateExtent: viewport,
          nodeExtent: viewport,
          onNodeDragStop: viewportSize,
        }}
      />
    </div>
  )
}
