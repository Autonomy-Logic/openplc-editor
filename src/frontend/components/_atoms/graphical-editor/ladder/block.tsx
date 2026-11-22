import { type LabelBox, pouLabelSource, relayoutRung } from '@root/middleware/shared/utils/ladder-layout'
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import type { PLCVariable } from '../../../../../middleware/shared/ports'
import { PLCPou } from '../../../../../middleware/shared/ports'
import { RefreshIcon } from '../../../../assets/icons/interface/Refresh'
import { useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../store'
import { LibraryState } from '../../../../store/slices/library'
import { checkVariableName } from '../../../../store/slices/project/validation/variables'
import { cn } from '../../../../utils/cn'
import { legacyInOutSourcePinIds } from '../../../../utils/graphical/in-out-pin-rules'
import { isLegalIdentifier } from '../../../../utils/keywords'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { reconcileBranchesIfNeeded } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements/handle-branch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockOutputDebugBadges } from '../block-output-debug-badges'
import type { BlockVariant as newBlockVariant } from '../types/block'
import { getBlockDocumentation, getVariableRestrictionType, inOutVariableNames } from '../utils'
import { LadderBlockVisual, standaloneBlockLayout } from './block-visual'
import { buildBlockNode } from './buildNodes'
import { CustomHandle, ladderHandleStyle } from './handle'
import { LadderNameField } from './ladder-text'
import { LADDER_ERROR_COLOUR, useLadderBlockPowered, useLadderNodeView, useLadderThemePalette } from './rung-view'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_HEIGHT,
  DEFAULT_BLOCK_TYPE,
  DEFAULT_BLOCK_WIDTH,
} from './utils/constants'
import type {
  BasicNodeData,
  BlockNodeData,
  BlockProps,
  BlockVariant,
  LadderBlockConnectedVariables,
} from './utils/types'

export type { BlockNode, BlockNodeData, BlockVariant } from './utils/types'

