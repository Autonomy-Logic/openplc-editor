import type { CoordinateExtent } from '@xyflow/react'
import { getNodesBounds, Panel, useReactFlow, useStore } from '@xyflow/react'
import { useEffect, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

export const RungBody = () => {
  const flow = useReactFlow()
  const nodes = useStore((state) => state.nodes)

  /**
   * Default flow panel extent:
   * width: 1500
   * height: 200
   * -- Which means:
   * minX: 0    | minY: 0
   * maxX: 1500 | maxY: 200
   */
  const defaultFlowPanelExtent: [number, number] = [1500, 200]
  const [flowPanelExtent, setFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    defaultFlowPanelExtent,
  ])

  /**
   * Default width and height of nodes:
   * width: 150
   * height: 40
   */
  useEffect(() => {
    flow?.addNodes([
      {
        id: '1',
        position: { x: 0, y: 0 },
        data: { label: 'Node 1' },
        width: 150,
        height: 40,
      },
      {
        id: '2',
        position: { x: 1350, y: 160 },
        data: { label: 'Node 2' },
        width: 150,
        height: 40,
      },
    ])
  }, [])

  /**
   * Update flow panel extent based on the bounds of the nodes
   * To make the getNodesBounds function work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  useEffect(() => {
    const bounds = getNodesBounds(nodes)
    const [panelExtentWidth, panelExtentHeight] = flowPanelExtent[1]
    setFlowPanelExtent([
      [0, 0],
      [Math.max(bounds.width, panelExtentWidth), Math.max(bounds.height, panelExtentHeight)],
    ])
  }, [nodes.length])

  const handleAddNode = () => {
    flow?.addNodes([
      {
        id: '3',
        position: { x: 1500, y: 200 },
        data: { label: 'Node 3' },
        width: 150,
        height: 40,
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
