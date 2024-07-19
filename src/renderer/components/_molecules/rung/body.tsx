import type { CoordinateExtent } from '@xyflow/react'
import { getNodesBounds, Panel, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

export const RungBody = () => {
  const flow = useReactFlow()
  const nodes = useStore((state) => state.nodes)
  const [flowPanelExtent, setFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    [1500, 200],
  ])

  useEffect(() => {
    flow?.addNodes([
      {
        id: '1',
        position: { x: 0, y: 0 },
        data: { label: 'Node 1' },
      },
      {
        id: '2',
        position: { x: 1350, y: 160 },
        data: { label: 'Node 2' },
      },
    ])
  }, [])

  useEffect(() => {
    console.log('Nodes:', nodes)
    const bounds = getNodesBounds(nodes)
    const [panelExtentWidth, panelExtentHeight] = flowPanelExtent[1]
    const newPanelExtent: CoordinateExtent = [
      [0, 0],
      [Math.max(bounds.width, panelExtentWidth), Math.max(bounds.height, panelExtentHeight)],
    ]
    setFlowPanelExtent(newPanelExtent)
  }, [nodes.length])

  useEffect(() => {
    console.log('Flow panel extent:', flowPanelExtent)
  }, [flowPanelExtent])

  const handleAddNode = () => {
    flow?.addNodes([
      {
        id: '3',
        position: { x: 300, y: 100 },
        data: { label: 'Node 3' },
      },
    ])
  }

  const handleRemoveNode = () => {
    flow
      ?.deleteElements({ nodes: [{ id: '3' }] })
      .then(() => {
        console.log('Node 3 removed')
      })
      .catch((error) => {
        console.error('Error removing Node 3:', error)
      })
  }

  return (
    <div aria-label='Rung body' className='h-52 w-full rounded-b-lg border border-t-0 dark:border-neutral-800'>
      <FlowPanel
        viewportConfig={{
          nodeExtent: flowPanelExtent,
          translateExtent: flowPanelExtent,
        }}
      >
        <Panel position='bottom-left'>
          <button onClick={handleAddNode}>Add Node</button>
        </Panel>
        <Panel position='bottom-right'>
          <button onClick={handleRemoveNode}>Remove Node</button>
        </Panel>
      </FlowPanel>
    </div>
  )
}
