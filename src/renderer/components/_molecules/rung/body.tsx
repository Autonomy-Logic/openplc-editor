import * as Portal from '@radix-ui/react-portal'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RungState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
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
import { findNode } from './ladder-utils/nodes'

type RungBodyProps = {
  rung: RungState
  className?: string
}

export const RungBody = ({ rung, className }: RungBodyProps) => {
  const {
    flowActions,
    libraries,
    editor,
    editorActions: { updateModelVariables },
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
    modals,
    modalActions: { closeModal, openModal },
    searchQuery,
    searchActions: { setSearchNodePosition },
  } = useOpenPLCStore()

  const pouRef = pous.find((pou) => pou.data.name === editor.meta.name)
  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<RungState>(rung)
  const [dragging, setDragging] = useState(false)

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
    const [defaultWidth, defaultHeight] = rung.defaultBounds

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

  /**
   *  Update the local rung state when the rung state changes
   */
  useEffect(() => {
    setRungLocal(rung)
    updateFlowPanelExtent(rung)
  }, [rung.nodes])

  /**
   *  Update the local rung state when the rung state changes
   */
  useEffect(() => {
    if (
      dragging ||
      (rungLocal.selectedNodes.length > 0 &&
        differenceWith(rungLocal.selectedNodes, rung.selectedNodes, (a, b) => isEqual(a, b)).length === 0)
    ) {
      return
    }

    // Update the selected nodes in the rung state
    flowActions.setSelectedNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: rungLocal.selectedNodes,
    })
  }, [rungLocal.selectedNodes])

  useEffect(() => {
    if (!searchQuery) return

    const foundNode = rungLocal.nodes.find((node) => (node.data as BasicNodeData)?.variable?.name === searchQuery)

    if (foundNode) {
      const nodePosition = findNode(rungLocal, foundNode.id).node?.position

      if (!nodePosition) return

      const zoom = reactFlowInstance?.getZoom() ?? 1
      const pan = reactFlowInstance?.toObject() ?? { x: 0, y: 0 }

      const adjustedSearchNodePosition = {
        x: nodePosition.x * zoom + ('x' in pan ? pan.x : 0),
        y: nodePosition.y * zoom + ('y' in pan ? pan.y : 0),
      }

      setSearchNodePosition(adjustedSearchNodePosition)

      flowViewportRef.current?.scrollTo({
        top: adjustedSearchNodePosition.y,
        left: adjustedSearchNodePosition.x - 100,
        behavior: 'smooth',
      })
    } else {
      setSearchNodePosition({ x: 0, y: 0 })
    }
  }, [searchQuery, rungLocal, reactFlowInstance])

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
        const library = libraries.user.find((library) => library.name === blockLibrary)
        const pou = pous.find((pou) => pou.data.name === library?.name)
        if (!pou) return
        pouLibrary = {
          name: pou.data.name,
          type: pou.type,
          variables: pou.data.variables.map((variable) => ({
            name: variable.name,
            class: variable.class,
            type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
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
    flowActions.setSelectedNodes({
      editorName: editor.meta.name,
      rungId: rungLocal.id,
      nodes: [],
    })

    /**
     * Remove the variable associated with the block node
     * If the editor is a graphical editor and the variable display is set to table, update the model variables
     * If the variable is the selected row, set the selected row to -1
     *
     * !IMPORTANT: This function must be used inside of components, because the functions deleteVariable and updateModelVariables are just available at the useOpenPLCStore hook
     * -- This block of code references at project:
     *    -- src/renderer/components/_molecules/rung/body.tsx
     *    -- src/renderer/components/_molecules/menu-bar/modals/delete-confirmation-modal.tsx
     *    -- src/renderer/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx
     */
    const blockNodes = nodes.filter((node) => node.type === 'block')
    if (blockNodes.length > 0) {
      let variables: PLCVariable[] = []
      if (pouRef) variables = [...pouRef.data.variables] as PLCVariable[]

      blockNodes.forEach((blockNode) => {
        const variableData = (blockNode.data as BasicNodeData)?.variable
        const variableIndex = variables.findIndex((variable) => variable.id === variableData?.id)

        if (variableIndex !== -1) {
          deleteVariable({
            variableId: (blockNode.data as BasicNodeData).variable.id,
            scope: 'local',
            associatedPou: editor.meta.name,
          })
          variables.splice(variableIndex, 1)
        }
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
    setDragging(true)
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
    setDragging(false)
    flowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes: result.nodes })
    flowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges: result.edges })
  }

  /**
   * Handle the double click of a node
   */ //
  const handleNodeDoubleClick = (node: FlowNode) => {
    const modalToOpen =
      node.type === 'block'
        ? 'block-ladder-element'
        : node.type === 'coil'
          ? 'coil-ladder-element'
          : node.type === 'contact'
            ? 'contact-ladder-element'
            : undefined
    if (!modalToOpen) return

    openModal(modalToOpen, node)
  }

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    closeModal()
  }

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
      const selectedNodes: FlowNode[] = rungLocal.nodes.filter((node) => node.selected)
      changes.forEach((change) => {
        if (change.type) {
          const node = rungLocal.nodes.find((n) => n.id === change.id) as FlowNode
          if (!change.selected) {
            const index = selectedNodes.findIndex((n) => n.id === change.id)
            if (index !== -1) selectedNodes.splice(index, 1)
            return
          }
          selectedNodes.push(node)
        }
      })

      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
        selectedNodes: selectedNodes,
      }))
    },
    [rungLocal, rung],
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      event.preventDefault()
      // Check if the dragged element is not a ladder block
      if (!event.dataTransfer.types.includes('application/reactflow/ladder-blocks')) {
        return
      }

      // If it is a ladder block and the dragged element is a child of the flow viewport, render the placeholder elements
      const copyRungLocal = { ...rungLocal }
      const nodes = renderPlaceholderElements(copyRungLocal)
      setDragging(true)
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
      setDragging(false)
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
      event.preventDefault()
      // Check if there is a ladder block in the dragged data
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
      setDragging(false)
      handleAddNode(blockType, library)
    },
    [rung, rungLocal],
  )

  return (
    <div
      className={cn(
        'relative h-fit w-full p-1',
        // 'rounded-b-lg border border-t-0 dark:border-neutral-800',
        className,
      )}
    >
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
              nodeDragThreshold: 25,

              proOptions: {
                hideAttribution: true,
              },
            }}
          />
        </div>
      </div>
      <Portal.Root>
        {modals['block-ladder-element']?.open && (
          <BlockElement
            onClose={handleModalClose}
            selectedNode={modals['block-ladder-element'].data as BlockNode<object>}
            isOpen={modals['block-ladder-element'].open}
          />
        )}
        {modals['contact-ladder-element']?.open && (
          <ContactElement
            onClose={handleModalClose}
            node={modals['contact-ladder-element'].data as ContactNode}
            isOpen={modals['contact-ladder-element'].open}
          />
        )}
        {modals['coil-ladder-element']?.open && (
          <CoilElement
            onClose={handleModalClose}
            node={modals['coil-ladder-element'].data as CoilNode}
            isOpen={modals['coil-ladder-element'].open}
          />
        )}
      </Portal.Root>
    </div>
  )
}
