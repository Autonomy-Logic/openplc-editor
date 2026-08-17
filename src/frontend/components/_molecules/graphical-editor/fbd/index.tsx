import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  DefaultEdgeOptions,
  Edge as FlowEdge,
  Node as FlowNode,
  OnEdgesChange,
  OnNodesChange,
  ReactFlowInstance,
  SelectionMode,
  SnapGrid,
  XYPosition,
} from '@xyflow/react'
import { debounce, isEqual } from 'lodash'
import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { mapsEqual, useContentStable } from '../../../../hooks/use-content-stable'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import {
  useDebugBoolValuesMap,
  useDebugForcedVariablesMap,
  useIsDebuggerVisible,
} from '../../../../hooks/use-debug-value'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { useStableCallback } from '../../../../hooks/use-stable-callback'
import { useOpenPLCStore } from '../../../../store'
import type { FBDRungState } from '../../../../store/slices/fbd'
import { getFbdBlockType, isFbdBlockDrag } from '../../../../utils/graphical/drag-detection'
import { getFunctionBlockVariablesToCleanup } from '../../../../utils/graphical/get-function-block-variables-to-cleanup'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import { CustomFbdNodeTypes, customNodeTypes } from '../../../_atoms/graphical-editor/fbd'
import { BlockNode } from '../../../_atoms/graphical-editor/fbd/utils/types'
import { findOccupiedInOutPin } from '../../../../utils/graphical/in-out-pin-rules'
import { getVariableRestrictionType } from '../../../_atoms/graphical-editor/utils'
import { ReactFlowPanel } from '../../../_atoms/react-flow'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import BlockElement from '../../../_features/[workspace]/editor/graphical/elements/fbd/block'
import { buildGenericNode } from './fbd-utils/nodes'
import { useFBDClipboard } from './fbd-utils/useCopyPaste'

interface FBDProps {
  rung: FBDRungState
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
}

const EDGE_COLOR_TRUE = '#00FF00'

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'smoothstep',
}
const SNAP_GRID: SnapGrid = [16, 16]
const PRO_OPTIONS = { hideAttribution: true }
const CONTROLS_CONFIG = { showInteractive: false }

// --- Debug edge coloring ---

type FBDDebugContext = {
  isFunctionBlockPou: boolean
  hasProgramInstance: boolean
  getCompositeKey: (variableName: string) => string
  boolValues: Map<string, string>
  forcedValues: Map<string, boolean>
  pouVariables: PLCVariable[] | undefined
}

const computeFBDEdgeStates = (
  nodes: FBDRungState['nodes'],
  edges: FBDRungState['edges'],
  ctx: FBDDebugContext,
): Map<string, boolean> => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const edgesByTarget = new Map<string, FBDRungState['edges']>()
  for (const edge of edges) {
    const list = edgesByTarget.get(edge.target)
    if (list) list.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }
  const variablesByName = new Map<string, PLCVariable>()
  for (const variable of ctx.pouVariables ?? []) {
    const key = variable.name.toLowerCase()
    if (!variablesByName.has(key)) variablesByName.set(key, variable)
  }

  const getNodeOutputState = (nodeId: string, sourceHandle: string | null | undefined): boolean | undefined => {
    const node = nodeById.get(nodeId)
    if (!node) return undefined

    if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
      const variableData = node.data as { variable?: { name: string } }
      const variableName = variableData.variable?.name
      if (!variableName) return undefined

      const variable = variablesByName.get(variableName.toLowerCase())
      if (!variable || variable.type.value.toUpperCase() !== 'BOOL') return undefined

      const compositeKey = ctx.getCompositeKey(variableName)

      if (ctx.forcedValues.has(compositeKey)) {
        return ctx.forcedValues.get(compositeKey)
      }

      const value = ctx.boolValues.get(compositeKey)
      if (value === undefined) return undefined

      return value === '1' || value.toUpperCase() === 'TRUE'
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string; variables: Array<{ name: string; type: { value: string } }> }
      }
      if (!sourceHandle) return undefined

      if (!ctx.isFunctionBlockPou && !ctx.hasProgramInstance) return undefined

      const outputVariable = blockData.variant?.variables.find((v) => v.name === sourceHandle)
      if (!outputVariable || outputVariable.type.value.toUpperCase() !== 'BOOL') return undefined

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return undefined

        const compositeKey = ctx.getCompositeKey(`${blockVariableName}.${sourceHandle}`)
        const value = ctx.boolValues.get(compositeKey)

        if (value === undefined) return undefined

        return value === '1' || value.toUpperCase() === 'TRUE'
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = (node.data as { numericId?: string }).numericId
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

  const isPassThroughNode = (node: FBDRungState['nodes'][number]): boolean => {
    return node.type === 'connector' || node.type === 'continuation'
  }

  const edgeStates = new Map<string, boolean>()

  const determineEdgeState = (edgeId: string, visited: Set<string>): boolean => {
    if (edgeStates.has(edgeId)) {
      return edgeStates.get(edgeId)!
    }

    if (visited.has(edgeId)) {
      return false
    }
    visited.add(edgeId)

    const edge = edgeById.get(edgeId)
    if (!edge) {
      visited.delete(edgeId)
      return false
    }

    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode) {
      visited.delete(edgeId)
      return false
    }

    const incomingEdges = edgesByTarget.get(edge.source) ?? []
    const isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id, visited))

    const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle)

    const isGreen = isPassThroughNode(sourceNode) ? isInputGreen : sourceOutputState === true

    edgeStates.set(edgeId, isGreen)
    visited.delete(edgeId)
    return isGreen
  }

  edges.forEach((edge) => {
    determineEdgeState(edge.id, new Set())
  })

  return edgeStates
}

