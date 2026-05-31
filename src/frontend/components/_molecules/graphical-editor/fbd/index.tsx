import {
  addEdge,
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
import { debounce, isEqual } from 'lodash'
import { DragEventHandler, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import {
  useDebugBoolValuesMap,
  useDebugForcedVariablesMap,
  useIsDebuggerVisible,
} from '../../../../hooks/use-debug-value'
import { usePouSnapshot } from '../../../../hooks/use-pou-snapshot'
import { useOpenPLCStore } from '../../../../store'
import type { FBDRungState } from '../../../../store/slices/fbd'
import { getFbdBlockType, isFbdBlockDrag } from '../../../../utils/graphical/drag-detection'
import { getFunctionBlockVariablesToCleanup } from '../../../../utils/graphical/get-function-block-variables-to-cleanup'
import { newGraphicalEditorNodeID } from '../../../../utils/new-graphical-editor-node-id'
import { CustomFbdNodeTypes, customNodeTypes } from '../../../_atoms/graphical-editor/fbd'
import { BlockNode } from '../../../_atoms/graphical-editor/fbd/utils/types'
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

export const FBDBody = ({ rung, nodeDivergences = [], isDebuggerActive = false }: FBDProps) => {
  // Bound POU + editor model — every multi-mounted FBDBody reads
  // its OWN POU from the `GraphicalEditorActiveProvider` so cross-
  // tab store mutations don't fire effects against the wrong flow.
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const {
    editorActions: { updateModelVariables },
    fbdFlowActions,
    libraries,
    project,
    projectActions: { deleteVariable },
    modals,
    modalActions: { closeModal, openModal },
  } = useOpenPLCStore()
  const isDebuggerVisible = useIsDebuggerVisible()
  const debugVariableValues = useDebugBoolValuesMap()
  const debugForcedVariables = useDebugForcedVariablesMap()
  const { captureAndPush } = usePouSnapshot()

  const { pous } = project.data
  const pouRef = pous.find((pou) => pou.name === pouName)
  const getCompositeKey = useDebugCompositeKey()
  const [rungLocal, setRungLocal] = useState<FBDRungState>(rung)
  const [dragging, setDragging] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  const [insideViewport, setInsideViewport] = useState(false)
  const [mousePosition, setMousePosition] = useState<XYPosition>({ x: 0, y: 0 })
  useFBDClipboard({
    mousePosition,
    insideViewport,
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

  const getNodeOutputState = (nodeId: string, sourceHandle: string | null | undefined): boolean | undefined => {
    if (!isDebuggerVisible) return undefined

    const node = rungLocal.nodes.find((n) => n.id === nodeId)
    if (!node) return undefined

    if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
      const variableData = node.data as { variable?: { name: string } }
      const variableName = variableData.variable?.name
      if (!variableName) return undefined

      if (!pouRef) return undefined
      const variable = (pouRef.interface?.variables ?? []).find(
        (v) => v.name.toLowerCase() === variableName.toLowerCase(),
      )
      if (!variable || variable.type.value.toUpperCase() !== 'BOOL') return undefined

      const compositeKey = getCompositeKey(variableName)

      if (debugForcedVariables.has(compositeKey)) {
        return debugForcedVariables.get(compositeKey)
      }

      const value = debugVariableValues.get(compositeKey)
      if (value === undefined) return undefined

      const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
      return isTrue
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string; variables: Array<{ name: string; type: { value: string } }> }
      }
      if (!sourceHandle) return undefined

      if (pouRef?.pouType !== 'function-block') {
        const instances = project.data.configurations.resource.instances
        const programInstance = instances.find((inst: { program: string }) => inst.program === pouName)
        if (!programInstance) return undefined
      }

      const outputVariable = blockData.variant?.variables.find((v) => v.name === sourceHandle)
      if (!outputVariable || outputVariable.type.value.toUpperCase() !== 'BOOL') return undefined

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
        const numericId = (node.data as { numericId?: string }).numericId
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

    const isPassThroughNode = (node: (typeof rungLocal.nodes)[number]): boolean => {
      return node.type === 'connector' || node.type === 'continuation'
    }

    const determineEdgeState = (edgeId: string, visited: Set<string> = new Set()): boolean => {
      if (edgeStateMap.has(edgeId)) {
        return edgeStateMap.get(edgeId)!
      }

      if (visited.has(edgeId)) {
        return false
      }
      visited.add(edgeId)

      const edge = rungLocal.edges.find((e) => e.id === edgeId)
      if (!edge) {
        visited.delete(edgeId)
        return false
      }

      const sourceNode = rungLocal.nodes.find((n) => n.id === edge.source)
      if (!sourceNode) {
        visited.delete(edgeId)
        return false
      }

      const incomingEdges = rungLocal.edges.filter((e) => e.target === edge.source)
      const isInputGreen = incomingEdges.some((incomingEdge) => determineEdgeState(incomingEdge.id, visited))

      const sourceOutputState = getNodeOutputState(edge.source, edge.sourceHandle)

      const isGreen = isPassThroughNode(sourceNode) ? isInputGreen : sourceOutputState === true

      edgeStateMap.set(edgeId, isGreen)
      visited.delete(edgeId)
      return isGreen
    }

    rungLocal.edges.forEach((edge) => {
      determineEdgeState(edge.id, new Set())
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
  }, [
    rungLocal.edges,
    rungLocal.nodes,
    isDebuggerVisible,
    debugVariableValues,
    debugForcedVariables,
    pouName,
    pouRef?.interface?.variables,
    project.data.configurations.resource.instances,
  ])

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
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
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
    [rungLocal, dragging],
  )

  const onNodeDragStart = useCallback(() => {
    captureAndPush(pouName)
    setDragging(true)
  }, [rungLocal, dragging, captureAndPush, pouName])

  /**
   * When the node drag stops, update the fbd rung state
   */
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, _node, nodes) => {
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
    [rungLocal, dragging],
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      event.preventDefault()
      // Check if the dragged element is not an FBD block (cross-browser compatible)
      if (!isFbdBlockDrag(event.dataTransfer)) {
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
    },
    // `libraries.system`, `libraries.user`, and `pous` aren't read
    // directly in onDrop's body — `handleAddElementByDropping` closes
    // over all three.  Omitting any one means the memoized callback
    // keeps a reference to the pre-update handler, so a freshly
    // installed system library / freshly created user FB / freshly
    // saved POU stays invisible until something else forces a re-bind
    // (full project save resets `rung`, which is why "Save Project"
    // used to mask this — and why catalog-installed libs threw
    // "block type ... does not exist" on first drop).
    [rung, reactFlowInstance, libraries.system, libraries.user, pous],
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
    <div
      className='h-full w-full rounded-lg border p-1 dark:border-neutral-800'
      ref={reactFlowViewportRef}
      onMouseEnter={() => {
        setInsideViewport(true)
      }}
      onMouseLeave={() => {
        setInsideViewport(false)
        setMousePosition({ x: 0, y: 0 })
      }}
      onMouseMove={(event) => {
        setMousePosition({ x: event.clientX, y: event.clientY })
      }}
    >
      <ReactFlowPanel
        key={'fbd-react-flow'}
        background={true}
        // Per-POU pattern id.  Without this, every <Background> SVG
        // <pattern> shares the library default id="pattern"; SVG ids
        // are document-scoped, so opening a second FBD POU makes its
        // <rect fill="url(#pattern)"> resolve against the first
        // instance's pattern and the grid disappears on the second
        // editor.  Scoping by POU name keeps each grid independent.
        backgroundConfig={{ id: `fbd-bg-${pouName}` }}
        controls={true}
        controlsConfig={{
          showInteractive: false,
        }}
        viewportConfig={{
          onInit: setReactFlowInstance,

          nodeTypes,
          nodes: styledNodes,
          edges: styledEdges,

          defaultEdgeOptions: {
            type: 'smoothstep',
          },

          nodesDraggable: !isDebuggerActive,
          nodesConnectable: !isDebuggerActive,
          elementsSelectable: true,

          onDelete: isDebuggerActive
            ? undefined
            : ({ nodes, edges }) => {
                handleOnDelete(nodes, edges)
              },
          onConnect: isDebuggerActive
            ? undefined
            : (connection) => {
                handleOnConnect(connection)
              },
          onNodeDoubleClick: isDebuggerActive
            ? undefined
            : (_event, node) => {
                handleNodeDoubleClick(node)
              },

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
