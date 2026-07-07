import { FocusEvent, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import type { PLCVariable } from '../../../../../middleware/shared/ports'
import { PLCPou } from '../../../../../middleware/shared/ports'
import { RefreshIcon } from '../../../../assets/icons/interface/Refresh'
import { useOpenPLCStore } from '../../../../store'
import { LibraryState } from '../../../../store/slices/library'
import { checkVariableName } from '../../../../store/slices/project/validation/variables'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { updateDiagramElementsPosition } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram'
import { reconcileBranchesIfNeeded } from '../../../_molecules/graphical-editor/ladder/rung/ladder-utils/elements/handle-branch'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockOutputDebugBadges } from '../block-output-debug-badges'
import { BlockVariant as newBlockVariant } from '../types/block'
import { getBlockDocumentation, getVariableRestrictionType } from '../utils'
import { buildBlockNode } from './buildNodes'
import { CustomHandle } from './handle'
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
}: {
  nodeId?: string
  data: BlockNodeData<T>
  height: number
  width: number
  selected: boolean
  disabled?: boolean
  wrongVariable?: boolean
  scale?: number
}) => {
  const pouName = useBoundPou()
  const editor = useBoundEditorModel()
  const {
    editorActions: { updateModelVariables },
    libraries,
    ladderFlows,
    ladderFlowActions: { setNodes, setEdges, setHandleBranches },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable, deleteVariable },
    snapshotActions: { pushToHistory },
  } = useOpenPLCStore()

  const {
    name: blockName,
    variables: blockVariables,
    type: blockType,
  } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const inputConnectors = blockVariables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = blockVariables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => variable.name)

  const [blockNameValue, setBlockNameValue] = useState<string>(blockType === 'generic' ? '' : blockName)
  const [validBlockNameValue, setValidBlockNameValue] = useState<string>(blockNameValue)
  const [wrongName, setWrongName] = useState<boolean>(false)

  const inputNameRef = useRef<HTMLInputElement>(null)
  const [inputNameFocus, setInputNameFocus] = useState<boolean>(true)

  /**
   * useEffect to focus the name input when the correct block type is selected
   */
  useEffect(() => {
    if (disabled) return

    if (inputNameRef.current) {
      switch (blockType) {
        case 'generic':
          inputNameRef.current.focus()
          break
        default:
          break
      }
    }
  }, [])

  /**
   * In case the block is disabled, we need to set the block name value to the block name
   */
  useEffect(() => {
    if (disabled) {
      setBlockNameValue(blockName)
      return
    }
  }, [data])

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

  const handleNameInputOnBlur = () => {
    setInputNameFocus(false)

    if (blockNameValue === blockName) {
      return
    }

    const libraryBlock = resolveLibraryBlock(blockNameValue, libraries, pous)

    if (!libraryBlock) {
      setBlockNameValue(validBlockNameValue)
      toast({ title: 'Invalid name', description: 'The name could not be changed', variant: 'fail' })
      return
    }

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

      const project = useOpenPLCStore.getState().project
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

    const { nodes: variableNodes, edges: variableEdges } = updateDiagramElementsPosition(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
        ...(reconciledHandleBranches && { handleBranches: reconciledHandleBranches }),
      },
      [rung.defaultBounds[0], rung.defaultBounds[1]],
    )

    const project2 = useOpenPLCStore.getState().project
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

  const handleFocusInput = (e: FocusEvent<HTMLInputElement, Element>) => {
    e.target.select()
    setValidBlockNameValue(blockNameValue)
    setInputNameFocus(true)
  }

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-1 ring-red-500': wrongVariable || wrongName,
          'border-transparent ring-2 ring-brand': selected,
        },
      )}
      style={{
        width: width,
        height: height,
        transform: `scale(${scale})`,
      }}
    >
      <InputWithRef
        id={`block-input-name${nodeId ? `-${nodeId}` : ''}`}
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value)}
        maxLength={20}
        placeholder='???'
        className='w-full bg-transparent p-1 text-center text-xs outline-none'
        disabled={disabled}
        onFocus={handleFocusInput}
        onBlur={() => inputNameFocus && handleNameInputOnBlur()}
        onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
        ref={inputNameRef}
      />
      {inputConnectors.map((connector, index) => {
        const handle = (data as BasicNodeData).inputHandles?.[index]
        const top =
          (handle?.relPosition?.y ?? DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET) - 10
        return (
          <div key={index} className='absolute text-xs' style={{ top, left: 6 }}>
            {connector}
          </div>
        )
      })}
      {outputConnectors.map((connector, index) => {
        const handle = (data as BasicNodeData).outputHandles?.[index]
        const top =
          (handle?.relPosition?.y ?? DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET) - 10
        return (
          <div key={index} className='absolute text-xs' style={{ top, right: 6 }}>
            {connector}
          </div>
        )
      })}
    </div>
  )
}

