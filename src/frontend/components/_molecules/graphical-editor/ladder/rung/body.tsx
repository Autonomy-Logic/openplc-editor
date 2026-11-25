import type {
  CoordinateExtent,
  DefaultEdgeOptions,
  Node as FlowNode,
  NodeChange,
  OnNodesChange,
  ReactFlowInstance,
} from '@xyflow/react'
import { applyNodeChanges } from '@xyflow/react'
import { parseInt } from 'lodash'
import {
  DragEvent,
  MouseEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import {
  displayShift,
  LADDER_STYLE,
  layoutRungOrStored,
  pouLabelSource,
  presentPou,
  rungPresentation,
  toCanonicalPosition,
  toDisplayNodes,
} from '../../../../../../middleware/shared/utils/ladder-layout'
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
import {
  isLadderPlacementElement,
  ladderPlacementNode,
  PLACEMENT_TARGET_ATTRIBUTE,
} from '../../../../../utils/graphical/placement-elements'
import { syncNodesWithVariables } from '../../../../../utils/graphical/sync-nodes-with-variables'
import { customNodeTypes } from '../../../../_atoms/graphical-editor/ladder'
import { ladderEdgeTypes, ladderRouteEdgeData } from '../../../../_atoms/graphical-editor/ladder/route-edge'
import {
  ladderDisplayNode,
  LadderRungViewProvider,
  useLadderThemePalette,
} from '../../../../_atoms/graphical-editor/ladder/rung-view'
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
  withTransientShifts,
} from './ladder-utils/elements/placeholder'
import { findNode, getRungNodesBounds } from './ladder-utils/nodes'
import { useLadderLabelSource, useLadderPouCanvas } from './pou-canvas'
import { computeRungDebugStates, poweredBlockIds, type RungDebugStates } from './rung-debug-states'
import { RungMenu, type RungMenuItem } from './rung-menu'
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

/** The modifiers a contact or coil offers in its right-click menu, in menu order. */
const ELEMENT_MODIFIERS: Record<'contact' | 'coil', readonly { variant: string; label: string }[]> = {
  contact: [
    { variant: 'default', label: 'Normally open' },
    { variant: 'negated', label: 'Negated' },
    { variant: 'risingEdge', label: 'Rising edge' },
    { variant: 'fallingEdge', label: 'Falling edge' },
  ],
  coil: [
    { variant: 'default', label: 'Normal' },
    { variant: 'negated', label: 'Negated' },
    { variant: 'set', label: 'Set' },
    { variant: 'reset', label: 'Reset' },
    { variant: 'risingEdge', label: 'Rising edge' },
    { variant: 'fallingEdge', label: 'Falling edge' },
  ],
}

