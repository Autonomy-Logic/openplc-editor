import type {
  CoordinateExtent,
  DefaultEdgeOptions,
  Node as FlowNode,
  OnNodesChange,
  ReactFlowInstance,
} from '@xyflow/react'
import { applyNodeChanges } from '@xyflow/react'
import { differenceWith, isEqual, parseInt } from 'lodash'
import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { mapsEqual, useContentStable } from '../../../../../hooks/use-content-stable'
import { useDebugCompositeKey } from '../../../../../hooks/use-debug-composite-key'
import { useDebugBoolValuesMap, useIsDebuggerVisible } from '../../../../../hooks/use-debug-value'
import { usePouSnapshot } from '../../../../../hooks/use-pou-snapshot'
import { useStableCallback } from '../../../../../hooks/use-stable-callback'
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
import { findNode, getRungNodesBounds } from './ladder-utils/nodes'

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

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  deletable: false,
  selectable: false,
  type: 'smoothstep',
}
const PRO_OPTIONS = { hideAttribution: true }
const NOOP = () => {}

// --- Debug edge coloring ---

type LadderDebugContext = {
  isFunctionBlockPou: boolean
  hasProgramInstance: boolean
  getCompositeKey: (variableName: string) => string
  boolValues: Map<string, string>
}

type RungDebugStates = {
  edgeStates: Map<string, boolean>
  nodeInputStates: Map<string, boolean>
}

const computeRungDebugStates = (
  nodes: RungLadderState['nodes'],
  edges: RungLadderState['edges'],
  ctx: LadderDebugContext,
): RungDebugStates => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const edgesByTarget = new Map<string, RungLadderState['edges']>()
  for (const edge of edges) {
    const list = edgesByTarget.get(edge.target)
    if (list) list.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }

  const getNodeOutputState = (
    nodeId: string,
    sourceHandle: string | null | undefined,
    isInputGreen: boolean,
  ): boolean | undefined => {
    const node = nodeById.get(nodeId)
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

      const compositeKey = ctx.getCompositeKey(variableName)
      const value = ctx.boolValues.get(compositeKey)
      if (value === undefined) return undefined

      const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
      const contactState = contactData.variant === 'negated' ? !isTrue : isTrue

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

      if (!ctx.isFunctionBlockPou && !ctx.hasProgramInstance) return undefined

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const compositeKey = ctx.getCompositeKey(`${blockVariableName}.${sourceHandle}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = blockData.numericId
        if (!numericId) return undefined

        const compositeKey = ctx.getCompositeKey(`_TMP_${blockName}${numericId}_${sourceHandle.toUpperCase()}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      }

      return undefined
    }

    return undefined
  }

  const edgeStates = new Map<string, boolean>()

  const determineEdgeState = (edgeId: string): boolean => {
    if (edgeStates.has(edgeId)) {
      return edgeStates.get(edgeId)!
    }

    const edge = edgeById.get(edgeId)
    if (!edge) return false

    const incomingEdges = edgesByTarget.get(edge.source) ?? []

    let isInputGreen = false
    if (incomingEdges.length === 0) {
      const sourceNode = nodeById.get(edge.source)
      isInputGreen = sourceNode?.type === 'powerRail' && (sourceNode.data as { variant: string }).variant === 'left'
    } else {
      isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id))
    }

    const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle, isInputGreen)

    const isGreen = sourceOutputState === true
    edgeStates.set(edgeId, isGreen)
    return isGreen
  }

  edges.forEach((edge) => {
    determineEdgeState(edge.id)
  })

  const nodeInputStates = new Map<string, boolean>()

  const determineNodeInputState = (nodeId: string): boolean => {
    if (nodeInputStates.has(nodeId)) {
      return nodeInputStates.get(nodeId)!
    }

    const node = nodeById.get(nodeId)
    if (!node) return false

    if (node.type === 'powerRail' && (node.data as { variant: string }).variant === 'left') {
      nodeInputStates.set(nodeId, true)
      return true
    }

    const incomingEdges = edgesByTarget.get(nodeId) ?? []

    if (incomingEdges.length === 0) {
      nodeInputStates.set(nodeId, false)
      return false
    }

    const hasGreenInput = incomingEdges.some((incomingEdge) => {
      const sourceInputGreen = determineNodeInputState(incomingEdge.source)
      const sourceOutputGreen = getNodeOutputState(incomingEdge.source, incomingEdge.sourceHandle, sourceInputGreen)
      return sourceOutputGreen === true
    })

    nodeInputStates.set(nodeId, hasGreenInput)
    return hasGreenInput
  }

  nodes.forEach((node) => {
    determineNodeInputState(node.id)
  })

  return { edgeStates, nodeInputStates }
}

