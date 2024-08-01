import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import type { CoordinateExtent, Node, OnConnect, OnEdgesChange, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { addEdge, applyEdgeChanges, applyNodeChanges, getNodesBounds, Panel } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'
import { customNodeTypes, nodesBuilder } from '../../_atoms/react-flow/custom-nodes'
import { connectNodes, disconnectNodes } from './utils'

type RungBodyProps = {
  rung: FlowState
}

export const RungBody = ({ rung }: RungBodyProps) => {
  const GAP_BETWEEN_NODES = 10

  const { flowActions } = useOpenPLCStore()

  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<FlowState>(rung)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)

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
    const [defaultWidth, defaultHeight] = defaultFlowPanelExtent

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height],
    ])
  }, [rungLocal.nodes.length])

  useEffect(() => {
    console.log('local rung', rungLocal), [rungLocal]
  })

  const updateFlowStore = () => {
    if (reactFlowInstance) {
      const flow = reactFlowInstance.toObject()
      flowActions.setNodes({ rungId: rungLocal.id, nodes: flow.nodes })
      flowActions.setEdges({ rungId: rungLocal.id, edges: flow.edges })
    }
  }

  const handleAddNode = () => {
    const leftPowerRailNode = rungLocal.nodes.find((node) => node.id === 'left-rail') as Node
    const rightPowerRailNode = rungLocal.nodes.find((node) => node.id === 'right-rail') as Node

    const nodes = rungLocal.nodes.filter((node) => node.id !== 'left-rail' && node.id !== 'right-rail')

    const lastNode = nodes[nodes.length - 1] ?? leftPowerRailNode
    const lastNodeHandles = lastNode.data.handles as { type: 'source' | 'target'; x: number; y: number }[]
    const sourceLastNodeHandle = lastNodeHandles.find((handle) => handle.type === 'source')

    console.log('sourceLastNodeHandle', sourceLastNodeHandle)

    const newNode: Node = nodesBuilder.mockNode({
      id: `node-${nodes.length}`,
      label: `Node ${nodes.length}`,
      posX: lastNode.position.x + (lastNode.width ?? 0) + GAP_BETWEEN_NODES,
      posY: sourceLastNodeHandle?.y ?? lastNode.position.y,
      handleX: lastNode.position.x + (lastNode.width ?? 0) + GAP_BETWEEN_NODES,
      handleY: sourceLastNodeHandle?.y ?? lastNode.position.y,
    })

    let newEdge = rung.edges
    newEdge = connectNodes(rungLocal, lastNode.id, newNode.id)

    setRungLocal((rung) => ({
      ...rung,
      nodes: [leftPowerRailNode, ...nodes, newNode, rightPowerRailNode],
      edges: newEdge,
    }))
    updateFlowStore()
  }

  const handleRemoveNode = () => {
    const leftPowerRailNode: Node = rungLocal.nodes.find((node) => node.id === 'left-rail') as Node
    const rightPowerRailNode: Node = rungLocal.nodes.find((node) => node.id === 'right-rail') as Node

    const nodes = rungLocal.nodes.filter((node) => node.id !== 'left-rail' && node.id !== 'right-rail')
    const lastNode: Node = nodes[nodes.length - 1]
    if (!lastNode) return

    const edge = rungLocal.edges.find((edge) => edge.source === lastNode.id)
    const newEdges = disconnectNodes(rungLocal, edge?.source ?? '', edge?.target ?? '')

    setRungLocal((rung) => ({
      ...rung,
      nodes: [leftPowerRailNode, ...nodes.slice(0, -1), rightPowerRailNode],
      edges: newEdges,
    }))
    updateFlowStore()
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
      updateFlowStore()
    },
    [setRungLocal, flowActions],
  )

  const onConnect: OnConnect = useCallback(
    (connection) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: addEdge(connection, rung.edges),
      }))
    },
    [setRungLocal, flowActions],
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
