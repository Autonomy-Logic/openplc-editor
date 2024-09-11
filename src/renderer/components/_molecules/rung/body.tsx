import { useOpenPLCStore } from '@root/renderer/store'
import { FlowState } from '@root/renderer/store/slices'
import type { CoordinateExtent, Node as FlowNode, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { applyNodeChanges, getNodesBounds } from '@xyflow/react'
import { DragEventHandler, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'
import { customNodeTypes } from '../../_atoms/react-flow/custom-nodes'
import {
  addNewElement,
  onDragElement,
  onDragStartElement,
  onDragStopElement,
  removeElements,
  removePlaceholderNodes,
  renderPlaceholderNodes,
  searchNearestPlaceholder,
} from './ladder-utils/elements'

type RungBodyProps = {
  rung: FlowState
}

export const RungBody = ({ rung }: RungBodyProps) => {
  const { flowActions } = useOpenPLCStore()

  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<FlowState>(rung)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const flowRef = useRef<HTMLDivElement>(null)

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
    const zeroPositionNode: FlowNode = {
      id: '-1',
      position: { x: 0, y: 0 },
      data: { label: 'Node 0' },
      width: 150,
      height: 40,
    }
    const bounds = getNodesBounds([zeroPositionNode, ...rungLocal.nodes])
    const [defaultWidth, defaultHeight] = rung?.defaultBounds ?? [1530, 200]

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height + 20],
    ])
    flowActions.updateFlowViewport({ rungId: rungLocal.id, flowViewport: [bounds.width, bounds.height + 20] })
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
    const { nodes, edges } = addNewElement(rungLocal, newNodeType)
    setRungLocal((rung) => ({ ...rung, nodes, edges }))
  }

  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { nodes: newNodes, edges: newEdges } = removeElements(rungLocal, nodes)
    setRungLocal((rung) => ({ ...rung, nodes: newNodes, edges: newEdges }))
  }

  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
      }))
    },
    [rungLocal],
  )

  const handleNodeStartDrag = (node: FlowNode) => {
    const result = onDragStartElement(rungLocal, node)
    setRungLocal((rung) => ({ ...rung, nodes: result.nodes, edges: result.edges }))
  }

  const handleNodeDrag = (event: MouseEvent) => {
    if (!reactFlowInstance) return
    const closestPlaceholder = onDragElement(rungLocal, reactFlowInstance, { x: event.clientX, y: event.clientY })
    if (!closestPlaceholder) return

    setRungLocal((rung) => ({
      ...rung,
      nodes: rung.nodes.map((node) => {
        if (node.id === closestPlaceholder.id) {
          return {
            ...node,
            selected: true,
          }
        }
        return {
          ...node,
          selected: false,
        }
      }),
    }))
  }

  const handleNodeDragStop = (node: FlowNode) => {
    const result = onDragStopElement(rungLocal, node)
    console.log('result', result)
    setRungLocal((rung) => ({ ...rung, nodes: result.nodes, edges: result.edges }))
  }

  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) return

      event.preventDefault()
      const { relatedTarget } = event
      if (!flowRef.current || !relatedTarget || flowRef.current.contains(relatedTarget as Node)) return
      const copyRungLocal = { ...rungLocal }
      const nodes = renderPlaceholderNodes(copyRungLocal)
      setRungLocal((rung) => ({ ...rung, nodes }))
    },
    [rungLocal],
  )

  const onDragLeaveViewport = useCallback<DragEventHandler>(
    (event) => {
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) return

      const { relatedTarget } = event
      if (!flowRef.current || !relatedTarget || flowRef.current.contains(relatedTarget as Node)) return
      console.log('SAI')
      const nodes = removePlaceholderNodes(rungLocal.nodes)
      setRungLocal((rung) => ({ ...rung, nodes }))
    },
    [rungLocal],
  )

  const onDragOver = useCallback<DragEventHandler>(
    (event) => {
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) return

      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'

      if (!reactFlowInstance) return

      const closestPlaceholder = searchNearestPlaceholder(rungLocal, reactFlowInstance, {
        x: event.clientX,
        y: event.clientY,
      })
      if (!closestPlaceholder) return

      setRungLocal((rung) => ({
        ...rung,
        nodes: rung.nodes.map((node) => {
          if (node.id === closestPlaceholder.id) {
            return {
              ...node,
              selected: true,
            }
          }
          return {
            ...node,
            selected: false,
          }
        }),
      }))
    },
    [rungLocal],
  )

  const onDrop = useCallback<DragEventHandler>(
    (event) => {
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) return

      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow/ladder-blocks')
      if (!type) {
        const nodes = removePlaceholderNodes(rungLocal.nodes)
        setRungLocal((rung) => ({ ...rung, nodes }))
        return
      }
      handleAddNode(type)
    },
    [rungLocal],
  )

  return (
    <div className='relative h-fit w-full rounded-b-lg border border-t-0 p-1 dark:border-neutral-800'>
      <div aria-label='Rung body' className='h-full w-full overflow-x-auto'>
        <div
          style={{
            height: flowPanelExtent[1][1] + 8,
            width: flowPanelExtent[1][0],
          }}
          ref={flowRef}
        >
          <FlowPanel
            viewportConfig={{
              nodeTypes: nodeTypes,
              defaultEdgeOptions: {
                deletable: false,
                selectable: false,
                type: 'smoothstep',
              },

              nodes: rungLocal.nodes,
              edges: rungLocal.edges,

              onInit: setReactFlowInstance,

              onNodesChange: onNodesChange,
              onNodesDelete: (nodes) => {
                handleRemoveNode(nodes)
              },
              onNodeDragStart: (_event, node) => {
                handleNodeStartDrag(node)
              },
              onNodeDrag: (event, _node) => {
                handleNodeDrag(event)
              },
              onNodeDragStop: (_event, node) => {
                handleNodeDragStop(node)
              },

              onConnectEnd: updateFlowStore,

              onDragEnter: onDragEnterViewport,
              onDragLeave: onDragLeaveViewport,
              onDragOver: onDragOver,
              onDrop: onDrop,

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

              proOptions: {
                hideAttribution: true,
              },
            }}
          />
        </div>
      </div>
    </div>
  )
}
