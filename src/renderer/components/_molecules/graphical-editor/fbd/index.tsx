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
  OnNodeDrag,
  OnNodesChange,
  ReactFlowInstance,
  SelectionMode,
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
  const [dragging, setDragging] = useState(false)
  const [shouldDebounceToRung, setShouldDebounceToRung] = useState(false)

  const nodeTypes = useMemo(() => customNodeTypes, [])
  const canZoom = useMemo(() => {
    if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
      return editor.graphical.canEditorZoom
    }
    return false
  }, [editor])
  const canPan = useMemo(() => {
    if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
      return editor.graphical.canEditorPan
    }
    return false
  }, [editor])

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  /**
   *  * FYI: This implementation came from https://www.developerway.com/posts/debouncing-in-react
   */
  const updateRungLocalFromStore = () => {
    const newRung = rung
    setRungLocal(newRung)
  }
  const debounceUpdateRungLocalFromStore = useRef(updateRungLocalFromStore)
  useEffect(() => {
    debounceUpdateRungLocalFromStore.current = updateRungLocalFromStore
  }, [rung])
  const _debouncedUpdateRungLocalFromStoreCallback = useMemo(() => {
    const func = () => {
      debounceUpdateRungLocalFromStore.current?.()
    }
    return _.debounce(func, 100)
  }, [])

  const updateRungState = () => {
    setShouldDebounceToRung(false)

    if (dragging || _.isEqual(rungLocal, rung)) {
      return
    }

    fbdFlowActions.setRung({
      editorName: editor.meta.name,
      rung: rungLocal,
    })
  }
  // creating ref and initializing it with the sendRequest function
  const debounceUpdateRungRef = useRef(updateRungState)
  useEffect(() => {
    // updating ref when state changes
    // now, ref.current will have the latest sendRequest with access to the latest state
    debounceUpdateRungRef.current = updateRungState
  }, [dragging, rungLocal, rung])
  // creating debounced callback only once - on mount
  const debouncedUpdateRungStateCallback = useMemo(() => {
    // func will be created only once - on mount
    const func = () => {
      // ref is mutable! ref.current is a reference to the latest sendRequest
      debounceUpdateRungRef.current?.()
    }
    // debounce the func that was created once, but has access to the latest sendRequest
    return _.debounce(func, 100)
    // no dependencies! never gets updated
  }, [])

  useEffect(() => {
    updateRungLocalFromStore()
  }, [rung])

  useEffect(() => {
    if (shouldDebounceToRung) debouncedUpdateRungStateCallback()
  }, [rungLocal, shouldDebounceToRung])

  /**
   * Handle the addition of a new element by dropping it in the viewport
   */
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

  /**
   * Handle the deletion of nodes and edges
   * This function is called when the user presses the delete key
   * It is used to remove the selected nodes and edges from the flow
   */
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

  /**
   * Handle the connection of two nodes
   * This function is called when the user connects two nodes
   * It is used to update the local rung state
   */
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
      const newRung = { ...rungLocal }

      let selectedNodes: FlowNode[] = rungLocal.nodes.filter((node) => node.selected)
      changes.forEach((change) => {
        switch (change.type) {
          case 'select': {
            const node = rungLocal.nodes.find((n) => n.id === change.id) as FlowNode
            if (change.selected) {
              selectedNodes.push(node)
              return
            }
            selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
            return
          }

          case 'add': {
            selectedNodes = []
            return
          }

          case 'remove': {
            selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
            return
          }

          case 'dimensions': {
            if (change.resizing)
              newRung.nodes = newRung.nodes.map((n) => {
                if (n.id === change.id) {
                  return {
                    ...n,
                    width: change.dimensions?.width,
                    height: change.dimensions?.height,
                    measured: {
                      width: change.dimensions?.width,
                      height: change.dimensions?.height,
                    },
                  }
                }
                return n
              })
            return
          }
        }
      })

      newRung.nodes = applyNodeChanges(changes, newRung.nodes)
      newRung.selectedNodes = selectedNodes

      const changedDimensions = changes.some((change) => change.type === 'dimensions')
      // Dimension changes need to be debounced to avoid multiple updates
      if (changedDimensions) {
        setShouldDebounceToRung(true)
      }

      setRungLocal(newRung)
    },
    [rungLocal, dragging],
  )

  const onEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: applyEdgeChanges(changes, rung.edges),
      }))
    },
    [rungLocal, rung, dragging],
  )

  const onNodeDragStart = useCallback(() => {
    setDragging(true)
  }, [rungLocal, dragging])

  /**
   * When the node drag stops, update the fbd rung state
   */
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, _node, nodes) => {
      setDragging(false)
      fbdFlowActions.setRung({
        editorName: editor.meta.name,
        rung: {
          ...rungLocal,
          nodes: rungLocal.nodes.map((node) => nodes.find((n) => n.id === node.id) ?? node),
          edges: rungLocal.edges,
        },
      })
    },
    [rungLocal, dragging],
  )

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
          selectionMode: SelectionMode.Partial,

          onNodeDragStart: onNodeDragStart,
          onNodeDragStop: onNodeDragStop,

          preventScrolling: canZoom,
          panOnDrag: canPan,

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