export const BlockNodeElement = <T extends object>({
  nodeId,
  data,
  disabled = false,
  height,
  width,
  selected,
  wrongVariable = false,
  scale = 1,
  energized = false,
  instance,
}: {
  nodeId?: string
  data: BlockNodeData<T>
  height: number
  width: number
  selected: boolean
  disabled?: boolean
  wrongVariable?: boolean
  scale?: number
  energized?: boolean
  /** The instance name drawn above the box, and the editable field that replaces its text. */
  instance?: { name: string; colour?: string; slot?: (label: LabelBox) => ReactNode }
}) => {
  const store = useOpenPLCStoreApi()
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const updateModelVariables = useOpenPLCStore((state) => state.editorActions.updateModelVariables)
  const { setNodes, setEdges, setHandleBranches } = useOpenPLCStore((state) => state.ladderFlowActions)
  const { updateVariable, deleteVariable } = useOpenPLCStore((state) => state.projectActions)
  const pushToHistory = useOpenPLCStore((state) => state.snapshotActions.pushToHistory)
  const isDebuggerVisible = useIsDebuggerVisible()
  const view = useLadderNodeView(nodeId ?? '')
  const themePalette = useLadderThemePalette()

  const {
    name: blockName,
    variables: blockVariables,
    type: blockType,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const inOutConnectors = inOutVariableNames(blockVariables)

  const standalone = useMemo(
    () =>
      view.geometry === undefined
        ? standaloneBlockLayout({
            id: nodeId ?? 'preview',
            type: 'block',
            position: { x: 0, y: 0 },
            data,
            width,
            height,
          })
        : undefined,
    [view.geometry, nodeId, data, width, height],
  )
  const palette = standalone === undefined ? view.palette : themePalette

  const [typeValue, setTypeValue] = useState<string>('')
  const [editingType, setEditingType] = useState<boolean>(() => blockType === 'generic' && !disabled)
  const [wrongName, setWrongName] = useState<boolean>(false)

  const resolveLibraryBlock = (blockNameValue: string, libraries: LibraryState['libraries'], pous: PLCPou[]) => {
    const userLibrary = libraries.user.find((lib) => lib.name.toLowerCase() === blockNameValue.toLowerCase())
    const userPou = pous.find((pou) => pou.name.toLowerCase() === userLibrary?.name.toLowerCase())

    if (!userPou) {
      return libraries.system
        .flatMap((block: { pous: Array<{ name: string }> }) => block.pous)
        .find((pou: { name: string }) => pou.name.toLowerCase() === blockNameValue.toLowerCase())
    }

    const variables = (userPou.interface?.variables ?? []).map((variable) => ({
      name: variable.name,
      class: variable.class,
      type: {
        definition: variable.type.definition,
        value: variable.type.value.toUpperCase(),
      },
    }))

    if (userPou.pouType === 'function') {
      const returnType = userPou.interface?.returnType ?? ''
      const variable = getVariableRestrictionType(returnType)
      variables.push({
        name: 'OUT',
        class: 'output',
        type: {
          definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
          value: returnType.toUpperCase(),
        },
      })
    }

    return {
      name: userPou.name,
      type: userPou.pouType,
      variables,
      documentation: userPou.documentation,
      extensible: false,
    }
  }

  const handleTypeCommit = (blockNameValue: string) => {
    if (blockNameValue === blockName) {
      return
    }

    const { project, libraries, ladderFlows } = store.getState()
    const pous = project.data.pous
    const libraryBlock = resolveLibraryBlock(blockNameValue, libraries, pous)

    if (!libraryBlock) {
      toast({ title: 'Invalid name', description: 'The name could not be changed', variant: 'fail' })
      return
    }

    // The block's library goes into `project.libraries` here, not only through the
    // Library Manager: without the entry the other editor renders the block from its
    // node data and has nothing to warn about when the library is not installed.
    store.getState().libraryActions.ensureLibrariesForTypes([blockNameValue])

    const { pou, rung, node, variables, edges } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
      nodeId: nodeId ?? '',
    })
    if (!pou || !rung || !node) return

    if (libraryBlock && pou.pouType === 'function' && (libraryBlock as BlockVariant).type !== 'function') {
      setWrongName(true)
      toast({
        title: 'Can not add block',
        description: 'You can not add a function block to a function POU',
        variant: 'fail',
      })
      return
    }

    let variable = variables.selected
    const variableIndex = variable ? variables.all.indexOf(variable) : -1

    if (variable) {
      let res: { ok: boolean; data?: unknown; message?: string; title?: string } = {
        ok: true,
        data: undefined,
        message: '',
        title: '',
      }

      const project = store.getState().project
      const currentPou = project.data.pous.find((p) => p.name === pouName)
      pushToHistory(pouName, {
        variables: currentPou?.interface?.variables ?? [],
        body: currentPou?.body.value,
      })

      if ((libraryBlock as BlockVariant).type !== 'function-block') {
        const deletionResult = deleteVariable({
          rowId: variableIndex,
          scope: 'local',
          associatedPou: pouName,
        })
        if (!deletionResult.ok) {
          toast({ title: deletionResult.title, description: deletionResult.message, variant: 'fail' })
          return
        }
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variableIndex
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
        variable = undefined
      } else {
        res = updateVariable({
          data: {
            type: {
              definition: 'derived',
              value: blockNameValue,
            },
          },
          rowId: variableIndex,
          scope: 'local',
          associatedPou: pouName,
        })
        if (!res.ok) {
          toast({
            title: res.title,
            description: res.message,
            variant: 'fail',
          })
          return
        }
        variable = res.data as PLCVariable | undefined
      }
    }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

    /**
     * Update the node with the new block node
     * The new block node have a new ID to not conflict with the old block node and to no occur any error of rendering
     */
    const newBlockNode = buildBlockNode({
      id: `BLOCK_${uuidv4()}`,
      posX: node.position.x,
      posY: node.position.y,
      handleX: (node.data as BasicNodeData).handles[0].glbPosition.x,
      handleY: (node.data as BasicNodeData).handles[0].glbPosition.y,
      variant: libraryBlock,
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    newBlockNode.data = {
      ...newBlockNode.data,
      variable: variable ?? { name: '' },
    }

    newNodes = newNodes.map((n) => (n.id === node.id ? newBlockNode : n))

    // Reconcile branches before main edge remapping so branch edges get new IDs
    const reconciled = reconcileBranchesIfNeeded(
      { ...rung, nodes: newNodes, edges: newEdges },
      node.id,
      newBlockNode.id,
      (libraryBlock as { variables?: BlockVariant['variables'] })?.variables ?? [],
    )
    if (reconciled) {
      newNodes = reconciled.nodes
      newEdges = reconciled.edges
    }
    const reconciledHandleBranches = reconciled?.handleBranches

    edges.source?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        source: newBlockNode.id,
        sourceHandle: newBlockNode.data.outputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })
    edges.target?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        target: newBlockNode.id,
        targetHandle: newBlockNode.data.inputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })

    const { nodes: variableNodes, edges: variableEdges } = relayoutRung(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
        ...(reconciledHandleBranches && { handleBranches: reconciledHandleBranches }),
      },
      pouLabelSource(store.getState().project.data, pouName),
    )

    const project2 = store.getState().project
    const currentPou2 = project2.data.pous.find((p) => p.name === pouName)
    pushToHistory(pouName, {
      variables: currentPou2?.interface?.variables ?? [],
      body: currentPou2?.body.value,
    })

    setNodes({
      editorName: pouName,
      rungId: rung.id,
      nodes: variableNodes,
    })
    setEdges({
      editorName: pouName,
      rungId: rung.id,
      edges: variableEdges,
    })
    if (reconciledHandleBranches) {
      setHandleBranches({
        editorName: pouName,
        rungId: rung.id,
        handleBranches: reconciledHandleBranches,
      })
    }

    setWrongName(false)
  }

  return (
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
      <LadderBlockVisual
        nodeId={nodeId ?? 'preview'}
        width={standalone?.width ?? width}
        height={standalone?.height ?? height}
        labels={standalone?.labels ?? view.labels}
        palette={palette}
        typeName={blockType === 'generic' ? '' : blockName}
        instanceName={instance?.name ?? ''}
        showInstance={instance !== undefined}
        instanceColour={instance?.colour}
        inOutPins={inOutConnectors}
        borderColour={energized ? palette.on : palette.wire}
        energized={energized}
        selected={selected}
        invalid={wrongVariable || wrongName}
        interactive={!disabled}
        instanceSlot={instance?.slot}
        typeSlot={(label) => (
          <LadderNameField
            label={label}
            text={blockType === 'generic' ? '' : blockName}
            testId={`ld-block-type-${nodeId ?? 'preview'}`}
            palette={palette}
            fill={palette.text}
            editable={!disabled && !isDebuggerVisible}
            editing={editingType}
            onEditingChange={setEditingType}
            value={typeValue}
            onValueChange={setTypeValue}
            onCommit={handleTypeCommit}
          />
        )}
      />
    </div>
  )
}

