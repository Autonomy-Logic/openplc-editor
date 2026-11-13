import type {
  CoordinateExtent,
  DefaultEdgeOptions,
  Node as FlowNode,
  OnNodesChange,
  ReactFlowInstance,
} from '@xyflow/react'
import { applyNodeChanges } from '@xyflow/react'
import { parseInt } from 'lodash'
import {
  DragEvent,
  MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { mapsEqual, useContentStable } from '../../../../../hooks/use-content-stable'
import { useDebugCompositeKey } from '../../../../../hooks/use-debug-composite-key'
import { useDebugBoolValuesMap, useIsDebuggerVisible } from '../../../../../hooks/use-debug-value'
import { usePouSnapshot } from '../../../../../hooks/use-pou-snapshot'
import { useStableCallback } from '../../../../../hooks/use-stable-callback'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../../store'
import type { RungLadderState } from '../../../../../store/slices/ladder'
import type { GraphicalElementModalData } from '../../../../../store/slices/modal'
import { cn } from '../../../../../utils/cn'
import { getLadderBlockType, isLadderBlockDrag } from '../../../../../utils/graphical/drag-detection'
import { getFunctionBlockVariablesToCleanup } from '../../../../../utils/graphical/get-function-block-variables-to-cleanup'
import {
  findPlaceholderWithinRadius,
  selectOnlyPlaceholder,
} from '../../../../../utils/graphical/ladder-placeholder-snap'
import { isLadderPlacementElement, PLACEMENT_TARGET_ATTRIBUTE } from '../../../../../utils/graphical/placement-elements'
import { syncNodesWithVariables } from '../../../../../utils/graphical/sync-nodes-with-variables'
import { customNodeTypes } from '../../../../_atoms/graphical-editor/ladder'
import type { BasicNodeData } from '../../../../_atoms/graphical-editor/ladder/utils/types'
import { getVariableRestrictionType } from '../../../../_atoms/graphical-editor/utils'
import { ReactFlowPanel } from '../../../../_atoms/react-flow'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { useGraphicalPlacement } from '../../../../_features/[workspace]/editor/graphical/placement/placement-context'
import { addNewElement, removeElements } from './ladder-utils/elements'
import { onElementDragOver, onElementDragStart, onElementDrop } from './ladder-utils/elements/drag-n-drop'
import {
  removePlaceholderElements,
  renderPlaceholderElements,
  searchNearestPlaceholder,
} from './ladder-utils/elements/placeholder'
import { findNode, getRungNodesBounds } from './ladder-utils/nodes'
import { computeRungDebugStates, type RungDebugStates } from './rung-debug-states'
import { isSameSelection } from './selection'

/** Whether the related target or one of its ancestors is inside the ladder viewport. */
const isDragEventFromWithinLadderArea = (
  relatedTarget: EventTarget | null,
  ladderViewportRef: HTMLDivElement | null,
): boolean => {
  if (!relatedTarget || !ladderViewportRef) return false

  let currentElement = relatedTarget as Element

  if (!currentElement || typeof currentElement.closest !== 'function') return false

  const isInside = ladderViewportRef.contains(currentElement)
  if (isInside) return true

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
const PLACEMENT_EXTENT_PADDING = 50
const PLACEMENT_SWALLOW_MS = 500

const rungDebugStatesEqual = (previous: RungDebugStates | null, next: RungDebugStates | null): boolean =>
  previous !== null &&
  next !== null &&
  mapsEqual(previous.edgeStates, next.edgeStates) &&
  mapsEqual(previous.nodeInputStates, next.nodeInputStates)

export const RungBody = ({ rung, className, nodeDivergences = [], isDebuggerActive = false }: RungBodyProps) => {
  const store = useOpenPLCStoreApi()
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

  const placement = useGraphicalPlacement()
  const armedElement = placement?.language === 'ld' && !isDebuggerActive ? placement.armed : null
  const [placementHover, setPlacementHover] = useState(false)
  const swallowUntilRef = useRef(0)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  const [reactFlowPanelExtent, setReactFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    (rung?.reactFlowViewport as [number, number]) ?? [1530, 200],
  ])

  const updateReactFlowPanelExtent = (rung: RungLadderState) => {
    const bounds = getRungNodesBounds(rung.nodes)
    const [defaultWidth, defaultHeight] = rung.defaultBounds

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

  useEffect(() => {
    if (dragging || isSameSelection(rungLocal.selectedNodes, rung.selectedNodes)) return

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

  useEffect(() => {
    const handleGlobalDragEnd = () => {
      if (dragging) {
        setDragging(false)
        setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])
        const nodes = removePlaceholderElements(rungLocal.nodes)
        setRungLocal((rung) => ({ ...rung, nodes }))
      }
    }

    document.addEventListener('dragend', handleGlobalDragEnd)
    document.addEventListener('drop', handleGlobalDragEnd)

    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd)
      document.removeEventListener('drop', handleGlobalDragEnd)
    }
  }, [dragging, rungLocal, setReactFlowPanelExtent])

  const handleAddNode = (
    newNodeType: string = 'mockNode',
    blockType: string | undefined,
    sourceRung: RungLadderState = rungLocal,
  ) => {
    const { libraries, ladderFlows } = store.getState()
    let pouLibrary = undefined
    if (blockType) {
      const [blockLibraryType, blockLibrary, pouName] = blockType.split('/')

      if (blockLibraryType === 'system') {
        const libraryPou = libraries.system
          .find((Library) => Library.name === blockLibrary)
          ?.pous.find((p) => p.name === pouName)
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

    const { nodes, edges, newNode, handleBranches } = addNewElement(sourceRung, {
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

  const handleRemoveNode = (nodes: FlowNode[]) => {
    const { ladderFlows } = store.getState()
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
      syncNodesWithVariables(pouRef.interface?.variables ?? [], ladderFlows, ladderFlowActions.updateNodes, pouName)
    }
  }

  const handleNodeStartDrag = (node: FlowNode) => {
    const result = onElementDragStart(rungLocal, node)
    setDragging(true)
    setRungLocal((rung) => ({ ...rung, nodes: result.nodes, edges: result.edges }))
  }

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

  const handleNodeDragStop = (node: FlowNode) => {
    const { ladderFlows } = store.getState()
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

    openModal(modalToOpen, { pouName, node } satisfies GraphicalElementModalData)
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

  const onDragEnterViewport = useStableCallback((event: DragEvent) => {
    if (isDebuggerActive) return
    if (isDragEventFromWithinLadderArea(event.relatedTarget, reactFlowViewportRef.current)) {
      return
    }

    const isFirstDragEnter = !dragging
    if (isFirstDragEnter) {
      setDragging(true)
      setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] + 50]])
    }

    event.preventDefault()
    if (!isLadderBlockDrag(event.dataTransfer)) {
      return
    }

    if (isFirstDragEnter) {
      const copyRungLocal = { ...rungLocal }
      const nodes = renderPlaceholderElements(copyRungLocal)
      setRungLocal((rung) => ({ ...rung, nodes }))
    }
  })

  const onDragLeaveViewport = useStableCallback((event: DragEvent) => {
    if (isDebuggerActive) return
    if (isDragEventFromWithinLadderArea(event.relatedTarget, reactFlowViewportRef.current)) {
      return
    }

    if (!event.relatedTarget && dragging && reactFlowViewportRef.current) {
      const rect = reactFlowViewportRef.current.getBoundingClientRect()
      const isInsideBounds =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      if (isInsideBounds) {
        return
      }
    }

    setDragging(false)
    setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])

    const nodes = removePlaceholderElements(rungLocal.nodes)
    setRungLocal((rung) => ({ ...rung, nodes }))
  })

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

  const onDrop = useStableCallback((event: DragEvent) => {
    if (isDebuggerActive) return
    setDragging(false)
    setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - 50]])

    event.preventDefault()
    const blockType = getLadderBlockType(event.dataTransfer)
    if (!blockType) {
      setRungLocal(rung)
      return
    }

    const library =
      event.dataTransfer.getData('application/library') === ''
        ? undefined
        : event.dataTransfer.getData('application/library')

    handleAddNode(blockType, library)
  })

  const endPlacementHover = useStableCallback(() => {
    if (!placementHover) return
    setPlacementHover(false)
    setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] - PLACEMENT_EXTENT_PADDING]])
    setRungLocal((current) => ({ ...current, nodes: removePlaceholderElements(current.nodes) }))
  })

  useEffect(() => {
    if (!armedElement) endPlacementHover()
  }, [armedElement, endPlacementHover])

  const findPlacementPlaceholder = (nodes: FlowNode[], clientX: number, clientY: number) => {
    if (!reactFlowInstance) return undefined
    return findPlaceholderWithinRadius(nodes, reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY }))
  }

  const handlePlacementPointerMove = (event: ReactPointerEvent) => {
    if (!armedElement || dragging) return
    const { clientX, clientY } = event
    if (!placementHover) {
      setPlacementHover(true)
      setReactFlowPanelExtent((extent) => [extent[0], [extent[1][0], extent[1][1] + PLACEMENT_EXTENT_PADDING]])
    }
    setRungLocal((current) => {
      const hasPlaceholders = current.nodes.some(
        (node) => node.type === 'placeholder' || node.type === 'parallelPlaceholder',
      )
      const nodes = hasPlaceholders ? current.nodes : renderPlaceholderElements(current)
      const target = findPlacementPlaceholder(nodes, clientX, clientY)
      const selected = selectOnlyPlaceholder(nodes, target?.id)
      return selected === current.nodes ? current : { ...current, nodes: selected }
    })
  }

  const handlePlacementPointerDown = (event: ReactPointerEvent) => {
    if (!armedElement || !placement || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    swallowUntilRef.current = performance.now() + PLACEMENT_SWALLOW_MS

    const nodes = placementHover ? rungLocal.nodes : renderPlaceholderElements(rungLocal)
    const target = findPlacementPlaceholder(nodes, event.clientX, event.clientY)
    if (!target) {
      placement.cancel()
      return
    }

    const element = placement.consume()
    if (!element || !isLadderPlacementElement(element)) return
    endPlacementHover()
    handleAddNode(element, undefined, { ...rungLocal, nodes: selectOnlyPlaceholder(nodes, target.id) })
  }

  const swallowAfterPlacement = (event: SyntheticEvent) => {
    if (performance.now() > swallowUntilRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'click') swallowUntilRef.current = 0
  }

  return (
    <div className={cn('relative h-fit w-full p-1', className)}>
      <div
        aria-label='Rung body'
        className={cn('h-full w-full overflow-x-auto', armedElement && 'cursor-crosshair')}
        ref={reactFlowViewportRef}
        {...{ [PLACEMENT_TARGET_ATTRIBUTE]: 'ld-rung' }}
        onPointerMove={armedElement ? handlePlacementPointerMove : undefined}
        onPointerLeave={armedElement ? endPlacementHover : undefined}
        onPointerDownCapture={armedElement ? handlePlacementPointerDown : undefined}
        onMouseDownCapture={swallowAfterPlacement}
        onClickCapture={swallowAfterPlacement}
      >
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
