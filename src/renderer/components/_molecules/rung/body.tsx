import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import type { CoordinateExtent, Node, OnConnect, OnEdgesChange, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges, getNodesBounds, Panel } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'
import { customNodeTypes } from '../../_atoms/react-flow/custom-nodes'
import { addNewNode, removeNode } from './ladder-utils'

/**
 * Default flow panel extent:
 * width: 1530
 * height: 208
 */
type RungBodyProps = {
  rung: FlowState
}

export const RungBody = ({ rung }: RungBodyProps) => {
  const { flowActions } = useOpenPLCStore()

  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<FlowState>(rung)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)

  /**
   * -- Which means, by default, the flow panel extent is:
   * minX: 0    | minY: 0
   * maxX: 1530 | maxY: 200
   */
  const [flowPanelExtent, setFlowPanelExtent] = useState<CoordinateExtent>([[0, 0], rung?.flowViewport ?? [1530, 200]])

  /**
   * Update flow panel extent based on the bounds of the nodes
   * To make the getNodesBounds function work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  useEffect(() => {
    const zeroPositionNode: Node = {
      id: '-1',
      position: { x: 0, y: 0 },
      data: { label: 'Node 0' },
      width: 150,
      height: 40,
    }
    const bounds = getNodesBounds([zeroPositionNode, ...rungLocal.nodes])
    const [defaultWidth, defaultHeight] = rung?.flowViewport ?? [1530, 200]

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height],
    ])
  }, [rungLocal.nodes.length])

  useEffect(() => {
    updateFlowStore()
  }, [rungLocal.nodes.length])

  const updateFlowStore = () => {
    if (reactFlowInstance) {
      const flow = reactFlowInstance.toObject()
      flowActions.setNodes({ rungId: rungLocal.id, nodes: flow.nodes })
      flowActions.setEdges({ rungId: rungLocal.id, edges: flow.edges })
    }
  }

  const handleAddNode = (newNodeType: string = 'mockNode') => {
    const { nodes, edges } = addNewNode({
      rungLocal,
      newNodeType,
      defaultBounds: rung?.flowViewport ?? [1530, 200],
    })
    setRungLocal((rung) => ({ ...rung, nodes, edges }))
  }

  const handleRemoveNode = () => {
    const { nodes, edges } = removeNode({
      rungLocal,
      defaultBounds: rung?.flowViewport ?? [1530, 200],
    })
    setRungLocal((rung) => ({ ...rung, nodes, edges }))
  }

  const onNodesChange: OnNodesChange<Node> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
      }))
    },
    [setRungLocal],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: applyEdgeChanges(changes, rung.edges),
      }))
      flowActions.onEdgesChange({ rungId: rungLocal.id, changes })
    },
    [setRungLocal],
  )

  const onConnect: OnConnect = useCallback(
    (connection) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: addEdge(connection, rung.edges),
      }))
    },
    [setRungLocal],
  )

  return (
    <div className='h-fit w-full rounded-b-lg border border-t-0 p-1 dark:border-neutral-800'>
      <div aria-label='Rung body' className='h-full w-full overflow-x-auto'>
        <div
          style={{
            height: flowPanelExtent[1][1] + 8,
            width: flowPanelExtent[1][0],
          }}
        >
          <FlowPanel
            viewportConfig={{
              nodeTypes: nodeTypes,

              nodes: rungLocal.nodes,
              edges: rungLocal.edges,
              onInit: setReactFlowInstance,
              onNodesChange: onNodesChange,
              onNodeDragStop: updateFlowStore,
              onEdgesChange: onEdgesChange,
              onConnect: onConnect,
              onConnectEnd: updateFlowStore,

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
            <Panel position='top-left'>
              <button onClick={() => handleAddNode('contact')}>Add Contact Node</button>
            </Panel>
            <Panel position='bottom-left'>
              <button onClick={() => handleAddNode('block')}>Add Block Node</button>
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