const Block = <T extends object>(block: BlockProps<T>) => {
  const { data, dragging, height, width, selected, id } = block
  const store = useOpenPLCStoreApi()

  const pouName = useBoundPou()
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const createVariable = useOpenPLCStore((state) => state.projectActions.createVariable)
  const pushToHistory = useOpenPLCStore((state) => state.snapshotActions.pushToHistory)
  const {
    updateNode,
    setNodes,
    setEdges,
    setHandleBranches: setHandleBranchesBlock,
  } = useOpenPLCStore((state) => state.ladderFlowActions)
  const { type: blockType } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = getBlockDocumentation(data.variant as newBlockVariant)
  const isDebuggerVisible = useIsDebuggerVisible()
  const powered = useLadderBlockPowered(id)
  const { palette } = useLadderNodeView(id)

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [hoveringBlock, setHoveringBlock] = useState(false)
  const [editingInstance, setEditingInstance] = useState<boolean>(false)

  const setDraggable = (draggable: (nodeData: Record<string, unknown>) => boolean) => {
    const { ladderFlows } = store.getState()
    const { node, rung } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, { nodeId: id })
    if (!node || !rung) return
    updateNode({
      editorName: pouName,
      nodeId: node.id,
      rungId: rung.id,
      node: { ...node, draggable: draggable(node.data) },
      transient: true,
    })
  }

  // Output-side pins this block still carries for an in-out parameter — empty for every rung
  // saved since in-outs became input-only.
  const staleInOutSourcePins = useMemo(() => legacyInOutSourcePinIds(data), [data])

  // Output pins that already have a NAMED variable of their own on the rung, so
  // the block must not draw a second badge for the same value.
  //
  // Derived from the rung's own nodes, not from `data.connectedVariables`. That
  // field is a denormalised cache and it does not carry output entries in
  // practice -- a CTU with `current_count` wired to CV records only its inputs
  // (`R`, `PV`), so the skip never fired and CV was badged twice: once by the
  // block, once by the variable. The rung graph is the authority, and reading it
  // also fixes projects saved before now without a migration.
  //
  // An output variable node with an EMPTY name is a bare pin stub (every TON
  // carries one for ET). That is not a connected variable, it shows no badge of
  // its own, and the block's badge is the only place its value appears -- so it
  // must NOT suppress anything.
  // Subscribe to the flows array only (a stable reference until the ladder
  // actually changes), then derive in a memo. As a live selector this ran its
  // whole-POU scan on EVERY store update — a debug-value tick, a cursor move —
  // once per rendered block; keyed on the flows reference it runs only when the
  // ladder is edited.
  const ladderFlows = useOpenPLCStore((state) => state.ladderFlows)
  const connectedOutputKey = useMemo(() => {
    const rung = ladderFlows.find((flow) => flow.name === pouName)?.rungs.find((r) => r.nodes.some((n) => n.id === id))
    if (!rung) return ''
    const names: string[] = []
    for (const node of rung.nodes) {
      if (node.type !== 'variable') continue
      const nd = node.data as {
        variant?: string
        block?: { id?: string; handleId?: string }
        variable?: { name?: string }
      }
      if (nd.variant !== 'output') continue
      if (nd.block?.id !== id) continue
      if (!nd.block?.handleId) continue
      if (!nd.variable?.name) continue
      names.push(nd.block.handleId)
    }
    return names.sort().join('\u0000')
  }, [ladderFlows, pouName, id])

  const connectedOutputNames = useMemo(() => {
    // Union with the cache: where it DOES carry an output entry, honour it.
    const names = new Set<string>(connectedOutputKey ? connectedOutputKey.split('\u0000') : [])
    if (Array.isArray(data.connectedVariables)) {
      for (const cv of data.connectedVariables) {
        if (cv.type === 'output' && cv.variable) {
          names.add(cv.handleId)
        }
      }
    }
    return names
  }, [connectedOutputKey, data.connectedVariables])

  const hasCreatedRef = useRef(false)

  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      hasCreatedRef.current = true
      return
    }

    if (hasCreatedRef.current || blockType !== 'function-block') return
    if (!data.variable || data.variable.name === '') {
      const { project, ladderFlows } = store.getState()
      const { variables } = getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, {
        nodeId: id,
      })
      const { name, number } = checkVariableName(variables.all, (data.variant as BlockVariant).name.toUpperCase())

      handleSubmitBlockVariableOnTextareaBlur(`${name}${number}`, true)
      hasCreatedRef.current = true
    }
  }, [store, data])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    if (blockType !== 'function-block') {
      setWrongVariable(false)
      return
    }

    const { ladderFlows } = store.getState()
    const {
      variables: freshVariables,
      rung: freshRung,
      node: freshNode,
    } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
      nodeId: id,
      variableName: data.variable.name,
    })

    if (!freshNode || !freshRung) {
      return
    }

    const variable = freshVariables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    const nodeVariable = (freshNode.data as BasicNodeData).variable
    const nodeVariableName = nodeVariable.name.toLowerCase()
    const selectedVariableName = variable.name.toLowerCase()
    const nodeBlockType = (freshNode.data as BlockNodeData<BlockVariant>).variant.name

    if (nodeVariableName === selectedVariableName) {
      const typeMatches =
        variable.type.definition === 'derived' && variable.type.value.toLowerCase() === nodeBlockType.toLowerCase()

      if (!typeMatches) {
        setWrongVariable(true)
        return
      }

      if (nodeVariable.name !== variable.name) {
        updateNode({
          editorName: pouName,
          rungId: freshRung.id,
          nodeId: freshNode.id,
          node: {
            ...freshNode,
            data: {
              ...freshNode.data,
              variable,
            },
          },
        })
      }
      setWrongVariable(false)
      return
    }

    setWrongVariable(true)
  }, [store, pous, data.variable.name])

  /**
   * Handle with the variable input onBlur event
   */

  const handleSubmitBlockVariableOnTextareaBlur = (variableName?: string, createIfNotFound?: boolean) => {
    const variableNameToSubmit = variableName ?? blockVariableValue

    if (variableNameToSubmit.trim() === '') {
      setWrongVariable(true)
      return
    }

    const { ladderFlows } = store.getState()
    const { variables, rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
      nodeId: id,
    })

    if (!rung || !node) {
      toast({ title: 'Error', description: 'Could not find the related rung or node', variant: 'fail' })
      return
    }

    // Blur with an unchanged name is not an edit — skip the write so merely
    // clicking in and out of a block never marks the POU as modified. The
    // autocomplete's explicit create action (createIfNotFound) still proceeds.
    if (!createIfNotFound && variableNameToSubmit === (node.data as { variable?: { name?: string } }).variable?.name) {
      return
    }

    const blockType = (node.data as BlockNodeData<BlockVariant>).variant.name

    const findMatchingVariable = () =>
      variables.all.find(
        (variable) =>
          variable.name.toLowerCase() === variableNameToSubmit.toLowerCase() &&
          variable.type.definition === 'derived' &&
          variable.type.value.toLowerCase() === blockType.toLowerCase(),
      )

    const updateNodeVariable = (variable: Partial<PLCVariable> | { name: string }) =>
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: { ...node.data, variable },
        },
      })

    let variableToLink = variables.selected

    const matchingVariable = findMatchingVariable()

    if (variableToLink) {
      if (variableToLink.name.toLowerCase() === variableNameToSubmit.toLowerCase()) return

      if (matchingVariable && matchingVariable.id !== variableToLink.id) {
        variableToLink = matchingVariable
      } else {
        updateNodeVariable({ name: variableNameToSubmit })
        setWrongVariable(true)
        return
      }
    } else {
      if (matchingVariable) {
        variableToLink = matchingVariable
      } else if (createIfNotFound) {
        // An entry that can't be a new variable NAME — a member/array reference,
        // a typed literal (`T#500ms`), a reserved word — is bound to the block
        // verbatim as a constant/reference instead of erroring.
        if (!isLegalIdentifier(variableNameToSubmit)[0]) {
          updateNodeVariable({ name: variableNameToSubmit })
          return
        }
        const project = store.getState().project
        const currentPou = project.data.pous.find((p) => p.name === pouName)
        pushToHistory(pouName, {
          variables: currentPou?.interface?.variables ?? [],
          body: currentPou?.body.value,
        })

        const creationResult = createVariable({
          data: {
            id: uuidv4(),
            name: variableNameToSubmit,
            type: { definition: 'derived', value: blockType },
            class: 'local',
            location: '',
            documentation: '',
            debug: false,
          },
          scope: 'local',
          associatedPou: pouName,
        })

        if (!creationResult.ok) {
          toast({ title: creationResult.title, description: creationResult.message, variant: 'fail' })
          return
        }
        variableToLink = creationResult.data as PLCVariable
      } else {
        updateNodeVariable({ name: variableNameToSubmit })
        setWrongVariable(true)
        return
      }
    }

    updateNodeVariable(variableToLink)
    setBlockVariableValue(variableToLink.name)
    setWrongVariable(false)
  }

  const handleUpdateDivergence = () => {
    const { ladderFlows, libraries } = store.getState()
    const { variables, rung, node, edges } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
      nodeId: id,
    })

    if (!node || !rung) return

    const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
    if (!variant) return

    const libMatch = libraries.user.find((lib) => lib.name === variant.name && lib.type === variant.type)
    if (!libMatch) return

    const libPou = pous.find((pou) => pou.name === libMatch.name)
    if (!libPou) return

    const blockVariant = node.data.variant as BlockVariant
    const newNodeVariables = (libPou.interface?.variables ?? []).map((variable) => {
      let newType
      switch (variable.type.definition) {
        case 'array':
          newType = {
            ...variable.type,
            value: variable.type.value.toUpperCase(),
            data: variable.type.data,
          }
          break
        case 'base-type':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'base-type',
          }
          break
        case 'user-data-type':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'user-data-type',
          }
          break
        case 'derived':
          newType = {
            value: variable.type.value.toUpperCase(),
            definition: 'derived',
          }
          break
        default:
          newType = variable.type
      }
      return {
        ...variable,
        type: newType,
      }
    })

    if (libPou.pouType === 'function') {
      const returnType = libPou.interface?.returnType ?? ''
      const variable = getVariableRestrictionType(returnType)
      newNodeVariables.push({
        name: 'OUT',
        class: 'output',
        type: {
          definition: variable.definition ?? 'derived',
          value: returnType.toUpperCase(),
        },
        location: '',
        documentation: '',
        debug: false,
      })
    }

    const updatedNewNode = buildBlockNode({
      id: `BLOCK_${uuidv4()}`,
      posX: node.position.x,
      posY: node.position.y,
      handleX: (node.data as BasicNodeData).handles[0].glbPosition.x,
      handleY: (node.data as BasicNodeData).handles[0].glbPosition.y,
      variant: {
        name: libPou.name,
        documentation: libPou.documentation,
        type: blockVariant.type,
        variables: [...newNodeVariables],
      },
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })

    const connectedVariables: LadderBlockConnectedVariables = (
      node.data as BlockNodeData<BlockVariant>
    ).connectedVariables
      .map((connectedVariable) => {
        if (newNodeVariables.some((newVar) => newVar.name === connectedVariable.handleId)) {
          return connectedVariable
        }

        if (connectedVariable.handleTableId) {
          const matchId = newNodeVariables.find((newVar) => newVar.id === connectedVariable.handleTableId)
          if (matchId) {
            return { ...connectedVariable, handleId: matchId.name }
          }
        }

        return undefined
      })
      .filter((v): v is NonNullable<typeof v> => v !== undefined)

    updatedNewNode.data = {
      ...updatedNewNode.data,
      connectedVariables: connectedVariables ?? [],
      variable: variables.selected ?? { name: '' },
    }

    if (!rung) return

    const newBlockNode = { ...updatedNewNode }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

    newNodes = newNodes.map((n) => (n.id === node.id ? newBlockNode : n))

    // Reconcile branches before main edge remapping so branch edges get new IDs
    const reconciled2 = reconcileBranchesIfNeeded(
      { ...rung, nodes: newNodes, edges: newEdges },
      node.id,
      newBlockNode.id,
      newNodeVariables as BlockVariant['variables'],
    )
    if (reconciled2) {
      newNodes = reconciled2.nodes
      newEdges = reconciled2.edges
    }
    const reconciledHandleBranches = reconciled2?.handleBranches

    // Every outgoing edge moves to the rebuilt block's primary output pin. This is also what
    // converts a rung whose rail used to leave a VAR_IN_OUT pin — `rightHandles` included
    // in-outs before they became input-only, so a BOOL in-out could end up as `outputConnector`
    // and carry the rail. The rail follows the block; it is deliberately NOT re-pointed at
    // whatever fed the pin. Ladder edges are the rung chain, not data reads, so FBD's
    // `rewireInOutReads` would route the rail around the block here. There is always a pin to
    // move to: `getBlockVariantAndExecutionControl` forces EN/ENO when a block has no BOOL
    // output, so the rebuilt `outputConnector` is always present.
    edges.source?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        source: newBlockNode.id,
        sourceHandle: newBlockNode.data.outputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })
    edges.target?.forEach((edge) => {
      const newEdge = {
        ...edge,
        id: edge.id.replace(node.id, newBlockNode.id),
        target: newBlockNode.id,
        targetHandle: newBlockNode.data.inputConnector.id,
      }
      newEdges = newEdges.map((e) => (e.id === edge.id ? newEdge : e))
    })

    const { nodes: variableNodes, edges: variableEdges } = relayoutRung(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
        ...(reconciledHandleBranches && { handleBranches: reconciledHandleBranches }),
      },
      pouLabelSource(store.getState().project.data, pouName),
    )

    setNodes({
      editorName: pouName,
      rungId: rung.id,
      nodes: variableNodes,
    })
    setEdges({
      editorName: pouName,
      rungId: rung.id,
      edges: variableEdges,
    })
    if (reconciledHandleBranches) {
      setHandleBranchesBlock({
        editorName: pouName,
        rungId: rung.id,
        handleBranches: reconciledHandleBranches,
      })
    }
  }

  const showsInstance = blockType !== 'function' && blockType !== 'generic'
  const handleY = (handleId: string): number | undefined => {
    const handle = data.handles.find((candidate) => candidate.id === handleId)
    const y: unknown = handle?.relPosition?.y
    return typeof y === 'number' ? y : undefined
  }

  return (
    <div
      className={cn('relative', {
        'opacity-40': id.startsWith('copycat'),
      })}
      onMouseEnter={() => setHoveringBlock(true)}
      onMouseLeave={() => setHoveringBlock(false)}
    >
      {data.hasDivergence && hoveringBlock && (
        <div
          className='pointer absolute right-[-12px] top-[-12px] z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 shadow-sm'
          onClick={handleUpdateDivergence}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <RefreshIcon />
              </TooltipTrigger>
              <TooltipContent side='top' className='text-xs'>
                Update node
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <BlockNodeElement
                nodeId={id}
                data={data}
                height={height ?? DEFAULT_BLOCK_HEIGHT}
                width={width ?? DEFAULT_BLOCK_WIDTH}
                selected={selected ?? false}
                wrongVariable={wrongVariable}
                energized={isDebuggerVisible && powered}
                instance={
                  showsInstance
                    ? {
                        name: data.variable?.name ?? '',
                        colour: wrongVariable ? LADDER_ERROR_COLOUR : undefined,
                        slot: (label) => (
                          <LadderNameField
                            label={label}
                            text={data.variable?.name ?? ''}
                            testId={`ld-block-instance-${id}`}
                            palette={palette}
                            fill={wrongVariable ? LADDER_ERROR_COLOUR : palette.text}
                            editable={!isDebuggerVisible}
                            editing={editingInstance}
                            onEditingChange={setEditingInstance}
                            value={blockVariableValue}
                            onValueChange={setBlockVariableValue}
                            onCommit={(value) => handleSubmitBlockVariableOnTextareaBlur(value, false)}
                            onFocus={() => setDraggable(() => false)}
                            onBlur={() => setDraggable((nodeData) => nodeData.draggable === true)}
                          />
                        ),
                      }
                    : undefined
                }
              />
            </div>
          </TooltipTrigger>
          {!dragging && blockType !== 'generic' && documentation && (
            <TooltipContent side='right' className='text-xs'>
              <span className='whitespace-pre-line'>{documentation}</span>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      {data.handles.map((handle, index) => (
        <CustomHandle
          key={index}
          {...handle}
          style={ladderHandleStyle(handle)}
          // A rung saved before VAR_IN_OUT became input-only still carries the pin's output
          // side, and this list is what actually renders. Keep drawing it so the existing rung
          // wiring stays visible, but refuse NEW connections from a pin that no longer exists.
          // The block's update badge is what removes it.
          isConnectable={
            handle.type === 'source' && handle.id !== undefined && staleInOutSourcePins.has(handle.id)
              ? false
              : handle.isConnectable
          }
        />
      ))}
      <BlockOutputDebugBadges
        blockType={(data.variant as BlockVariant).type}
        blockName={(data.variant as BlockVariant).name}
        blockVariableName={data.variable?.name ?? ''}
        numericId={data.numericId}
        outputVariables={(data.variant as BlockVariant).variables}
        connectorStartY={DEFAULT_BLOCK_CONNECTOR_Y}
        connectorOffsetY={DEFAULT_BLOCK_CONNECTOR_Y_OFFSET}
        connectorYOf={handleY}
        blockWidth={width ?? DEFAULT_BLOCK_WIDTH}
        connectedOutputNames={connectedOutputNames}
      />
    </div>
  )
}

// Cast keeps the generic call signature `memo` would otherwise widen away.
const exportBlock = memo(Block) as typeof Block

export { exportBlock as Block }
