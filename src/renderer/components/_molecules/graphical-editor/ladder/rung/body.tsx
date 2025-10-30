import { getVariableRestrictionType } from '@root/renderer/components/_atoms/graphical-editor/utils'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RungLadderState } from '@root/renderer/store/slices'
import { getFunctionBlockVariablesToCleanup } from '@root/renderer/store/slices/ladder/utils'
import { cn } from '@root/utils'
import type { CoordinateExtent, Node as FlowNode, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { applyNodeChanges, getNodesBounds } from '@xyflow/react'
import { differenceWith, isEqual, parseInt } from 'lodash'
import { DragEventHandler, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { customNodeTypes } from '../../../../_atoms/graphical-editor/ladder'
import type { BasicNodeData } from '../../../../_atoms/graphical-editor/ladder/utils/types'
import { ReactFlowPanel } from '../../../../_atoms/react-flow'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { addNewElement, removeElements } from './ladder-utils/elements'
import { onElementDragOver, onElementDragStart, onElementDrop } from './ladder-utils/elements/drag-n-drop'
import {
  removePlaceholderElements,
  renderPlaceholderElements,
  searchNearestPlaceholder,
} from './ladder-utils/elements/placeholder'
import { findNode } from './ladder-utils/nodes'

const EDGE_COLOR_TRUE = '#00FF00'

type RungBodyProps = {
  rung: RungLadderState
  className?: string
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
}

export const RungBody = ({ rung, className, nodeDivergences = [], isDebuggerActive = false }: RungBodyProps) => {
  const {
    ladderFlowActions,
    ladderFlows,
    libraries,
    editor,
    editorActions: { updateModelVariables },
    project,
    projectActions: { deleteVariable },
    modalActions: { openModal },
    searchQuery,
    searchActions: { setSearchNodePosition },
    snapshotActions: { addSnapshot },
    workspace: { isDebuggerVisible, debugVariableValues },
  } = useOpenPLCStore()

  const pouRef = project.data.pous.find((pou) => pou.data.name === editor.meta.name)
  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<RungLadderState>(rung)
  const [dragging, setDragging] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  const getNodeOutputState = (
    nodeId: string,
    sourceHandle: string | null | undefined,
    isInputGreen: boolean,
  ): boolean | undefined => {
    if (!isDebuggerVisible) return undefined

    const node = rungLocal.nodes.find((n) => n.id === nodeId)
    if (!node) return undefined

    if (node.type === 'powerRail') {
      return (node.data as { variant: 'left' | 'right' }).variant === 'left'
    }

    if (node.type === 'parallel') {
      return isInputGreen
    }

    if (node.type === 'contact') {
      const contactData = node.data as { variable?: { name: string }; variant: 'open' | 'negated' }
      const variableName = contactData.variable?.name
      if (!variableName) return undefined

      const compositeKey = `${editor.meta.name}:${variableName}`
      const value = debugVariableValues.get(compositeKey)
      if (value === undefined) return undefined

      const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
      const contactState = (node.data as { variant: 'open' | 'negated' }).variant === 'negated' ? !isTrue : isTrue

      return isInputGreen && contactState
    }

    if (node.type === 'coil') {
      return isInputGreen
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string }
        numericId?: string
      }
      if (!sourceHandle) return undefined

      const instances = project.data.configuration.resource.instances
      const programInstance = instances.find((inst) => inst.program === editor.meta.name)
      if (!programInstance) return undefined

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const outputVariableName = `${blockVariableName}.${sourceHandle}`
        const compositeKey = `${editor.meta.name}:${outputVariableName}`
        const value = debugVariableValues.get(compositeKey)

        console.log(`[Rung Coloring FB] ${compositeKey}, value=${value}`)

        if (value === undefined) return undefined

        const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
        return isTrue
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = blockData.numericId
        if (!numericId) return undefined

        const tempVarName = `_TMP_${blockName}${numericId}_${sourceHandle.toUpperCase()}`
        const compositeKey = `${editor.meta.name}:${tempVarName}`
        const value = debugVariableValues.get(compositeKey)

        console.log(`[Rung Coloring Function] ${compositeKey}, value=${value}`)

        if (value === undefined) return undefined

        const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
        return isTrue
      }

      return undefined
    }

    return undefined
  }

  const styledEdges = useMemo(() => {
    if (!isDebuggerVisible) {
      return rungLocal.edges
    }

    const edgeStateMap = new Map<string, boolean>()

    const determineEdgeState = (edgeId: string): boolean => {
      // Check if we've already computed this edge's state
      if (edgeStateMap.has(edgeId)) {
        return edgeStateMap.get(edgeId)!
      }

      const edge = rungLocal.edges.find((e) => e.id === edgeId)
      if (!edge) return false

      const incomingEdges = rungLocal.edges.filter((e) => e.target === edge.source)

      let isInputGreen = false
      if (incomingEdges.length === 0) {
        // Check if the source is the left power rail
        const sourceNode = rungLocal.nodes.find((n) => n.id === edge.source)
        isInputGreen = sourceNode?.type === 'powerRail' && (sourceNode.data as { variant: string }).variant === 'left'
      } else {
        // Check if any incoming edge is green
        isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id))
      }

      const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle, isInputGreen)

      const isGreen = sourceOutputState === true
      edgeStateMap.set(edgeId, isGreen)
      return isGreen
    }

    rungLocal.edges.forEach((edge) => {
      determineEdgeState(edge.id)
    })

    return rungLocal.edges.map((edge) => {
      const isGreen = edgeStateMap.get(edge.id)

      if (isGreen === true) {
        return {
          ...edge,
          style: { stroke: EDGE_COLOR_TRUE, strokeWidth: 2 },
        }
      }

      return edge
    })
  }, [rungLocal.edges, rungLocal.nodes, isDebuggerVisible, debugVariableValues, editor.meta.name, project])

  const styledNodes = useMemo(() => {
    const baseNodes = !isDebuggerVisible
      ? rungLocal.nodes
      : (() => {
          const nodeInputStateMap = new Map<string, boolean>()

          const determineNodeInputState = (nodeId: string): boolean => {
            if (nodeInputStateMap.has(nodeId)) {
              return nodeInputStateMap.get(nodeId)!
            }

            const node = rungLocal.nodes.find((n) => n.id === nodeId)
            if (!node) return false

            if (node.type === 'powerRail' && (node.data as { variant: string }).variant === 'left') {
              nodeInputStateMap.set(nodeId, true)
              return true
            }

            const incomingEdges = rungLocal.edges.filter((e) => e.target === nodeId)

            if (incomingEdges.length === 0) {
              nodeInputStateMap.set(nodeId, false)
              return false
            }

            const hasGreenInput = incomingEdges.some((incomingEdge) => {
              const sourceInputGreen = determineNodeInputState(incomingEdge.source)
              const sourceOutputGreen = getNodeOutputState(
                incomingEdge.source,
                incomingEdge.sourceHandle,
                sourceInputGreen,
              )
              return sourceOutputGreen === true
            })

            nodeInputStateMap.set(nodeId, hasGreenInput)
            return hasGreenInput
          }

          rungLocal.nodes.forEach((node) => {
            determineNodeInputState(node.id)
          })

          return rungLocal.nodes.map((node) => {
            if (node.type === 'parallel') {
              const isFlowActive = nodeInputStateMap.get(node.id) || false
              return {
                ...node,
                data: {
                  ...node.data,
                  isFlowActive,
                },
              }
            }
            return node
          })
        })()

    if (isDebuggerActive) {
      return baseNodes.map((node) => ({
        ...node,
        draggable: false,
        selectable: false,
        deletable: false,
      }))
    }

    return baseNodes
  }, [
    rungLocal.edges,
    rungLocal.nodes,
    isDebuggerVisible,
    isDebuggerActive,
    debugVariableValues,
    editor.meta.name,
    project,
  ])

  /**
   * -- Which means, by default, the flow panel extent is:
   * minX: 0    | minY: 0
   * maxX: 1530 | maxY: 200
   */
  const [reactFlowPanelExtent, setReactFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    (rung?.reactFlowViewport as [number, number]) ?? [1530, 200],
  ])

  /**
   * Update flow panel extent based on the bounds of the nodes
   * To make the getNodesBounds function work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  const updateReactFlowPanelExtent = (rung: RungLadderState) => {
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

    setReactFlowPanelExtent([
      [0, 0],
      [bounds.width, bounds.height + 20],
    ])
    ladderFlowActions.updateReactFlowViewport({
      editorName: editor.meta.name,
      rungId: rungLocal.id,
      reactFlowViewport: [bounds.width, bounds.height + 20],
    })
  }

  /**
   *  Update the local rung state when the rung state changes
   */
  useEffect(() => {
    setRungLocal({
      ...rung,
      nodes: rung.nodes.map((node) => ({
        ...node,
        data: { ...node.data, hasDivergence: nodeDivergences.includes(`${rung.id}:${node.id}`) },
      })),
    })
    updateReactFlowPanelExtent(rung)
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
    ladderFlowActions.setSelectedNodes({
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

      reactFlowViewportRef.current?.scrollTo({
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
        const pou = project.data.pous.find((pou) => pou.data.name === library?.name)
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

    const { nodes, edges, newNode } = addNewElement(rungLocal, {
      elementType: newNodeType,
      blockVariant: pouLibrary,
    })

    addSnapshot(editor.meta.name)

    ladderFlowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes })
    ladderFlowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges })

    if (newNode)
      ladderFlowActions.setSelectedNodes({
        editorName: editor.meta.name,
        rungId: rungLocal.id,
        nodes: [newNode],
      })
  }

  /**
   * Remove some nodes from the rung
   */
  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { nodes: newNodes, edges: newEdges } = removeElements({ ...rungLocal }, nodes)

    addSnapshot(editor.meta.name)

    ladderFlowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes: newNodes })
    ladderFlowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges: newEdges })
    ladderFlowActions.setSelectedNodes({
      editorName: editor.meta.name,
      rungId: rungLocal.id,
      nodes: [],
    })

    if (pouRef && nodes.length > 0) {
      const allVariables = pouRef.data.variables
      const flow = ladderFlows.find((f) => f.name === editor.meta.name)
      const allRungs = flow?.rungs ?? []

      const variablesToDelete = getFunctionBlockVariablesToCleanup(nodes, allRungs, allVariables)

      variablesToDelete.forEach((variableName) => {
        const variableIndex = allVariables.findIndex((v) => v.name.toLowerCase() === variableName.toLowerCase())

        if (variableIndex !== -1) {
          deleteVariable({
            variableName,
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

    addSnapshot(editor.meta.name)

    setDragging(false)
    ladderFlowActions.setNodes({ editorName: editor.meta.name, rungId: rungLocal.id, nodes: result.nodes })
    ladderFlowActions.setEdges({ editorName: editor.meta.name, rungId: rungLocal.id, edges: result.edges })
  }

  /**
   * Handle the single click of a node during debugging
   */
  const handleNodeClick = (_event: React.MouseEvent, _node: FlowNode) => {
    if (!isDebuggerActive) return
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
        }
      })

      setRungLocal((rung) => ({
        ...rung,
        nodes: applyNodeChanges(changes, rungLocal.nodes),
        selectedNodes: selectedNodes,
      }))
    },
    [rungLocal, rung, dragging],
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      if (isDebuggerActive) return

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
    [rung, rungLocal, isDebuggerActive],
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
      if (isDebuggerActive) return

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
    [rung, rungLocal, isDebuggerActive],
  )

  return (
    <div
      className={cn(
        'relative h-fit w-full p-1',
        // 'rounded-b-lg border border-t-0 dark:border-neutral-800',
        className,
      )}
    >
      <div aria-label='Rung body' className='h-full w-full overflow-x-auto' ref={reactFlowViewportRef}>
        <div
          style={{
            height: reactFlowPanelExtent[1][1] + 8,
            width: reactFlowPanelExtent[1][0],
          }}
        >
          <ReactFlowPanel
            viewportConfig={{
              nodeTypes: nodeTypes,
              nodes: styledNodes,
              edges: styledEdges,
              nodesFocusable: false,
              edgesFocusable: false,
              nodesDraggable: !isDebuggerActive,
              nodesConnectable: !isDebuggerActive,
              elementsSelectable: true,
              defaultEdgeOptions: {
                deletable: false,
                selectable: false,
                type: 'smoothstep',
              },

              onInit: setReactFlowInstance,

              onNodesChange: onNodesChange,
              onNodeClick: isDebuggerActive ? handleNodeClick : undefined,
              onNodesDelete: isDebuggerActive
                ? undefined
                : (nodes) => {
                    handleRemoveNode(nodes)
                  },
              onNodeDragStart: isDebuggerActive
                ? undefined
                : (_event, node) => {
                    handleNodeStartDrag(node)
                  },
              onNodeDrag: isDebuggerActive
                ? undefined
                : (event) => {
                    handleNodeDrag(event)
                  },
              onNodeDragStop: isDebuggerActive
                ? undefined
                : (_event, node) => {
                    handleNodeDragStop(node)
                  },
              onNodeDoubleClick: isDebuggerActive
                ? undefined
                : (_event, node) => {
                    handleNodeDoubleClick(node)
                  },

              onDragEnter: onDragEnterViewport,
              onDragLeave: onDragLeaveViewport,
              onDragOver: onDragOver,
              onDrop: onDrop,

              nodeExtent: reactFlowPanelExtent,
              translateExtent: reactFlowPanelExtent,
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
    </div>
  )
}
