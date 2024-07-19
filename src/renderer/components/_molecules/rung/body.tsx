import type { CoordinateExtent, Node } from '@xyflow/react'
import { getNodesBounds, Panel, useNodes, useReactFlow, useViewport } from '@xyflow/react'
import { useEffect, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

export const RungBody = () => {
  const flow = useReactFlow()
  const nodes = useNodes()
  const viewport = useViewport()

  /**
   * Default flow panel extent:
   * width: 1500
   * height: 200
   * -- Which means:
   * minX: 0    | minY: 0
   * maxX: 1500 | maxY: 200
   */
  const defaultFlowPanelExtent: [number, number] = [1500, 200]
  const [flowPanelExtent, setFlowPanelExtent] = useState<CoordinateExtent>([[0, 0], defaultFlowPanelExtent])

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
    console.log('Nodes:', nodes)
    const bounds = getNodesBounds(nodes)
    console.log('Bounds:', bounds)
    const [defaultWidth, defaultHeight] = defaultFlowPanelExtent

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height],
    ])
  }, [nodes.length])

  useEffect(() => {
    console.log('Viewport:', viewport)
  }, [viewport])

  const handleAddNode = () => {
    let biggestId: number = 0
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (Number(nodes[i].id) > biggestId) {
        biggestId = Number(nodes[i].id)
      }
    }
    const lastNode: Node = nodes.find((node) => Number(node.id) === biggestId) || nodes[0]
    flow?.addNodes([
      {
        id: String(Number(lastNode.id) + 1),
        position: { x: lastNode.position.x + 150, y: lastNode.position.y + 40 },
        data: { label: `Node ${Number(lastNode.id) + 1}` },
        width: 150,
        height: 40,
      },
    ])
  }

  const handleRemoveNode = () => {
    let biggestId: number = 0
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (Number(nodes[i].id) > biggestId) {
        biggestId = Number(nodes[i].id)
      }
    }
    const lastNode: Node = nodes.find((node) => Number(node.id) === biggestId) || nodes[0]
    flow
      ?.deleteElements({
        nodes: [{ id: lastNode.id }],
      })
      .catch((error) => {
        console.error('Error removing node:', error)
      })
  }

  return (
    <div
      aria-label='Rung body'
      className='h-fit w-full overflow-x-auto rounded-b-lg border border-t-0 dark:border-neutral-800'
    >
      <div
        style={{
          minHeight: '208px',
          height: flowPanelExtent[1][1] + 8,
          minWidth: '100%',
          width: flowPanelExtent[1][0] + 8,
        }}
      >
        <FlowPanel
          viewportConfig={{
            nodeExtent: flowPanelExtent,
            translateExtent: flowPanelExtent,
            panActivationKeyCode: null,
            panOnDrag: false,
            panOnScroll: false,
            zoomActivationKeyCode: null,
            zoomOnDoubleClick: false,
            zoomOnPinch: false,
            zoomOnScroll: false,
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
    </div>
  )
}