const rungDebugStatesEqual = (previous: RungDebugStates | null, next: RungDebugStates | null): boolean =>
  previous !== null &&
  next !== null &&
  mapsEqual(previous.edgeStates, next.edgeStates) &&
  mapsEqual(previous.nodeInputStates, next.nodeInputStates)

export const RungBody = ({ rung, className, nodeDivergences = [], isDebuggerActive = false }: RungBodyProps) => {
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const ladderFlowActions = useOpenPLCStore((state) => state.ladderFlowActions)
  const updateModelVariables = useOpenPLCStore((state) => state.editorActions.updateModelVariables)
  const deleteVariable = useOpenPLCStore((state) => state.projectActions.deleteVariable)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const searchQuery = useOpenPLCStore((state) => state.searchQuery)
  const setSearchNodePosition = useOpenPLCStore((state) => state.searchActions.setSearchNodePosition)
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const hasProgramInstance = useOpenPLCStore((state) =>
    state.project.data.configurations.resource.instances.some((instance) => instance.program === pouName),
  )
  const isDebuggerVisible = useIsDebuggerVisible()
  const debugVariableValues = useDebugBoolValuesMap()

  const { captureAndPush } = usePouSnapshot()
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
   * For getRungNodesBounds to work, the nodes must have width and height properties set in the node data
   * This useEffect will run every time the nodes array changes (i.e. when a node is added or removed)
   */
  const updateReactFlowPanelExtent = (rung: RungLadderState) => {
    const bounds = getRungNodesBounds(rung.nodes)
    const [defaultWidth, defaultHeight] = rung.defaultBounds

    // If the bounds are less than the default extent, set the panel extent to the default extent
    if (bounds.width < defaultWidth) bounds.width = defaultWidth
    if (bounds.height < defaultHeight) bounds.height = defaultHeight

    setReactFlowPanelExtent((prev) =>
      prev[1][0] === bounds.width && prev[1][1] === bounds.height + 20
        ? prev
        : [
            [0, 0],
            [bounds.width, bounds.height + 20],
          ],
    )
    ladderFlowActions.updateReactFlowViewport({
      editorName: pouName,
      rungId: rungLocal.id,
      reactFlowViewport: [bounds.width, bounds.height + 20],
    })
  }

  // --- Debug edge coloring and node lockdown ---

  const debugStates = useMemo(
    () =>
      isDebuggerVisible
        ? computeRungDebugStates(rungLocal.nodes, rungLocal.edges, {
            isFunctionBlockPou: pouRef?.pouType === 'function-block',
            hasProgramInstance,
            getCompositeKey,
            boolValues: debugVariableValues,
          })
        : null,
    [
      isDebuggerVisible,
      rungLocal.nodes,
      rungLocal.edges,
      pouRef?.pouType,
      hasProgramInstance,
      getCompositeKey,
      debugVariableValues,
    ],
  )

  // Identity-stable across polls that didn't change this rung's states, so
  // the styled arrays below keep their identity and the rung skips re-render.
  const stableDebugStates = useContentStable(debugStates, rungDebugStatesEqual)

  const styledEdges = useMemo(() => {
    if (!stableDebugStates) {
      return rungLocal.edges
    }

    const { edgeStates } = stableDebugStates
    return rungLocal.edges.map((edge) => {
      if (edgeStates.get(edge.id) === true) {
        return {
          ...edge,
          style: { stroke: EDGE_COLOR_TRUE, strokeWidth: 2 },
        }
      }

      return edge
    })
  }, [rungLocal.edges, stableDebugStates])

  const styledNodes = useMemo(() => {
    const baseNodes = !stableDebugStates
      ? rungLocal.nodes
      : rungLocal.nodes.map((node) => {
          if (node.type === 'parallel') {
            const isFlowActive = stableDebugStates.nodeInputStates.get(node.id) || false
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

    if (isDebuggerActive) {
      return baseNodes.map((node) => ({
        ...node,
        draggable: false,
        selectable: false,
        deletable: false,
      }))
    }

    return baseNodes
  }, [rungLocal.nodes, stableDebugStates, isDebuggerActive])

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
    const { libraries, ladderFlows } = useOpenPLCStore.getState()
    let pouLibrary = undefined
    if (blockType) {
      const [blockLibraryType, blockLibrary, pouName] = blockType.split('/')

      if (blockLibraryType === 'system') {
        const libraryPou = libraries.system
          .find((Library) => Library.name === blockLibrary)
          ?.pous.find((p) => p.name === pouName)
        // Copy the signature, not the library entry. That entry also carries
        // `body` (the authored source, which for a native C/C++ or Python block
        // is the entire file) and `language`, and passing the object straight
        // through froze a copy of the library's source into every project that
        // placed the block. Nothing ever reads either field back off a placed
        // variant, and the embedded VAR ... END_VAR broke the POU parser badly
        // enough that the project would not open (DOPE-592). The user-library
        // branch below has always built a curated object this way.
        pouLibrary = libraryPou
          ? {
              name: libraryPou.name,
              type: libraryPou.type,
              variables: libraryPou.variables,
              documentation: libraryPou.documentation,
              extensible: libraryPou.extensible ?? false,
            }
          : undefined
      }

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
      syncNodesWithVariables(
        pouRef.interface?.variables ?? [],
        ladderFlows,
        ladderFlowActions.updateNodes,
        pouName,
        rungLocal.id,
      )
    }
  }

  /**
   * Remove some nodes from the rung
   */
  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { ladderFlows } = useOpenPLCStore.getState()
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

    // Flow-scoped (no rungId): removing a block can delete its backing
    // variable, which may strand bindings in this POU's other rungs.
    if (pouRef) {
      syncNodesWithVariables(pouRef.interface?.variables ?? [], ladderFlows, ladderFlowActions.updateNodes, pouName)
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
  const handleNodeDrag = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
    if (!reactFlowInstance || !('clientX' in event)) return
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
    const { ladderFlows } = useOpenPLCStore.getState()
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
      syncNodesWithVariables(
        pouRef.interface?.variables ?? [],
        ladderFlows,
        ladderFlowActions.updateNodes,
        pouName,
        rungLocal.id,
      )
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

  const onNodesDelete = useStableCallback((nodes: FlowNode[]) => {
    handleRemoveNode(nodes)
  })
  const onNodeDragStart = useStableCallback((_event: globalThis.MouseEvent | globalThis.TouchEvent, node: FlowNode) => {
    handleNodeStartDrag(node)
  })
  const onNodeDrag = useStableCallback((event: globalThis.MouseEvent | globalThis.TouchEvent) => {
    handleNodeDrag(event)
  })
  const onNodeDragStop = useStableCallback((_event: globalThis.MouseEvent | globalThis.TouchEvent, node: FlowNode) => {
    handleNodeDragStop(node)
  })
  const onNodeDoubleClick = useStableCallback((_event: MouseEvent, node: FlowNode) => {
    handleNodeDoubleClick(node)
  })

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useStableCallback((changes) => {
    setRungLocal((rung) => {
      let selectedNodes: FlowNode[] = rung.nodes.filter((node) => node.selected)
      changes.forEach((change) => {
        switch (change.type) {
          case 'select': {
            const node = rung.nodes.find((n) => n.id === change.id) as FlowNode
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

      return {
        ...rung,
        nodes: applyNodeChanges(changes, rung.nodes),
        selectedNodes: selectedNodes,
      }
    })
  })

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useStableCallback((event: DragEvent) => {
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
  })

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useStableCallback((event: DragEvent) => {
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
  })

  /**
   * Handle the drag over of the viewport
   * This function is called when a dragged element is over the viewport
   */
  const onDragOver = useStableCallback((event: DragEvent) => {
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
  })

  /**
   * Handle the drop of the viewport
   * This function is called when a dragged element is dropped in the viewport
   */
  const onDrop = useStableCallback((event: DragEvent) => {
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
  })

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
              defaultEdgeOptions: DEFAULT_EDGE_OPTIONS,

              onInit: setReactFlowInstance,

              onNodesChange: onNodesChange,
              onNodeClick: isDebuggerActive ? NOOP : undefined,
              onNodesDelete: isDebuggerActive ? undefined : onNodesDelete,
              onNodeDragStart: isDebuggerActive ? undefined : onNodeDragStart,
              onNodeDrag: isDebuggerActive ? undefined : onNodeDrag,
              onNodeDragStop: isDebuggerActive ? undefined : onNodeDragStop,
              onNodeDoubleClick: isDebuggerActive ? undefined : onNodeDoubleClick,

              onDragEnter: onDragEnterViewport,
              onDragLeave: onDragLeaveViewport,
              onDragOver: onDragOver,
              onDrop: onDrop,

              // No nodeExtent here: node positions belong to the ladder layout engine. xyflow ≥12.9
              // stopped recomputing drag-clamped positionAbsolute when the extent later grows, so a
              // mid-drag clamp against the stale extent would freeze nodes at wrong positions (DOPE-492).
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

              proOptions: PRO_OPTIONS,
            }}
          />
        </div>
      </div>
    </div>
  )
}
