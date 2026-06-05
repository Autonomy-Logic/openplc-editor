import { FocusEvent, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { RefreshIcon } from '../../../../assets/icons/interface/Refresh'
import { useOpenPLCStore } from '../../../../store'
import { checkVariableName } from '../../../../store/slices/project/validation/variables'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundEditorModel, useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockOutputDebugBadges } from '../block-output-debug-badges'
import { BlockVariant } from '../types/block'
import { getBlockDocumentation, getVariableRestrictionType } from '../utils'
import { buildBlockNode } from './buildNodes'
import { CustomHandle } from './handle'
import { BasicNodeData, BlockNodeData, BlockProps } from './utils'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_HEIGHT,
  DEFAULT_BLOCK_TYPE,
  DEFAULT_BLOCK_WIDTH,
} from './utils/constants'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type { BlockNode, BlockNodeData } from './utils/types'

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
  nodeId: string
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
    editorActions: { updateModelVariables, updateModelFBD },
    libraries,
    fbdFlows,
    fbdFlowActions: { setNodes, setEdges },
    project,
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

  const { pou, rung, node, variables, edges } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
    nodeId: nodeId ?? '',
  })
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

  const handleNameInputOnBlur = () => {
    setInputNameFocus(false)

    if (blockNameValue === blockName) {
      return
    }

    const libraryBlock = libraries.system.flatMap((block) => block.pous).find((pou) => pou.name === blockNameValue)

    if (!libraryBlock) {
      setBlockNameValue(validBlockNameValue)
      toast({ title: 'Invalid name', description: 'The name could not be changed', variant: 'fail' })
      return
    }

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

      const pouData = project.data.pous.find((p) => p.name === pouName)
      pushToHistory(pouName, {
        variables: pouData?.interface?.variables ?? [],
        body: pouData?.body.value,
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
      id: `BLOCK_${crypto.randomUUID()}`,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      variant: libraryBlock,
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    newBlockNode.data = {
      ...newBlockNode.data,
      variable: variable ?? { name: '' },
    }

    newNodes = newNodes.map((n) => (n.id === node.id ? newBlockNode : n))

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

    const pouData2 = project.data.pous.find((p) => p.name === pouName)
    pushToHistory(pouName, {
      variables: pouData2?.interface?.variables ?? [],
      body: pouData2?.body.value,
    })

    setNodes({
      editorName: pouName,
      nodes: newNodes,
    })
    setEdges({
      editorName: pouName,
      edges: newEdges,
    })

    setWrongName(false)
  }

  const onMouseEnter = () => {
    updateModelFBD({
      hoveringElement: { elementId: nodeId, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      hoveringElement: { elementId: null, hovering: false },
    })
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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <InputWithRef
        value={blockNameValue}
        onChange={(e) => setBlockNameValue(e.target.value.toUpperCase())}
        maxLength={20}
        placeholder='???'
        className='absolute top-2 w-full bg-transparent text-center text-xs outline-none'
        disabled={disabled}
        onFocus={handleFocusInput}
        onBlur={() => inputNameFocus && handleNameInputOnBlur()}
        onKeyDown={(e) => e.key === 'Enter' && inputNameRef.current?.blur()}
        ref={inputNameRef}
      />
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, left: 6 }}
        >
          {connector}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-xs'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 10, right: 6 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}

export const Block = <T extends object>(block: BlockProps<T>) => {
  const { data, dragging, height, width, selected, id } = block
  const pouName = useBoundPou()
  const {
    project,
    project: {
      data: { pous },
    },
    projectActions: { createVariable },
    snapshotActions: { pushToHistory },
    libraries: { user: userLibraries },
    fbdFlows,
    fbdFlowActions: { updateNode, setNodes, setEdges },
  } = useOpenPLCStore()
  const { type: blockType } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = getBlockDocumentation(data.variant as BlockVariant)

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [hoveringBlock, setHoveringBlock] = useState(false)

  const { rung, node, variables } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
    nodeId: id ?? '',
  })

  // Outputs connected to variable nodes already show their own badge — skip those
  const connectedOutputNames = useMemo(() => {
    const names = new Set<string>()
    if (!rung) return names
    const outgoingEdges = rung.edges.filter((e) => e.source === id)
    for (const edge of outgoingEdges) {
      const targetNode = rung.nodes.find((n) => n.id === edge.target)
      if (targetNode && typeof targetNode.type === 'string' && targetNode.type.includes('variable')) {
        if (edge.sourceHandle) names.add(edge.sourceHandle)
      }
    }
    return names
  }, [rung, id])

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

    if (inputVariableRef.current && selected && !hasCreatedRef.current) {
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

    if (!node || !rung) {
      console.error('Node or rung not found for ID:', id)
      return
    }

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: pouName,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable,
            },
          },
        })
        setWrongVariable(false)
        return
      }
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitBlockVariableOnTextareaBlur = (variableName?: string, createIfNotFound?: boolean) => {
    const variableNameToSubmit = variableName || blockVariableValue

    if (variableNameToSubmit === '') {
      setWrongVariable(true)
      return
    }

    const { rung, node, variables } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })

    if (!rung || !node) {
      toast({
        title: 'Error',
        description: 'Could not find the related rung or node',
        variant: 'fail',
      })
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

    const updateNodeVariable = (variable: Partial<PLCVariable> | { name: string }) => {
      updateNode({
        editorName: pouName,
        nodeId: node.id,
        node: {
          ...node,
          data: { ...node.data, variable },
        },
      })
    }

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
        const pouData = project.data.pous.find((p) => p.name === pouName)
        pushToHistory(pouName, {
          variables: pouData?.interface?.variables ?? [],
          body: pouData?.body.value,
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
          toast({
            title: creationResult.title,
            description: creationResult.message,
            variant: 'fail',
          })
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
    const { rung, node, pou } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return

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
      const variable = getVariableRestrictionType(libPou.interface?.returnType ?? '')
      const hasOut = newNodeVariables.some((v) => v.name === 'OUT')
      if (!hasOut)
        newNodeVariables.push({
          id: 'OUT',
          name: 'OUT',
          class: 'output',
          type: {
            definition: variable.definition ?? 'derived',
            value: (libPou.interface?.returnType ?? '').toUpperCase(),
          },
          location: '',
          documentation: '',
          debug: false,
        })
    }

    const updatedNewNode = buildBlockNode({
      id: `BLOCK_${crypto.randomUUID()}`,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      variant: { name: libPou.name, type: blockVariant.type, variables: newNodeVariables },
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    updatedNewNode.data = {
      ...updatedNewNode.data,
      variable: variables.selected ?? { name: '' },
    }

    if (!pou || !rung || !node) return

    const newNode = { ...updatedNewNode }

    const originalNodeInputs = (node.data.variant as BlockVariant).variables.filter(
      (variable) => variable.class === 'input' || variable.class === 'inOut',
    )
    const originalNodeSources = (node.data.variant as BlockVariant).variables.filter(
      (variable) => variable.class === 'output' || variable.class === 'inOut',
    )

    const updatedInputVariables = newNode.data.variant.variables.filter(
      (variable) => variable.class === 'input' || variable.class === 'inOut',
    )
    const updatedOutputVariables = newNode.data.variant.variables.filter(
      (variable) => variable.class === 'output' || variable.class === 'inOut',
    )

    let newNodes = [...rung.nodes]
    newNodes = newNodes.map((nodeItem) => (nodeItem.id === node.id ? newNode : nodeItem))

    // Update edges to match new node and variable positions
    // Only reconnect edges that were previously connected to the node and have a matching handle in the updated node
    const newEdges = rung.edges
      .map((edge) => {
        const isSource = edge.source === node.id
        const isTarget = edge.target === node.id

        // Only update edges that were previously connected to the node
        if (isSource) {
          // Find the handle name in the original node's output variables
          const outputIndex = originalNodeSources.findIndex((v) => v.name === edge.sourceHandle)
          // Only connect if the handle exists in both original and updated node
          if (outputIndex === -1) return null

          const updatedHandle = updatedOutputVariables.find((v) => v.name === originalNodeSources[outputIndex].name)
          if (updatedHandle)
            return {
              ...edge,
              source: newNode.id,
              sourceHandle: updatedHandle.name,
            }

          const origId = originalNodeSources[outputIndex].id
          if (origId) {
            const updatedHandleId = updatedOutputVariables.find((v) => v.id === origId)
            if (updatedHandleId)
              return {
                ...edge,
                source: newNode.id,
                sourceHandle: updatedHandleId.name,
              }
          }

          return null
        }

        if (isTarget) {
          // Find the handle name in the original node's input variables
          const inputIndex = originalNodeInputs.findIndex((v) => v.name === edge.targetHandle)
          // Only connect if the handle exists in both original and updated node
          if (inputIndex === -1) return null

          const updatedHandle = updatedInputVariables.find((v) => v.name === originalNodeInputs[inputIndex].name)
          if (updatedHandle)
            return {
              ...edge,
              target: newNode.id,
              targetHandle: updatedHandle.name,
            }

          const origIdIn = originalNodeInputs[inputIndex].id
          if (origIdIn) {
            const updatedHandleId = updatedInputVariables.find((v) => v.id === origIdIn)
            if (updatedHandleId)
              return {
                ...edge,
                target: newNode.id,
                targetHandle: updatedHandleId.name,
              }
          }

          return null
        }

        // Unchanged edge
        return edge
      })
      .filter((edge) => edge !== null)

    setNodes({
      editorName: pouName,
      nodes: newNodes,
    })
    setEdges({
      editorName: pouName,
      edges: newEdges,
    })
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
            textAreaValue={blockVariableValue}
            setTextAreaValue={setBlockVariableValue}
            handleSubmit={() => handleSubmitBlockVariableOnTextareaBlur(blockVariableValue, false)}
            onFocus={(e) => e.target.select()}
            onBlur={() => {}}
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
