import { CustomNodeTypes, customNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { ReactFlowPanel } from '@root/renderer/components/_atoms/react-flow'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDRungState } from '@root/renderer/store/slices'
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
    libraries,
    project: {
      data: { pous },
    },
    fbdFlowActions,
  } = useOpenPLCStore()

  const [rungLocal, setRungLocal] = useState<FBDRungState>(rung)

  const nodeTypes = useMemo(() => customNodeTypes, [])
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRungLocal(rung)
    console.log(rung)
  }, [rung])

  const handleAddElementByDropping = (
    position: XYPosition,
    newNodeType: CustomNodeTypes,
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
      const selectedNodes: FlowNode[] = rungLocal.nodes.filter((node) => node.selected)
      changes.forEach((change) => {
        if (change.type === 'select') {
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
    [rungLocal],
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

      handleAddElementByDropping(position, blockType as CustomNodeTypes, library)
    },
    [rung, reactFlowInstance],
  )

  return (
    <div className='h-full w-full rounded-lg border p-1 dark:border-neutral-800' ref={reactFlowViewportRef}>
      <ReactFlowPanel
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

          onDragEnter: onDragEnterViewport,
          onDragLeave: onDragLeaveViewport,
          onDragOver: onDragOver,
          onDrop: onDrop,

          onNodesChange: onNodesChange,
          onEdgesChange: onEdgesChange,
          onNodeDragStop: onNodeDragStop,
        }}
      />
    </div>
  )
}
