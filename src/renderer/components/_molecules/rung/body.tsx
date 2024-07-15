import { CoordinateExtent, Edge, Node } from '@xyflow/react'
import { useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

export const RungBody = () => {
  const [initialNodes, setInitialNodes] = useState<Node[]>([
    {
      id: '1',
      data: { label: 'Hello' },
      position: { x: 0, y: 0 },
      type: 'input',
      draggable: false,
    },
    {
      id: '2',
      data: { label: 'World' },
      position: { x: 100, y: 100 },
    },
  ])
  const [initialEdges, setInitialEdges] = useState<Edge[]>([])

  const [viewport, setViewport] = useState<CoordinateExtent>([
    [0, 0],
    [1500, 200],
  ])

  const viewportSize = () => {
    let width: number = viewport[1][0]
    let height: number = viewport[1][1]
    initialNodes.forEach((node) => {
      const { position } = node
      const { x = 0, y = 0 } = position
      if (x > width) width = x + 10
      if (y > height) height = y + 10
    })
    setViewport([
      [0, 0],
      [width, height],
    ])
  }

  return (
    <div aria-label='Rung body' className='h-52 w-full rounded-b-lg border border-t-0 dark:border-neutral-800'>
      <FlowPanel
        /**
         * Initial value for edges and nodes
         * @WIP - must be refactored to use workspace slice
         */
        edgesInitialValue={initialEdges}
        nodesInitialValue={initialNodes}
        setEdgesInitialValue={setInitialEdges}
        setNodesInitialValue={setInitialNodes}
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
