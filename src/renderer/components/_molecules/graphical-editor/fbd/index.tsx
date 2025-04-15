import { CustomFbdNodeTypes, customNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BlockNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/utils'
import { getVariableRestrictionType } from '@root/renderer/components/_atoms/graphical-editor/utils'
import { ReactFlowPanel } from '@root/renderer/components/_atoms/react-flow'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import BlockElement from '@root/renderer/components/_features/[workspace]/editor/graphical/elements/fbd/block'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDRungState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC/units/variable'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge as FlowEdge,
  Node as FlowNode,
  OnEdgesChange,
  OnNodesChange,
  ReactFlowInstance,
  XYPosition,
} from '@xyflow/react'
import _ from 'lodash'
import { DragEventHandler, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildGenericNode } from './fbd-utils/nodes'

interface FBDProps {
  rung: FBDRungState
}

export const FBDBody = ({ rung }: FBDProps) => {
  const {
    editor,
    editorActions: { updateModelVariables },
    fbdFlowActions,
    libraries,
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
    modals,
    modalActions: { closeModal, openModal },
  } = useOpenPLCStore()

  const pouRef = pous.find((pou) => pou.data.name === editor.meta.name)
  const [rungLocal, setRungLocal] = useState<FBDRungState>(rung)

  const nodeTypes = useMemo(() => customNodeTypes, [])
  const isElementBeingHovered = useMemo(() => {
    if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
      return editor.graphical.hoveringElement.hovering
    }
    return false
  }, [editor])

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRungLocal(rung)
    console.log(rung)
  }, [rung])

  /**
   *  Update the local rung state when the rung state changes
   */
  useEffect(() => {
    // Update the selected nodes in the rung state
    fbdFlowActions.setSelectedNodes({
      editorName: editor.meta.name,
      nodes: rungLocal.selectedNodes,
    })
  }, [rungLocal.selectedNodes])

  const handleAddElementByDropping = (
    position: XYPosition,
    newNodeType: CustomFbdNodeTypes,
    library: string | undefined,
  ) => {
    let pouLibrary = undefined
    if (library) {
      const [blockLibraryType, blockLibrary, pouName] = library.split('/')

      if (blockLibraryType === 'system')
        pouLibrary = libraries.system
          .find((Library) => Library.name === blockLibrary)
          ?.pous.find((p) => p.name === pouName)

      if (blockLibraryType === 'user') {
        const library = libraries.user.find((library) => library.name === blockLibrary)
        const pou = pous.find((pou) => pou.data.name === library?.name)
        if (!pou) return
        const variables = pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        }))

        if (pou.type === 'function') {
          const variable = getVariableRestrictionType(pou.data.returnType)
          variables.push({
            name: 'OUT',
            class: 'output',
            type: {
              definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
              value: pou.data.returnType.toUpperCase(),
            },
          })
        }

        pouLibrary = {
          name: pou.data.name,
          type: pou.type,
          variables: variables,
          documentation: pou.data.documentation,
          extensible: false,
        }
      }

      if (!pouLibrary) {
        toast({
          title: 'Can not add block',
          description: `The block type ${library} does not exist in the library`,
          variant: 'fail',
        })
        return
      }
    }

    const newNode = buildGenericNode({
      id: `${newNodeType.toUpperCase()}-${crypto.randomUUID()}`,
      position,
      nodeType: newNodeType,
      blockType: pouLibrary,
    })

    if (!newNode) {
      toast({
        title: 'Can not add block',
        description: `Internal error`,
        variant: 'fail',
      })
      return
    }

    fbdFlowActions.addNode({
      node: newNode,
      editorName: editor.meta.name,
    })
  }

  const handleOnDelete = (nodes: FlowNode[], edges: FlowEdge[]) => {
    if (nodes.length > 0) {
      fbdFlowActions.removeNodes({
        nodes: nodes,
        editorName: editor.meta.name,
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
       *    -- src/renderer/components/_molecules/graphical-editor/fbd/index.tsx
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

    if (edges.length > 0) {
      fbdFlowActions.removeEdges({
        edges: edges,
        editorName: editor.meta.name,
      })
    }
  }

  const handleOnConnect = (connection: Connection) => {
    fbdFlowActions.onConnect({
      changes: connection,
      editorName: editor.meta.name,
    })
  }

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
      let selectedNodes: FlowNode[] = rungLocal.nodes.filter((node) => node.selected)
      changes.forEach((change) => {
        switch (change.type) {
          case 'select': {
            const node = rungLocal.nodes.find((n) => n.id === change.id) as FlowNode
            if (change.selected) {
              selectedNodes.push(node)
              setRungLocal((rung) => ({
                ...rung,
                selectedNodes: selectedNodes,
              }))
              return
            }

            selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
            setRungLocal((rung) => ({
              ...rung,
              selectedNodes: selectedNodes,
            }))
            return
          }
          case 'remove': {
            selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
            setRungLocal((rung) => ({
              ...rung,
              selectedNodes: selectedNodes,
            }))
            return
          }
        }
      })
      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
      }))
    },
    [rungLocal, rung],
  )

  const onEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: applyEdgeChanges(changes, rung.edges),
      }))
    },
    [rungLocal],
  )

  /**
   * When the node drag stops, update the fbd rung state
   */
  const onNodeDragStop = useCallback(() => {
    fbdFlowActions.setRung({
      rung: rungLocal,
      editorName: editor.meta.name,
    })
  }, [rungLocal])

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      event.preventDefault()
      // Check if the dragged element is not a ladder block
      if (!event.dataTransfer.types.includes('application/reactflow/fbd-blocks')) {
        return
      }
    },
    [reactFlowViewportRef],
  )

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useCallback<DragEventHandler>(
    (event) => {
      // Check if the dragged element is a child of the flow viewport
      const { relatedTarget } = event
      if (
        !reactFlowViewportRef.current ||
        !relatedTarget ||
        reactFlowViewportRef.current.contains(relatedTarget as Node)
      ) {
        return
      }
    },
    [reactFlowViewportRef],
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
    },
    [reactFlowInstance],
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
        event.dataTransfer.getData('application/reactflow/fbd-blocks') === ''
          ? undefined
          : event.dataTransfer.getData('application/reactflow/fbd-blocks')
      if (!blockType || !Object.keys(customNodeTypes).includes(blockType)) {
        return
      }

      // Check if there is a library in the dragged data
      const library =
        event.dataTransfer.getData('application/library') === ''
          ? undefined
          : event.dataTransfer.getData('application/library')

      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) ?? {
        x: 0,
        y: 0,
      }

      handleAddElementByDropping(position, blockType as CustomFbdNodeTypes, library)
    },
    [rung, reactFlowInstance],
  )

  /**
   * Handle the double click of a node
   */
  const handleNodeDoubleClick = (node: FlowNode) => {
    const modalToOpen = node.type === 'block' && 'block-fbd-element'
    if (!modalToOpen) return

    openModal(modalToOpen, node)
  }

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    closeModal()
  }

  return (
    <div className='h-full w-full rounded-lg border p-1 dark:border-neutral-800' ref={reactFlowViewportRef}>
      <ReactFlowPanel
        key={'fbd-react-flow'}
        background={true}
        controls={true}
        controlsConfig={{
          showInteractive: false,
        }}
        viewportConfig={{
          onInit: setReactFlowInstance,

          nodeTypes,
          nodes: rungLocal.nodes,
          edges: rungLocal.edges,

          defaultEdgeOptions: {
            type: 'smoothstep',
          },

          onDelete: ({ nodes, edges }) => {
            handleOnDelete(nodes, edges)
          },
          onConnect: (connection) => {
            handleOnConnect(connection)
          },
          onNodeDoubleClick: (_event, node) => {
            handleNodeDoubleClick(node)
          },

          onDragEnter: onDragEnterViewport,
          onDragLeave: onDragLeaveViewport,
          onDragOver: onDragOver,
          onDrop: onDrop,

          onNodesChange: onNodesChange,
          onEdgesChange: onEdgesChange,
          onNodeDragStop: onNodeDragStop,

          preventScrolling: !isElementBeingHovered,

          snapGrid: [16, 16],
          snapToGrid: true,

          proOptions: {
            hideAttribution: true,
          },
        }}
      />
      {modals['block-fbd-element']?.open && (
        <BlockElement
          onClose={handleModalClose}
          selectedNode={modals['block-fbd-element'].data as BlockNode<object>}
          isOpen={modals['block-fbd-element'].open}
        />
      )}
    </div>
  )
}