export const Block = <T extends object>(block: BlockProps<T>) => {
  const { data, dragging, height, width, selected, id } = block

  const pouName = useBoundPou()
  const {
    project: {
      data: { pous },
    },
    projectActions: { createVariable },
    snapshotActions: { pushToHistory },
    libraries: { user: userLibraries },
    ladderFlows,
    ladderFlowActions: { updateNode, setNodes, setEdges, setHandleBranches: setHandleBranchesBlock },
  } = useOpenPLCStore()
  const { type: blockType } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = getBlockDocumentation(data.variant as newBlockVariant)

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [hoveringBlock, setHoveringBlock] = useState(false)

  const { variables, rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
    nodeId: id,
  })

  const connectedOutputNames = useMemo(() => {
    const names = new Set<string>()
    if (Array.isArray(data.connectedVariables)) {
      for (const cv of data.connectedVariables) {
        if (cv.type === 'output' && cv.variable) {
          names.add(cv.handleId)
        }
      }
    }
    return names
  }, [data.connectedVariables])

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  /**
   * useEffect to focus the variable input when the correct block type is selected
   */
  const hasCreatedRef = useRef(false)

  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      hasCreatedRef.current = true
      return
    }

    if (inputVariableRef.current && !hasCreatedRef.current) {
      switch (blockType) {
        case 'function-block': {
          if (!data.variable || data.variable.name === '') {
            const { name, number } = checkVariableName(variables.all, (data.variant as BlockVariant).name.toUpperCase())

            handleSubmitBlockVariableOnTextareaBlur(`${name}${number}`, true)
            hasCreatedRef.current = true
            return
          }
          inputVariableRef.current.focus()
          return
        }
        default:
          break
      }
    }
  }, [data])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    if (blockType !== 'function-block') {
      setWrongVariable(false)
      return
    }

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
  }, [pous, data.variable.name])

  /**
   * Handle with the variable input onBlur event
   */

  const handleSubmitBlockVariableOnTextareaBlur = (variableName?: string, createIfNotFound?: boolean) => {
    const variableNameToSubmit = variableName ?? blockVariableValue

    if (variableNameToSubmit.trim() === '') {
      setWrongVariable(true)
      return
    }

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
        const project = useOpenPLCStore.getState().project
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
    const { variables, rung, node, edges } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
      nodeId: id,
    })

    if (!node || !rung) return

    const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
    if (!variant) return

    const libMatch = userLibraries.find((lib) => lib.name === variant.name && lib.type === variant.type)
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

    const { nodes: variableNodes, edges: variableEdges } = updateDiagramElementsPosition(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
        ...(reconciledHandleBranches && { handleBranches: reconciledHandleBranches }),
      },
      [rung.defaultBounds[0], rung.defaultBounds[1]],
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
          <TooltipTrigger>
            <BlockNodeElement
              nodeId={id}
              data={data}
              height={height ?? DEFAULT_BLOCK_HEIGHT}
              width={width ?? DEFAULT_BLOCK_WIDTH}
              selected={selected ?? false}
              wrongVariable={wrongVariable}
            />
          </TooltipTrigger>
          {!dragging && blockType !== 'generic' && documentation && (
            <TooltipContent side='right' className='text-xs'>
              <span className='whitespace-pre-line'>{documentation}</span>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-[10px]'
        style={{
          width: width ?? DEFAULT_BLOCK_WIDTH,
        }}
      >
        {(data.variant as BlockVariant).type !== 'function' && (data.variant as BlockVariant).type !== 'generic' && (
          <HighlightedTextArea
            id={`block-input-variable-${id}`}
            textAreaValue={blockVariableValue}
            setTextAreaValue={setBlockVariableValue}
            handleSubmit={() => handleSubmitBlockVariableOnTextareaBlur(blockVariableValue, false)}
            onFocus={(e) => {
              e.target.select()
              const { node, rung } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
                nodeId: id,
              })
              if (!node || !rung) return
              // Drag-lock while typing is UI state, not an edit — transient
              // so focusing the input never marks the flow as modified.
              updateNode({
                editorName: pouName,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: false,
                },
                transient: true,
              })
              return
            }}
            onBlur={() => {
              const { node, rung } = getLadderPouVariablesRungNodeAndEdges(pouName, pous, ladderFlows, {
                nodeId: id,
              })
              if (!node || !rung) return
              updateNode({
                editorName: pouName,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: node.data.draggable as boolean,
                },
                transient: true,
              })
              return
            }}
            inputHeight={{
              height: 13,
              scrollLimiter: 14,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
          />
        )}
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
      <BlockOutputDebugBadges
        blockType={(data.variant as BlockVariant).type}
        blockName={(data.variant as BlockVariant).name}
        blockVariableName={data.variable?.name ?? ''}
        numericId={data.numericId}
        outputVariables={(data.variant as BlockVariant).variables}
        connectorStartY={DEFAULT_BLOCK_CONNECTOR_Y}
        connectorOffsetY={DEFAULT_BLOCK_CONNECTOR_Y_OFFSET}
        blockWidth={width ?? DEFAULT_BLOCK_WIDTH}
        connectedOutputNames={connectedOutputNames}
      />
    </div>
  )
}