/** Stroke width of an LD wire, and of one drawn in the energized colour. */
const WIRE_STROKE = { normal: 1.25, on: 2 } as const

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  deletable: false,
  selectable: false,
  type: 'ladderWire',
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
  const [elementMenu, setElementMenu] = useState<{ at: { x: number; y: number }; nodeId: string } | null>(null)
  const swallowUntilRef = useRef(0)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  const [reactFlowPanelExtent, setReactFlowPanelExtent] = useState<CoordinateExtent>([
    [0, 0],
    (rung?.reactFlowViewport as [number, number]) ?? [1530, 200],
  ])

  const canvas = useLadderPouCanvas()
  const labelSource = useLadderLabelSource(pouName, canvas?.labelSource)
  const layout = useMemo(
    () => canvas?.layouts.get(rung) ?? layoutRungOrStored(rung, labelSource),
    [canvas?.layouts, rung, labelSource],
  )
  const presentation = useMemo(
    () => rungPresentation(canvas?.presentation ?? presentPou([layout], 0), layout),
    [canvas?.presentation, layout],
  )
  const shifts = useMemo(() => withTransientShifts(presentation, rungLocal.nodes), [presentation, rungLocal.nodes])
  const displayNodes = useMemo(() => toDisplayNodes(rungLocal.nodes, shifts), [rungLocal.nodes, shifts])
  const palette = useLadderThemePalette()
  const rungView = useMemo(() => ({ layout, labelSource, palette }), [layout, labelSource, palette])

  const updateReactFlowPanelExtent = (rung: RungLadderState) => {
    const bounds = getRungNodesBounds(rung.nodes)
    const width = Math.max(bounds.width, layout.size.width)
    const height = Math.max(bounds.height, layout.size.height)

    setReactFlowPanelExtent((prev) =>
      prev[1][0] === width && prev[1][1] === height
        ? prev
        : [
            [0, 0],
            [width, height],
          ],
    )
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

  const poweredBlocks = useMemo(
    () =>
      stableDebugStates ? poweredBlockIds(rungLocal.nodes, rungLocal.edges, stableDebugStates.edgeStates) : undefined,
    [rungLocal.nodes, rungLocal.edges, stableDebugStates],
  )

  const styledEdges = useMemo(() => {
    const nodeById = new Map(rungLocal.nodes.map((node) => [node.id, node]))

    return rungLocal.edges.map((edge) => {
      const energized = stableDebugStates?.edgeStates.get(edge.id) === true
      const style = {
        stroke: energized ? palette.on : palette.wire,
        strokeWidth: energized ? WIRE_STROKE.on : WIRE_STROKE.normal,
      }
      const route = ladderRouteEdgeData(layout, edge, nodeById, (id) => displayShift(shifts, id))
      return route === undefined ? { ...edge, style } : { ...edge, type: 'ladderRoute', style, data: route }
    })
  }, [rungLocal.nodes, rungLocal.edges, stableDebugStates, layout, palette, shifts])

  const styledNodes = useMemo(() => {
    const baseNodes = displayNodes.map(ladderDisplayNode)

    if (isDebuggerActive) {
      return baseNodes.map((node) => ({
        ...node,
        draggable: false,
        selectable: false,
        deletable: false,
      }))
    }

    return baseNodes
  }, [displayNodes, isDebuggerActive])

  const canvasWidth = Math.max(reactFlowPanelExtent[1][0], presentation.widthPx)
  const translateExtent = useMemo<CoordinateExtent>(
    () => [
      [0, 0],
      [canvasWidth, reactFlowPanelExtent[1][1]],
    ],
    [canvasWidth, reactFlowPanelExtent],
  )

  /** `nodes` at the positions they are drawn at, the space the pointer is read in. */
  const displayed = (nodes: FlowNode[]): FlowNode[] => toDisplayNodes(nodes, withTransientShifts(presentation, nodes))

  /** A node xyflow reports, moved back to its canonical position. */
  const toCanonicalNode = <T extends FlowNode>(node: T): T => {
    const position = toCanonicalPosition(node.id, node.position, shifts)
    return position.x === node.position.x ? node : { ...node, position }
  }

  /** A node change xyflow reports, its position or node moved back to canonical coordinates. */
  const toCanonicalChange = (change: NodeChange<FlowNode>): NodeChange<FlowNode> => {
    switch (change.type) {
      case 'position':
        return change.position === undefined
          ? change
          : { ...change, position: toCanonicalPosition(change.id, change.position, shifts) }
      case 'add':
      case 'replace':
        return { ...change, item: toCanonicalNode(change.item) }
      case 'dimensions':
      case 'select':
      case 'remove':
        return change
      default: {
        const unreachable: never = change
        return unreachable
      }
    }
  }

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
    updateReactFlowPanelExtent(rung)
  }, [layout])

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
        x: (nodePosition.x + displayShift(shifts, foundNode.id)) * zoom + ('x' in pan ? pan.x : 0),
        y: nodePosition.y * zoom + ('y' in pan ? pan.y : 0),
      }

      setSearchNodePosition(adjustedSearchNodePosition)
    } else {
      setSearchNodePosition({ x: 0, y: 0 })
    }
  }, [searchQuery, rungLocal, reactFlowInstance, shifts])

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
    variant?: string,
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

    const added = addNewElement(
      sourceRung,
      { elementType: newNodeType, blockVariant: pouLibrary },
      pouLabelSource(store.getState().project.data, pouName),
    )
    const { edges, newNode, handleBranches } = added
    const nodes =
      variant === undefined || newNode === undefined
        ? added.nodes
        : added.nodes.map((node) => (node.id === newNode.id ? { ...node, data: { ...node.data, variant } } : node))

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
    const {
      nodes: newNodes,
      edges: newEdges,
      handleBranches,
    } = removeElements({ ...rungLocal }, nodes, pouLabelSource(store.getState().project.data, pouName))

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
      const allRungs = (currentFlow?.rungs ?? []).map((flowRung) =>
        flowRung.id === rungLocal.id ? { ...flowRung, nodes: newNodes } : flowRung,
      )
      const variablesToCleanup = getFunctionBlockVariablesToCleanup(nodes, allRungs, variables)

      variablesToCleanup.forEach((variableName) => {
        const variableIndex = variables.findIndex(
          (variable) => variable.name.toLowerCase() === variableName.toLowerCase(),
        )

        deleteVariable({
          variableName,
          scope: 'local',
          associatedPou: pouName,
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
    const closestPlaceholder = onElementDragOver({ ...rungLocal, nodes: displayNodes }, reactFlowInstance, {
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
  }

  const handleNodeDragStop = (node: FlowNode) => {
    const { ladderFlows } = store.getState()
    const result = onElementDrop(rungLocal, rung, node, pouLabelSource(store.getState().project.data, pouName))

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
    handleRemoveNode(nodes.map(toCanonicalNode))
  })
  const onNodeDragStart = useStableCallback((_event: globalThis.MouseEvent | globalThis.TouchEvent, node: FlowNode) => {
    handleNodeStartDrag(toCanonicalNode(node))
  })
  const onNodeDrag = useStableCallback((event: globalThis.MouseEvent | globalThis.TouchEvent) => {
    handleNodeDrag(event)
  })
  const onNodeDragStop = useStableCallback((_event: globalThis.MouseEvent | globalThis.TouchEvent, node: FlowNode) => {
    handleNodeDragStop(toCanonicalNode(node))
  })
  const onNodeDoubleClick = useStableCallback((_event: MouseEvent, node: FlowNode) => {
    handleNodeDoubleClick(toCanonicalNode(node))
  })

  const onNodesChange: OnNodesChange<FlowNode> = useStableCallback((displayChanges) => {
    const changes = displayChanges.map(toCanonicalChange)
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

    const closestPlaceholder = searchNearestPlaceholder({ ...rungLocal, nodes: displayNodes }, reactFlowInstance, {
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
    return findPlaceholderWithinRadius(
      displayed(nodes),
      reactFlowInstance.screenToFlowPosition({ x: clientX, y: clientY }),
    )
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

  /** A right click on a contact or coil opens its modifier menu; other nodes keep the rung's own right click. */
  const handleNodeContextMenu = (event: ReactMouseEvent, node: FlowNode) => {
    if (node.type !== 'contact' && node.type !== 'coil') return
    event.preventDefault()
    event.stopPropagation()
    setElementMenu({ at: { x: event.clientX, y: event.clientY }, nodeId: node.id })
  }

  /** The modifier menu of the contact or coil `elementMenu` names: each modifier, the current one checked. */
  const elementMenuItems = (): RungMenuItem[] => {
    const node = rung.nodes.find((candidate) => candidate.id === elementMenu?.nodeId)
    if (node === undefined || (node.type !== 'contact' && node.type !== 'coil')) return []
    const current = typeof node.data.variant === 'string' ? node.data.variant : 'default'
    return ELEMENT_MODIFIERS[node.type].map(({ variant, label }) => ({
      label,
      shortcut: variant === current ? '✓' : '',
      onSelect: () => {
        if (variant === current) return
        captureAndPush(pouName)
        ladderFlowActions.updateNode({
          editorName: pouName,
          rungId: rung.id,
          nodeId: node.id,
          node: { ...node, data: { ...node.data, variant } },
        })
      },
    }))
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
    const { type, variant } = ladderPlacementNode(element)
    handleAddNode(type, undefined, { ...rungLocal, nodes: selectOnlyPlaceholder(nodes, target.id) }, variant)
  }

  const swallowAfterPlacement = (event: SyntheticEvent) => {
    if (performance.now() > swallowUntilRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'click') swallowUntilRef.current = 0
  }

  return (
    <div className={cn('relative h-fit w-full py-1', className)}>
      <div
        aria-label='Rung body'
        className={cn('h-full w-full', armedElement && 'cursor-crosshair')}
        style={{ paddingLeft: LADDER_STYLE.gutter }}
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
            width: canvasWidth,
          }}
        >
          <LadderRungViewProvider view={rungView} poweredBlockIds={poweredBlocks}>
            <ReactFlowPanel
              viewportConfig={{
                nodeTypes: nodeTypes,
                edgeTypes: ladderEdgeTypes,
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
                onNodeContextMenu: isDebuggerActive ? undefined : handleNodeContextMenu,

                onDragEnter: onDragEnterViewport,
                onDragLeave: onDragLeaveViewport,
                onDragOver: onDragOver,
                onDrop: onDrop,

                translateExtent,
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
          </LadderRungViewProvider>
        </div>
      </div>
      {elementMenu && <RungMenu at={elementMenu.at} items={elementMenuItems()} onClose={() => setElementMenu(null)} />}
    </div>
  )
}
