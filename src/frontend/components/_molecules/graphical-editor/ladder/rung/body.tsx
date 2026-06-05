import type { CoordinateExtent, Node as FlowNode, OnNodesChange, ReactFlowInstance } from '@xyflow/react'
import { applyNodeChanges, getNodesBounds } from '@xyflow/react'
import { differenceWith, isEqual, parseInt } from 'lodash'
import { DragEventHandler, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { useDebugCompositeKey } from '../../../../../hooks/use-debug-composite-key'
import { useDebugBoolValuesMap, useIsDebuggerVisible } from '../../../../../hooks/use-debug-value'
import { usePouSnapshot } from '../../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../../store'
import type { RungLadderState } from '../../../../../store/slices/ladder'
import { cn } from '../../../../../utils/cn'
import { getLadderBlockType, isLadderBlockDrag } from '../../../../../utils/graphical/drag-detection'
import { getFunctionBlockVariablesToCleanup } from '../../../../../utils/graphical/get-function-block-variables-to-cleanup'
import { syncNodesWithVariables } from '../../../../../utils/graphical/sync-nodes-with-variables'
import { customNodeTypes } from '../../../../_atoms/graphical-editor/ladder'
import type { BasicNodeData } from '../../../../_atoms/graphical-editor/ladder/utils/types'
import { getVariableRestrictionType } from '../../../../_atoms/graphical-editor/utils'
import { ReactFlowPanel } from '../../../../_atoms/react-flow'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { addNewElement, removeElements } from './ladder-utils/elements'
import { onElementDragOver, onElementDragStart, onElementDrop } from './ladder-utils/elements/drag-n-drop'
import {
  removePlaceholderElements,
  renderPlaceholderElements,
  searchNearestPlaceholder,
} from './ladder-utils/elements/placeholder'
import { findNode } from './ladder-utils/nodes'

/**
 * Check recursively if the related target or any of its parent elements are within the ladder area
 * Optimized version with early returns and efficient DOM traversal
 */
const isDragEventFromWithinLadderArea = (
  relatedTarget: EventTarget | null,
  ladderViewportRef: HTMLDivElement | null,
): boolean => {
  // Early return for null checks
  if (!relatedTarget || !ladderViewportRef) return false

  // Cast to Element for better type safety and DOM methods access
  let currentElement = relatedTarget as Element

  // Use Element type check to ensure we have DOM methods available
  if (!currentElement || typeof currentElement.closest !== 'function') return false

  // Use the native closest() method for optimal performance
  // This is much faster than manual DOM traversal

  const isInside = ladderViewportRef.contains(currentElement)
  if (isInside) return true

  // Fallback to manual traversal if contains() fails for any reason
  while (currentElement && currentElement !== document.documentElement) {
    if (currentElement === ladderViewportRef) return true
    currentElement = currentElement.parentElement as Element

    if (!currentElement) break
  }
  return false
}

type RungBodyProps = {
  rung: RungLadderState
  className?: string
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
}

const EDGE_COLOR_TRUE = '#00FF00'

export const RungBody = ({ rung, className, nodeDivergences = [], isDebuggerActive = false }: RungBodyProps) => {
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const {
    ladderFlowActions,
    ladderFlows,
    libraries,
    editorActions: { updateModelVariables },
    project,
    projectActions: { deleteVariable },
    modalActions: { openModal },
    searchQuery,
    searchActions: { setSearchNodePosition },
  } = useOpenPLCStore()
  const isDebuggerVisible = useIsDebuggerVisible()
  const debugVariableValues = useDebugBoolValuesMap()

  const { captureAndPush } = usePouSnapshot()
  const { pous } = project.data
  const pouRef = pous.find((pou) => pou.name === pouName)
  const getCompositeKey = useDebugCompositeKey()
  const nodeTypes = useMemo(() => customNodeTypes, [])

  const [rungLocal, setRungLocal] = useState<RungLadderState>(rung)
  const [dragging, setDragging] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

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
      editorName: pouName,
      rungId: rungLocal.id,
      reactFlowViewport: [bounds.width, bounds.height + 20],
    })
  }

  // --- Debug edge coloring and node lockdown ---

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

      const compositeKey = getCompositeKey(variableName)
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

      if (pouRef?.pouType !== 'function-block') {
        const instances = project.data.configurations.resource.instances
        const programInstance = instances.find((inst) => inst.program === pouName)
        if (!programInstance) return undefined
      }

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const outputVariableName = `${blockVariableName}.${sourceHandle}`
        const compositeKey = getCompositeKey(outputVariableName)
        const value = debugVariableValues.get(compositeKey)

        if (value === undefined) return undefined

        const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
        return isTrue
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = blockData.numericId
        if (!numericId) return undefined

        const tempVarName = `_TMP_${blockName}${numericId}_${sourceHandle.toUpperCase()}`
        const compositeKey = getCompositeKey(tempVarName)
        const value = debugVariableValues.get(compositeKey)

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
      if (edgeStateMap.has(edgeId)) {
        return edgeStateMap.get(edgeId)!
      }

      const edge = rungLocal.edges.find((e) => e.id === edgeId)
      if (!edge) return false

      const incomingEdges = rungLocal.edges.filter((e) => e.target === edge.source)

      let isInputGreen = false
      if (incomingEdges.length === 0) {
        const sourceNode = rungLocal.nodes.find((n) => n.id === edge.source)
        isInputGreen = sourceNode?.type === 'powerRail' && (sourceNode.data as { variant: string }).variant === 'left'
      } else {
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
  }, [rungLocal.edges, rungLocal.nodes, isDebuggerVisible, debugVariableValues, pouName, project, getCompositeKey])

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
    pouName,
    project,
    getCompositeKey,
  ])

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
      editorName: pouName,
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
   * Cleanup effect: Reset dragging state when drag ends anywhere (even outside rung)
   * Fixes Safari issue where dropping outside the rung leaves app in broken state
   */
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      if (dragging) {
        // Reset dragging state
        setDragging(false)
        // Shrink rung back to normal size
        setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])
        // Remove placeholders
        const nodes = removePlaceholderElements(rungLocal.nodes)
        setRungLocal((rung) => ({ ...rung, nodes }))
      }
    }

    // Listen for drag end events at document level
    document.addEventListener('dragend', handleGlobalDragEnd)
    document.addEventListener('drop', handleGlobalDragEnd)

    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd)
      document.removeEventListener('drop', handleGlobalDragEnd)
    }
  }, [dragging, rungLocal, setReactFlowPanelExtent])

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
        const pou = pous.find((pou) => pou.name === library?.name)
        if (!pou) return
        const variables = (pou.interface?.variables ?? []).map((variable) => ({
          id: variable.id,
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        }))
        if (pou.pouType === 'function') {
          const variable = getVariableRestrictionType(pou.interface?.returnType ?? '')
          variables.push({
            id: 'OUT',
            name: 'OUT',
            class: 'output',
            type: {
              definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
              value: (pou.interface?.returnType ?? '').toUpperCase(),
            },
          })
        }

        pouLibrary = {
          name: pou.name,
          type: pou.pouType,
          variables: variables,
          documentation: pou.documentation,
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

    const { nodes, edges, newNode, handleBranches } = addNewElement(rungLocal, {
      elementType: newNodeType,
      blockVariant: pouLibrary,
    })

    captureAndPush(pouName)

    ladderFlowActions.setNodes({ editorName: pouName, rungId: rungLocal.id, nodes })
    ladderFlowActions.setEdges({ editorName: pouName, rungId: rungLocal.id, edges })
    if (handleBranches) {
      ladderFlowActions.setHandleBranches({ editorName: pouName, rungId: rungLocal.id, handleBranches })
    }

    if (newNode)
      ladderFlowActions.setSelectedNodes({
        editorName: pouName,
        rungId: rungLocal.id,
        nodes: [newNode],
      })

    if (pouRef) {
      syncNodesWithVariables(pouRef.interface?.variables ?? [], ladderFlows, ladderFlowActions.updateNode, pouName)
    }
  }

  /**
   * Remove some nodes from the rung
   */
  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { nodes: newNodes, edges: newEdges, handleBranches } = removeElements({ ...rungLocal }, nodes)

    captureAndPush(pouName)

    ladderFlowActions.setNodes({ editorName: pouName, rungId: rungLocal.id, nodes: newNodes })
    ladderFlowActions.setEdges({ editorName: pouName, rungId: rungLocal.id, edges: newEdges })
    if (handleBranches) {
      ladderFlowActions.setHandleBranches({ editorName: pouName, rungId: rungLocal.id, handleBranches })
    }
    ladderFlowActions.setSelectedNodes({
      editorName: pouName,
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
     *    -- src/components/_molecules/rung/body.tsx
     *    -- src/components/_molecules/menu-bar/modals/delete-confirmation-modal.tsx
     *    -- src/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx
     *    -- src/components/_molecules/graphical-editor/fbd/index.tsx
     */
    const blockNodes = nodes.filter((node) => node.type === 'block')
    if (blockNodes.length > 0) {
      let variables: PLCVariable[] = []
      if (pouRef) variables = [...(pouRef.interface?.variables ?? [])] as PLCVariable[]

      const currentFlow = ladderFlows.find((f) => f.name === pouName)
      const allRungs = currentFlow?.rungs ?? []
      const variablesToCleanup = getFunctionBlockVariablesToCleanup(blockNodes, allRungs, variables)

      variablesToCleanup.forEach((variableName) => {
        deleteVariable({
          variableName,
          scope: 'local',
          associatedPou: pouName,
        })
      })

      blockNodes.forEach((blockNode) => {
        const variableData = (blockNode.data as BasicNodeData)?.variable
        const variableIndex = variables.findIndex((variable) => variable.id === variableData?.id)

        if (variableIndex !== -1) {
          deleteVariable({
            variableId: (blockNode.data as BasicNodeData).variable.id,
            scope: 'local',
            associatedPou: pouName,
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

    if (pouRef) {
      syncNodesWithVariables(pouRef.interface?.variables ?? [], ladderFlows, ladderFlowActions.updateNode, pouName)
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

    captureAndPush(pouName)

    setDragging(false)
    ladderFlowActions.setNodes({ editorName: pouName, rungId: rungLocal.id, nodes: result.nodes })
    ladderFlowActions.setEdges({ editorName: pouName, rungId: rungLocal.id, edges: result.edges })
    if (result.handleBranches) {
      ladderFlowActions.setHandleBranches({
        editorName: pouName,
        rungId: rungLocal.id,
        handleBranches: result.handleBranches,
      })
    }

    if (pouRef) {
      syncNodesWithVariables(pouRef.interface?.variables ?? [], ladderFlows, ladderFlowActions.updateNode, pouName)
    }
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
      // Check recursively if the drag event is coming from within the ladder area
      if (isDragEventFromWithinLadderArea(event.relatedTarget, reactFlowViewportRef.current)) {
        return
      }

      // Only expand rung once when drag first enters (not on every placeholder hover)
      const isFirstDragEnter = !dragging
      if (isFirstDragEnter) {
        setDragging(true)
        setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] + 50]])
      }

      event.preventDefault()
      // Check if the dragged element is not a ladder block (cross-browser compatible)
      if (!isLadderBlockDrag(event.dataTransfer)) {
        return
      }

      // Only render placeholders once on first enter (avoid re-rendering on every hover)
      if (isFirstDragEnter) {
        const copyRungLocal = { ...rungLocal }
        const nodes = renderPlaceholderElements(copyRungLocal)
        setRungLocal((rung) => ({ ...rung, nodes }))
      }
    },
    [rung, rungLocal, setReactFlowPanelExtent, reactFlowPanelExtent, dragging, isDebuggerActive],
  )

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useCallback<DragEventHandler>(
    (event) => {
      if (isDebuggerActive) return
      // Check if the dragged element is a child of the flow viewport
      if (isDragEventFromWithinLadderArea(event.relatedTarget, reactFlowViewportRef.current)) {
        return
      }

      // Safari/WebKit quirk: When placeholders appear under cursor, Safari fires dragLeave
      // with relatedTarget as null. We need to distinguish between:
      // 1. Spurious dragLeave (hovering over placeholders) - cursor still inside rung
      // 2. Real dragLeave (actually leaving) - cursor outside rung
      if (!event.relatedTarget && dragging && reactFlowViewportRef.current) {
        const rect = reactFlowViewportRef.current.getBoundingClientRect()
        const isInsideBounds =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom

        // If cursor is still inside rung bounds, it's a spurious event - keep placeholders
        if (isInsideBounds) {
          return
        }
        // If cursor is outside bounds, it's a real leave - cleanup immediately
      }

      setDragging(false)
      setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])

      // If it is, remove the placeholder elements`
      const nodes = removePlaceholderElements(rungLocal.nodes)
      setRungLocal((rung) => ({ ...rung, nodes }))
    },
    [rung, rungLocal, setReactFlowPanelExtent, reactFlowPanelExtent, dragging, isDebuggerActive],
  )

  /**
   * Handle the drag over of the viewport
   * This function is called when a dragged element is over the viewport
   */
  const onDragOver = useCallback<DragEventHandler>(
    (event) => {
      if (isDebuggerActive) return
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
    [rung, rungLocal, isDebuggerActive],
  )

  /**
   * Handle the drop of the viewport
   * This function is called when a dragged element is dropped in the viewport
   */
  const onDrop = useCallback<DragEventHandler>(
    (event) => {
      if (isDebuggerActive) return
      setDragging(false)
      setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])

      event.preventDefault()
      // Check if there is a ladder block in the dragged data (cross-browser compatible)
      const blockType = getLadderBlockType(event.dataTransfer)
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
    // `libraries.system`, `libraries.user`, and `pous` aren't read
    // directly here — `handleAddNode` closes over all three.  Omitting
    // any of them means the memoized callback keeps a reference to the
    // pre-update handler, so a freshly installed system library /
    // freshly created user FB / freshly saved POU stays invisible
    // until something else forces a re-bind (matches the FBD onDrop
    // dep set; same failure mode: catalog-installed libs threw
    // "block type ... does not exist" on first drop).
    [
      rung,
      rungLocal,
      setReactFlowPanelExtent,
      reactFlowPanelExtent,
      isDebuggerActive,
      libraries.system,
      libraries.user,
      pous,
    ],
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
              elementsSelectable: true,
              nodesDraggable: !isDebuggerActive,
              nodesConnectable: !isDebuggerActive,
              defaultEdgeOptions: {
                deletable: false,
                selectable: false,
                type: 'smoothstep',
              },

              onInit: setReactFlowInstance,

              onNodesChange: onNodesChange,
              onNodeClick: isDebuggerActive ? () => {} : undefined,
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
