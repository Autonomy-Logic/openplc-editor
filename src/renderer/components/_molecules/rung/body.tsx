import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import type { CoordinateExtent, Node, OnEdgesChange, OnNodesChange } from '@xyflow/react'
import { applyEdgeChanges, applyNodeChanges, Edge, getNodesBounds, Panel } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'

type RungBodyProps = {
  rung: FlowState
}

export const RungBody = ({ rung }: RungBodyProps) => {
  const { flowActions } = useOpenPLCStore()
  const [nodes, setNodes] = useState<Node[]>(rung.nodes)
  const [edges, setEdges] = useState<Edge[]>(rung.edges)

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

  useEffect(() => {
    setNodes(rung.nodes)
    console.log('rung.nodes', rung.nodes)
  }, [rung.nodes])

  useEffect(() => {
    setEdges(rung.edges)
    console.log('rung.edges', rung.edges)
  }, [rung.edges])

  /**
   * Update flow panel extent based on the bounds of the nodes
   * To make the getNodesBounds function work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  useEffect(() => {
    const bounds = getNodesBounds(nodes)
    const [defaultWidth, defaultHeight] = defaultFlowPanelExtent

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height],
    ])
  }, [nodes])

  const handleAddNode = () => {
    const lastNode = nodes[nodes.length - 1]
    flowActions.setNodes({
      rungId: rung.id,
      nodes: [
        ...nodes,
        {
          id: `${nodes.length + 1}`,
          position: { x: lastNode.position.x + 150, y: lastNode.position.y + 40 },
          data: { label: `Node ${nodes.length + 1}` },
          width: 150,
          height: 40,
        },
      ],
    })
  }

  const handleRemoveNode = () => {
    flowActions.setNodes({
      rungId: rung.id,
      nodes: nodes.filter((node) => node.id !== `${nodes.length}`),
    })
  }

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds))
    },
    [setNodes],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds))
      flowActions.onEdgesChange({ changes, rungId: rung.id })
    },
    [setEdges],
  )

  return (
    <div className='h-fit w-full rounded-b-lg border border-t-0 p-1 dark:border-neutral-800'>
      <div aria-label='Rung body' className='h-full w-full overflow-x-auto'>
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
              nodes: nodes,
              edges: edges,
              onNodesChange: onNodesChange,
              onNodeDragStop: (_, node) => flowActions.updateNode({ node, rungId: rung.id }),
              onEdgesChange: onEdgesChange,
              onConnect: (changes) => flowActions.onConnect({ changes, rungId: rung.id }),

              nodeExtent: flowPanelExtent,
              translateExtent: flowPanelExtent,
              panActivationKeyCode: null,
              panOnDrag: false,
              panOnScroll: false,
              zoomActivationKeyCode: null,
              zoomOnDoubleClick: false,
              zoomOnPinch: false,
              zoomOnScroll: false,
              preventScrolling: false,
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
    </div>
  )
}