const fbdEdgeStatesEqual = (previous: Map<string, boolean> | null, next: Map<string, boolean> | null): boolean =>
  previous !== null && next !== null && mapsEqual(previous, next)

export const FBDBody = ({ rung, nodeDivergences = [], isDebuggerActive = false }: FBDProps) => {
  // Bound POU + editor model — every multi-mounted FBDBody reads
  // its OWN POU from the `GraphicalEditorActiveProvider` so cross-
  // tab store mutations don't fire effects against the wrong flow.
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const updateModelVariables = useOpenPLCStore((state) => state.editorActions.updateModelVariables)
  const fbdFlowActions = useOpenPLCStore((state) => state.fbdFlowActions)
  const deleteVariable = useOpenPLCStore((state) => state.projectActions.deleteVariable)
  const { closeModal, openModal } = useOpenPLCStore((state) => state.modalActions)
  const blockElementModal = useOpenPLCStore((state) => state.modals['block-fbd-element'])
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const hasProgramInstance = useOpenPLCStore((state) =>
    state.project.data.configurations.resource.instances.some((instance) => instance.program === pouName),
  )
  const isDebuggerVisible = useIsDebuggerVisible()
  const debugVariableValues = useDebugBoolValuesMap()
  const debugForcedVariables = useDebugForcedVariablesMap()
  const { captureAndPush } = usePouSnapshot()

  const pouRef = pous.find((pou) => pou.name === pouName)
  const getCompositeKey = useDebugCompositeKey()
  const [rungLocal, setRungLocal] = useState<FBDRungState>(rung)
  const [dragging, setDragging] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  // Refs, not state: the values are only read inside the paste handler, and
  // state here re-rendered the whole FBDBody on every pointer move over the
  // canvas (~75 commits/s of pure overhead while idle).
  const insideViewportRef = useRef(false)
  const mousePositionRef = useRef<XYPosition>({ x: 0, y: 0 })
  useFBDClipboard({
    mousePositionRef,
    insideViewportRef,
    reactFlowInstance,
    rung,
    viewportRef: reactFlowViewportRef,
    handleDeleteNodes: (nodes, edges) => {
      handleOnDelete(nodes, edges)
    },
  })

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

  // --- Debug edge coloring and node lockdown ---

  const debugEdgeStates = useMemo(
    () =>
      isDebuggerVisible
        ? computeFBDEdgeStates(rungLocal.nodes, rungLocal.edges, {
            isFunctionBlockPou: pouRef?.pouType === 'function-block',
            hasProgramInstance,
            getCompositeKey,
            boolValues: debugVariableValues,
            forcedValues: debugForcedVariables,
            pouVariables: pouRef?.interface?.variables,
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
      debugForcedVariables,
      pouRef?.interface?.variables,
    ],
  )

  // Identity-stable across polls that didn't change this flow's edge states,
  // so styledEdges keeps its identity and the canvas skips re-render.
  const stableDebugEdgeStates = useContentStable(debugEdgeStates, fbdEdgeStatesEqual)

  const styledEdges = useMemo(() => {
    if (!stableDebugEdgeStates) {
      return rungLocal.edges
    }

    return rungLocal.edges.map((edge) => {
      if (stableDebugEdgeStates.get(edge.id) === true) {
        return {
          ...edge,
          style: { stroke: EDGE_COLOR_TRUE, strokeWidth: 2 },
        }
      }

      return edge
    })
  }, [rungLocal.edges, stableDebugEdgeStates])

  const styledNodes = useMemo(() => {
    if (isDebuggerActive) {
      return rungLocal.nodes.map((node) => ({
        ...node,
        draggable: false,
        selectable: false,
        deletable: false,
      }))
    }

    return rungLocal.nodes
  }, [rungLocal.nodes, isDebuggerActive])

  const updateRungLocalFromStore = () => {
    setRungLocal({
      ...rung,
      nodes: rung.nodes.map((node) => ({
        ...node,
        data: { ...node.data, hasDivergence: nodeDivergences.includes(node.id) },
      })),
    })
  }

  const updateRungState = () => {
    const stripDivergence = (node: FlowNode) => {
      const { hasDivergence: _hd, ...cleanData } = node.data
      return { ...node, data: cleanData }
    }

    const rungLocalCopy = {
      ...rungLocal,
      nodes: rungLocal.nodes.map(stripDivergence),
    }

    const rungClean = {
      ...rung,
      nodes: rung.nodes.map(stripDivergence),
    }

    if (dragging || isEqual(rungLocalCopy, rungClean)) {
      return
    }

    // Make node data mirror be the rung and not the rungLocal
    // This is made because the rungLocal is a local copy and may not reflect the latest changes in the store
    // And the store saves all the block data updates
    const isNodeLengthEqual = rungLocalCopy.nodes.length === rungClean.nodes.length
    const isNodeDataEqual =
      isNodeLengthEqual &&
      rungLocalCopy.nodes.every((localNode, idx) => {
        const rungNode = rungClean.nodes[idx]
        return rungNode && isEqual(localNode.data, rungNode.data)
      })

    const updatedNodes = isNodeDataEqual
      ? rungLocalCopy.nodes
      : isNodeLengthEqual
        ? rungClean.nodes.map((node, index) => {
            return {
              ...rungLocalCopy.nodes[index],
              data: { ...node.data },
            }
          })
        : rungClean.nodes
    const selectedNodes = updatedNodes.filter((node) => node.selected)

    fbdFlowActions.setRung({
      editorName: pouName,
      rung: {
        ...rungLocalCopy,
        nodes: updatedNodes,
        selectedNodes,
      },
    })
  }

  /**
   *  * FYI: This implementation came from https://www.developerway.com/posts/debouncing-in-react
   */
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
    return debounce(func, 200)
    // no dependencies! never gets updated
  }, [])

  useEffect(() => {
    updateRungLocalFromStore()
  }, [rung])

  useEffect(() => {
    debouncedUpdateRungStateCallback()
    return () => debouncedUpdateRungStateCallback.cancel()
  }, [rungLocal])

  /**
   * Handle the addition of a new element by dropping it in the viewport
   */
  const handleAddElementByDropping = (
    position: XYPosition,
    newNodeType: CustomFbdNodeTypes,
    library: string | undefined,
  ) => {
    captureAndPush(pouName)

    const { libraries } = useOpenPLCStore.getState()
    let pouLibrary = undefined
    if (library) {
      const [blockLibraryType, blockLibrary, pouName] = library.split('/')

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
        toast({
          title: 'Can not add block',
          description: `The block type ${library} does not exist in the library`,
          variant: 'fail',
        })
        return
      }
    }

    const newNode = buildGenericNode({
      id: newGraphicalEditorNodeID(newNodeType.toUpperCase()),
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
      editorName: pouName,
    })
  }

  /**
   * Handle the deletion of nodes and edges
   * This function is called when the user presses the delete key
   * It is used to remove the selected nodes and edges from the flow
   */
  const handleOnDelete = (nodes: FlowNode[], edges: FlowEdge[]) => {
    captureAndPush(pouName)

    if (nodes.length > 0) {
      fbdFlowActions.removeNodes({
        nodes: nodes,
        editorName: pouName,
      })

      if (pouRef && nodes.length > 0) {
        const allVariables = pouRef.interface?.variables ?? []
        const allRungs = [rung]

        const variablesToDelete = getFunctionBlockVariablesToCleanup(nodes, allRungs, allVariables)

        variablesToDelete.forEach((variableName) => {
          const variableIndex = allVariables.findIndex((v) => v.name.toLowerCase() === variableName.toLowerCase())

          if (variableIndex !== -1) {
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
          }
        })
      }
    }

    if (edges.length > 0) {
      fbdFlowActions.removeEdges({
        edges: edges,
        editorName: pouName,
      })
    }
  }

  /**
   * Handle the connection of two nodes
   * This function is called when the user connects two nodes
   * It is used to update the local rung state
   */
  const handleOnConnect = (connection: Connection) => {
    // A VAR_IN_OUT pin takes exactly one variable. It is passed by reference, so a second
    // wire would mean two variables aliasing the same parameter with no defined order —
    // CODESYS refuses it too ("The 'X' pin internally contains more than one associated
    // connection. This is not allowed.").
    const occupiedInOutPin = findOccupiedInOutPin(connection, rungLocal)
    if (occupiedInOutPin) {
      toast({
        title: 'Can not connect',
        description:
          `The '${occupiedInOutPin}' pin already has a connection. An in-out pin takes exactly ` +
          'one variable — remove the existing connection first.',
        variant: 'fail',
      })
      return
    }

    captureAndPush(pouName)

    setRungLocal((rung) => ({
      ...rung,
      edges: addEdge(connection, rung.edges),
    }))

    fbdFlowActions.onConnect({
      changes: connection,
      editorName: pouName,
    })
  }

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useStableCallback((changes) => {
    setRungLocal((newRung) => {
      let nodes = newRung.nodes
      let selectedNodes: FlowNode[] = newRung.nodes.filter((node) => node.selected)

      changes.forEach((change) => {
        switch (change.type) {
          case 'select': {
            const node = newRung.nodes.find((n) => n.id === change.id) as FlowNode
            if (change.selected) {
              selectedNodes.push(node)
              return
            }
            selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
            return
          }

          case 'dimensions': {
            if (change.resizing)
              nodes = newRung.nodes.map((n) => {
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

      return {
        ...newRung,
        nodes: applyNodeChanges(changes, nodes),
        selectedNodes: selectedNodes,
      }
    })
  })

  const onEdgesChange: OnEdgesChange<FlowEdge> = useStableCallback((changes) => {
    setRungLocal((rung) => ({
      ...rung,
      edges: applyEdgeChanges(changes, rung.edges),
    }))
  })

  const onNodeDragStart = useStableCallback(() => {
    captureAndPush(pouName)
    setDragging(true)
  })

  /**
   * When the node drag stops, update the fbd rung state
   */
  const onNodeDragStop = useStableCallback(
    (_e: globalThis.MouseEvent | globalThis.TouchEvent, _node: FlowNode, nodes: FlowNode[]) => {
      setDragging(false)
      fbdFlowActions.setRung({
        editorName: pouName,
        rung: {
          ...rungLocal,
          nodes: rungLocal.nodes.map((node) => nodes.find((n) => n.id === node.id) ?? node),
          edges: rungLocal.edges,
        },
      })
    },
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useStableCallback((event: DragEvent) => {
    event.preventDefault()
    // Check if the dragged element is not an FBD block (cross-browser compatible)
    if (!isFbdBlockDrag(event.dataTransfer)) {
      return
    }
  })

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useStableCallback((event: DragEvent) => {
    // Check if the dragged element is a child of the flow viewport
    const { relatedTarget } = event
    if (
      !reactFlowViewportRef.current ||
      !relatedTarget ||
      reactFlowViewportRef.current.contains(relatedTarget as Node)
    ) {
      return
    }
  })

  /**
   * Handle the drag over of the viewport
   * This function is called when a dragged element is over the viewport
   */
  const onDragOver = useStableCallback((event: DragEvent) => {
    if (!reactFlowInstance) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  })

  /**
   * Handle the drop of the viewport
   * This function is called when a dragged element is dropped in the viewport
   */
  const onDrop = useStableCallback((event: DragEvent) => {
    event.preventDefault()
    // Check if there is an FBD block in the dragged data (cross-browser compatible)
    const blockType = getFbdBlockType(event.dataTransfer)

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
  })

  /**
   * Handle the double click of a node
   */
  const handleNodeDoubleClick = (node: FlowNode) => {
    const modalToOpen = node.type === 'block' && 'block-fbd-element'
    if (!modalToOpen) return

    openModal(modalToOpen, node)
  }

  const onDelete = useStableCallback(({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
    handleOnDelete(nodes, edges)
  })
  const onConnect = useStableCallback((connection: Connection) => {
    handleOnConnect(connection)
  })
  const onNodeDoubleClick = useStableCallback((_event: MouseEvent, node: FlowNode) => {
    handleNodeDoubleClick(node)
  })

  // Per-POU pattern id.  Without this, every <Background> SVG <pattern>
  // shares the library default id="pattern"; SVG ids are document-scoped, so
  // opening a second FBD POU makes its <rect fill="url(#pattern)"> resolve
  // against the first instance's pattern and the grid disappears on the
  // second editor.  Scoping by POU name keeps each grid independent.
  const backgroundConfig = useMemo(() => ({ id: `fbd-bg-${pouName}` }), [pouName])

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    closeModal()
  }

  return (
    <div
      className='h-full w-full rounded-lg border p-1 dark:border-neutral-800'
      ref={reactFlowViewportRef}
      onMouseEnter={() => {
        insideViewportRef.current = true
      }}
      onMouseLeave={() => {
        insideViewportRef.current = false
        mousePositionRef.current = { x: 0, y: 0 }
      }}
      onMouseMove={(event) => {
        mousePositionRef.current = { x: event.clientX, y: event.clientY }
      }}
    >
      <ReactFlowPanel
        key={'fbd-react-flow'}
        background={true}
        backgroundConfig={backgroundConfig}
        controls={true}
        controlsConfig={CONTROLS_CONFIG}
        viewportConfig={{
          onInit: setReactFlowInstance,

          nodeTypes,
          nodes: styledNodes,
          edges: styledEdges,

          defaultEdgeOptions: DEFAULT_EDGE_OPTIONS,

          nodesDraggable: !isDebuggerActive,
          nodesConnectable: !isDebuggerActive,
          elementsSelectable: true,

          onDelete: isDebuggerActive ? undefined : onDelete,
          onConnect: isDebuggerActive ? undefined : onConnect,
          onNodeDoubleClick: isDebuggerActive ? undefined : onNodeDoubleClick,

          onDragEnter: isDebuggerActive ? undefined : onDragEnterViewport,
          onDragLeave: isDebuggerActive ? undefined : onDragLeaveViewport,
          onDragOver: isDebuggerActive ? undefined : onDragOver,
          onDrop: isDebuggerActive ? undefined : onDrop,

          onNodesChange: onNodesChange,
          onEdgesChange: onEdgesChange,
          selectionMode: SelectionMode.Partial,

          onNodeDragStart: isDebuggerActive ? undefined : onNodeDragStart,
          onNodeDragStop: isDebuggerActive ? undefined : onNodeDragStop,

          preventScrolling: canZoom,
          panOnDrag: canPan,

          snapGrid: SNAP_GRID,
          snapToGrid: true,

          proOptions: PRO_OPTIONS,
        }}
      />
      {blockElementModal?.open && (
        <BlockElement
          onClose={handleModalClose}
          selectedNode={blockElementModal.data as BlockNode<object>}
          isOpen={blockElementModal.open}
        />
      )}
    </div>
  )
}
