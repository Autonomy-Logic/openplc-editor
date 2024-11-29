import * as Portal from '@radix-ui/react-portal'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RungState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC'
import type { CoordinateExtent, Node as FlowNode, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { applyNodeChanges, getNodesBounds } from '@xyflow/react'
import { differenceWith, isEqual, parseInt } from 'lodash'
import { DragEventHandler, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FlowPanel } from '../../_atoms/react-flow'
import { customNodeTypes } from '../../_atoms/react-flow/custom-nodes'
import type { BlockNode } from '../../_atoms/react-flow/custom-nodes/block'
import type { CoilNode } from '../../_atoms/react-flow/custom-nodes/coil'
import type { ContactNode } from '../../_atoms/react-flow/custom-nodes/contact'
import type { BasicNodeData } from '../../_atoms/react-flow/custom-nodes/utils/types'
import { toast } from '../../_features/[app]/toast/use-toast'
import BlockElement from '../../_features/[workspace]/editor/graphical/elements/block'
import CoilElement from '../../_features/[workspace]/editor/graphical/elements/coil'
import ContactElement from '../../_features/[workspace]/editor/graphical/elements/contact'
import { addNewElement, removeElements } from './ladder-utils/elements'
import { onElementDragOver, onElementDragStart, onElementDrop } from './ladder-utils/elements/drag-n-drop'
import {
  removePlaceholderElements,
  renderPlaceholderElements,
  searchNearestPlaceholder,
} from './ladder-utils/elements/placeholder'

type RungBodyProps = {
  rung: RungState
}

export const RungBody = ({ rung }: RungBodyProps) => {
  const {
    flowActions,
    libraries,
    editor,
    editorActions: { updateModelVariables },
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
  } = useOpenPLCStore()

  const pouRef = pous.find((pou) => pou.data.name === editor.meta.name)
  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<RungState>(rung)
  const [selectedNodes, setSelectedNodes] = useState<FlowNode[]>([])

  const [modalNode, setModalNode] = useState<FlowNode | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const flowViewportRef = useRef<HTMLDivElement>(null)

  /**
   * -- Which means, by default, the flow panel extent is:
   * minX: 0    | minY: 0
   * maxX: 1530 | maxY: 200
   */
  const [flowPanelExtent, setFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    (rung?.flowViewport as [number, number]) ?? [1530, 200],
  ])

  /**
   * Update flow panel extent based on the bounds of the nodes
   * To make the getNodesBounds function work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  const updateFlowPanelExtent = (rung: RungState) => {
    const zeroPositionNode: FlowNode = {
      id: '-1',
      position: { x: 0, y: 0 },
      data: { label: 'Node 0' },
      width: 150,
      height: 40,
    }
    const bounds = getNodesBounds([zeroPositionNode, ...rung.nodes])
    const [defaultWidth, defaultHeight] = rung?.defaultBounds ?? [1530, 200]

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height + 20],
    ])
    flowActions.updateFlowViewport({
      editorName: editor.meta.name,
      rungId: rungLocal.id,
      flowViewport: [bounds.width, bounds.height + 20],
    })
  }

  useEffect(() => {
    updateFlowPanelExtent(rungLocal)
  }, [rungLocal.nodes.length])

  /**
   *  Update the local rung state when the rung state changes
   */
  useEffect(() => {
    // console.log(`Rung ${rung.id} nodes changed`, rung)
    setRungLocal(rung)
  }, [rung.nodes])

  /**
   * Disable dragging for all nodes when multiple nodes are selected
   */
  useEffect(() => {
    // Update the selected nodes in the rung state
    flowActions.setSelectedNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: selectedNodes,
    })

    // Disable dragging for all nodes when multiple nodes are selected
    if (selectedNodes.length > 1) {
      setRungLocal((rung) => ({
        ...rung,
        nodes: rung.nodes.map((node) => {
          if (selectedNodes.map((n) => n.id).includes(node.id)) {
            return {
              ...node,
              draggable: false,
            }
          }
          return node
        }),
      }))
      return
    }
    setRungLocal((rung) => ({
      ...rung,
      nodes: rung.nodes.map((node) => ({
        ...node,
        draggable: (node.data as BasicNodeData).draggable === false ? false : true,
      })),
    }))
  }, [
    selectedNodes.length > 0
      ? differenceWith(selectedNodes, rung.selectedNodes || [], (a, b) => isEqual(a, b)).length > 0
      : differenceWith(rung.selectedNodes || [], selectedNodes, (a, b) => isEqual(a, b)).length > 0,
  ])

  /**
   * Add a new node to the rung
   */
  const handleAddNode = (newNodeType: string = 'mockNode', blockType: string | undefined) => {
    let pouLibrary = undefined
    if (blockType) {
      const [blockLibraryType, blockLibrary, pouName] = blockType.split('/')
      if (blockLibraryType === 'system')
        pouLibrary = libraries.system
          .find((Library) => Library.name === blockLibrary)
          ?.pous.find((p) => p.name === pouName)
      if (blockLibraryType === 'user') {
        const Library = libraries.user.find((Library) => Library.name === blockLibrary)
        const pou = pous.find((pou) => pou.data.name === Library?.name)
        if (!pou) return
        console.log(pou)
        pouLibrary = {
          name: pou.data.name,
          type: pou.type,
          variables: pou.data.variables.map((variable) => ({
            name: variable.name,
            class: variable.class,
            type: { definition: variable.type.definition, value: variable.type.value },
          })),
          documentation: pou.data.documentation,
          extensible: false,
        }
      }

      if (!pouLibrary) {
        const nodes = removePlaceholderElements(rungLocal.nodes)
        setRungLocal((rung) => ({ ...rung, nodes }))
        toast({
          title: 'Can not add block',
          description: `The block type ${blockType} does not exist in the library`,
          variant: 'fail',
        })
        return
      }
    }

    const { nodes, edges } = addNewElement(rungLocal, {
      elementType: newNodeType,
      blockVariant: pouLibrary,
    })
    flowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes })
    flowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges })
  }

  /**
   * Remove some nodes from the rung
   */
  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { nodes: newNodes, edges: newEdges } = removeElements({ ...rungLocal }, nodes)
    flowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes: newNodes })
    flowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges: newEdges })

    const blockNodes = nodes.filter((node) => node.type === 'block')
    if (blockNodes.length > 0) {
      let variables: PLCVariable[] = []
      if (pouRef) variables = pouRef.data.variables as PLCVariable[]

      blockNodes.forEach((blockNode) => {
        const variableIndex = variables.findIndex(
          (variable) => variable.id === (blockNode.data as BasicNodeData).variable.id,
        )
        if (variableIndex !== -1)
          deleteVariable({
            rowId: variableIndex,
            scope: 'local',
            associatedPou: editor.meta.name,
          })
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variableIndex
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
      })
    }
  }

  /**
   * Handle the start of a node drag
   */
  const handleNodeStartDrag = (node: FlowNode) => {
    const result = onElementDragStart(rungLocal, node)
    setRungLocal((rung) => ({ ...rung, nodes: result.nodes, edges: result.edges }))
  }

  /**
   * Handle the drag of a node
   */
  const handleNodeDrag = (event: MouseEvent) => {
    if (!reactFlowInstance) return
    const closestPlaceholder = onElementDragOver(rungLocal, reactFlowInstance, { x: event.clientX, y: event.clientY })
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

  /**
   * Handle the stop of a node drag
   */
  const handleNodeDragStop = (node: FlowNode) => {
    const result = onElementDrop(rungLocal, rung, node)
    flowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes: result.nodes })
    flowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges: result.edges })
  }

  /**
   * Handle the double click of a node
   */
  const handleNodeDoubleClick = (node: FlowNode) => {
    setModalNode(node)
    setModalOpen(true)
  }

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    setModalNode(null)
    setModalOpen(false)
  }

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
      }))
    },
    [rungLocal],
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      // Check if the dragged element is not a ladder block
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) {
        return
      }

      event.preventDefault()

      // if (!flowViewportRef.current || !relatedTarget || !flowViewportRef.current.contains(relatedTarget as Node)) {
      //   return
      // }

      // If it is a ladder block and the dragged element is a child of the flow viewport, render the placeholder elements
      const copyRungLocal = { ...rungLocal }
      const nodes = renderPlaceholderElements(copyRungLocal)
      setRungLocal((rung) => ({ ...rung, nodes }))
    },
    [rung, rungLocal],
  )

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useCallback<DragEventHandler>(
    (event) => {
      // Check if the dragged element is a child of the flow viewport
      const { relatedTarget } = event
      if (!flowViewportRef.current || !relatedTarget || flowViewportRef.current.contains(relatedTarget as Node)) {
        return
      }

      // If it is, remove the placeholder elements`
      const nodes = removePlaceholderElements(rungLocal.nodes)
      setRungLocal((rung) => ({ ...rung, nodes }))
    },
    [rung, rungLocal],
  )

  /**
   * Handle the drag over of the viewport
   * This function is called when a dragged element is over the viewport
   */
  const onDragOver = useCallback<DragEventHandler>(
    (event) => {
      if (!reactFlowInstance) return

      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'

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
    [rung, rungLocal],
  )

  /**
   * Handle the drop of the viewport
   * This function is called when a dragged element is dropped in the viewport
   */
  const onDrop = useCallback<DragEventHandler>(
    (event) => {
      // Check if there is a ladder block in the dragged data
      event.preventDefault()
      const blockType =
        event.dataTransfer.getData('application/reactflow/ladder-blocks') === ''
          ? undefined
          : event.dataTransfer.getData('application/reactflow/ladder-blocks')
      if (!blockType) {
        setRungLocal(rung)
        return
      }

      // Check if there is a library in the dragged data
      const library =
        event.dataTransfer.getData('application/library') === ''
          ? undefined
          : event.dataTransfer.getData('application/library')

      // Then add the node to the rung
      handleAddNode(blockType, library)
    },
    [rung, rungLocal],
  )

  return (
    <div className='relative h-fit w-full rounded-b-lg border border-t-0 p-1 dark:border-neutral-800'>
      <div aria-label='Rung body' className='h-full w-full overflow-x-auto' ref={flowViewportRef}>
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
              nodesFocusable: false,
              edgesFocusable: false,
              defaultEdgeOptions: {
                deletable: false,
                selectable: false,
                type: 'smoothstep',
              },

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
              onNodeDoubleClick: (_event, node) => {
                handleNodeDoubleClick(node)
              },
              onSelectionChange: (selectedNodes) => {
                setSelectedNodes(selectedNodes.nodes)
              },

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
              nodeDragThreshold: 15,

              proOptions: {
                hideAttribution: true,
              },
            }}
          />
        </div>
      </div>
      <Portal.Root>
        {modalNode?.type === 'block' && (
          <BlockElement
            onClose={handleModalClose}
            selectedNode={modalNode as BlockNode<object>}
            isOpen={modalOpen}
            onOpenChange={setModalOpen}
          />
        )}
        {modalNode?.type === 'contact' && (
          <ContactElement
            onClose={handleModalClose}
            node={modalNode as ContactNode}
            rungId={rungLocal.id}
            isOpen={modalOpen}
            onOpenChange={setModalOpen}
          />
        )}
        {modalNode?.type === 'coil' && (
          <CoilElement
            onClose={handleModalClose}
            node={modalNode as CoilNode}
            rungId={rungLocal.id}
            isOpen={modalOpen}
            onOpenChange={setModalOpen}
          />
        )}
      </Portal.Root>
    </div>
  )
}
