import { RefreshIcon } from '@root/renderer/assets'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { updateDiagramElementsPosition } from '@root/renderer/components/_molecules/graphical-editor/ladder/rung/ladder-utils/elements/diagram'
import { useOpenPLCStore } from '@root/renderer/store'
import { LibraryState } from '@root/renderer/store/slices'
import { checkVariableNameUnit } from '@root/renderer/store/slices/project/validation/variables'
import { PLCPou } from '@root/types/PLC/open-plc'
import type { PLCVariable } from '@root/types/PLC/units/variable'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { FocusEvent, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockVariant as newBlockVariant } from '../types/block'
import { getBlockDocumentation, getVariableRestrictionType, validateVariableType } from '../utils'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'

export type BlockVariant = {
  name: string
  type: string
  variables: { name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
  extensible: boolean
}
type Variables = {
  [key: string]: {
    variable: PLCVariable | undefined
    type: 'input' | 'output'
  }
}

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
  lockExecutionControl: boolean
  connectedVariables: Variables
  variable: { id: string; name: string } | PLCVariable
  hasDivergence?: boolean
}

export type BlockNode<T> = Node<BlockNodeData<T>>
type BlockProps<T> = NodeProps<BlockNode<T>>
type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 36
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 40

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  type: 'generic',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: '',
}

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
  const {
    editor,
    editorActions: { updateModelVariables },
    libraries,
    ladderFlows,
    ladderFlowActions: { setNodes, setEdges },
    project: {
      data: { pous },
    },
    projectActions: { updateVariable, deleteVariable },
    snapshotActions: { addSnapshot },
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
    const userPou = pous.find((pou) => pou.data.name.toLowerCase() === userLibrary?.name.toLowerCase())

    if (!userPou) {
      return (
        libraries.system
          // @ts-expect-error - type is dynamic
          .flatMap((block) => block.pous)
          // @ts-expect-error - type is dynamic
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          .find((pou) => pou.name.toLowerCase() === blockNameValue.toLowerCase())
      )
    }

    const variables = userPou.data.variables.map((variable) => ({
      name: variable.name,
      class: variable.class,
      type: {
        definition: variable.type.definition,
        value: variable.type.value.toUpperCase(),
      },
    }))

    if (userPou.type === 'function') {
      const variable = getVariableRestrictionType(userPou.data.returnType)
      variables.push({
        name: 'OUT',
        class: 'output',
        type: {
          definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
          value: userPou.data.returnType.toUpperCase(),
        },
      })
    }

    return {
      name: userPou.data.name,
      type: userPou.type,
      variables,
      documentation: userPou.data.documentation,
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

    const { pou, rung, node, variables, edges } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: nodeId ?? '',
    })
    if (!pou || !rung || !node) return

    if (libraryBlock && pou.type === 'function' && (libraryBlock as BlockVariant).type !== 'function') {
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

      addSnapshot(editor.meta.name)

      if ((libraryBlock as BlockVariant).type !== 'function-block') {
        deleteVariable({
          rowId: variableIndex,
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
          associatedPou: editor.meta.name,
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
      },
      [rung.defaultBounds[0], rung.defaultBounds[1]],
    )

    addSnapshot(editor.meta.name)

    setNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: variableNodes,
    })
    setEdges({
      editorName: editor.meta.name,
      rungId: rung.id,
      edges: variableEdges,
    })

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

  const {
    editor,
    project: {
      data: { pous },
    },
    projectActions: { createVariable },
    libraries: { user: userLibraries },
    ladderFlows,
    snapshotActions: { addSnapshot },
    ladderFlowActions: { updateNode, setNodes, setEdges },
  } = useOpenPLCStore()
  const { type: blockType } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const documentation = getBlockDocumentation(data.variant as newBlockVariant)

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [hoveringBlock, setHoveringBlock] = useState(false)

  const { variables, rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
    nodeId: id,
  })

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  /**
   * useEffect to focus the variable input when the correct block type is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '' && blockType === 'function-block') {
      setBlockVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current && selected) {
      switch (blockType) {
        case 'function-block': {
          if (!data.variable || data.variable.name === '') {
            const { name, number } = checkVariableNameUnit(
              variables.all,
              (data.variant as BlockVariant).name.toUpperCase(),
            )
            handleSubmitBlockVariableOnTextareaBlur(`${name}${number}`, true)
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
          editorName: editor.meta.name,
          rungId: rung.id,
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
    const variableNameToSubmit = variableName ?? blockVariableValue

    if (variableNameToSubmit.trim() === '') {
      setWrongVariable(true)
      return
    }

    if (!rung || !node) {
      toast({ title: 'Error', description: 'Could not find the related rung or node', variant: 'fail' })
      return
    }

    const blockType = (node.data as BlockNodeData<BlockVariant>).variant.name

    const findMatchingVariable = () =>
      variables.all.find(
        (variable) =>
          variable.name === variableNameToSubmit &&
          variable.type.definition === 'derived' &&
          variable.type.value === blockType,
      )

    const updateNodeVariable = (variable: Partial<PLCVariable> | { name: string }) =>
      updateNode({
        editorName: editor.meta.name,
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
      if (variableToLink.name === variableNameToSubmit) return

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
        addSnapshot(editor.meta.name)

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
          associatedPou: editor.meta.name,
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
    const { variables, rung, node, edges } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
    })

    if (!node || !rung) return

    const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
    if (!variant) return

    const libMatch = userLibraries.find((lib) => lib.name === variant.name && lib.type === variant.type)
    if (!libMatch) return

    const libVariables = pous.find((pou) => pou.data.name === libMatch.name)?.data

    const blockVariant = node.data.variant as BlockVariant

    const newNodeVariables = (libVariables?.variables || []).map((variable) => ({
      ...variable,
      type: {
        ...variable.type,
        value: variable.type.value.toUpperCase(),
      },
    }))
    const updatedNewNode = buildBlockNode({
      id: `BLOCK_${uuidv4()}`,
      posX: node.position.x,
      posY: node.position.y,
      handleX: (node.data as BasicNodeData).handles[0].glbPosition.x,
      handleY: (node.data as BasicNodeData).handles[0].glbPosition.y,
      variant: { ...libVariables, type: blockVariant.type, variables: newNodeVariables },
      executionControl: (node.data as BlockNodeData<BlockVariant>).executionControl,
    })
    updatedNewNode.data = {
      ...updatedNewNode.data,
      variable: variables.selected ?? { name: '' },
    }

    if (!rung) return

    const newBlockNode = { ...updatedNewNode }

    let newNodes = [...rung.nodes]
    let newEdges = [...rung.edges]

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

    const { nodes: variableNodes, edges: variableEdges } = updateDiagramElementsPosition(
      {
        ...rung,
        nodes: newNodes,
        edges: newEdges,
      },
      [rung.defaultBounds[0], rung.defaultBounds[1]],
    )

    setNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: variableNodes,
    })
    setEdges({
      editorName: editor.meta.name,
      rungId: rung.id,
      edges: variableEdges,
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
            onFocus={(e) => {
              e.target.select()
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: false,
                },
              })
              return
            }}
            onBlur={() => {
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: node.data.draggable as boolean,
                },
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
    </div>
  )
}

/**
 *
 * @param id: string - The id of the block node
 * @param posX: number - The x coordinate of the block node in the flow panel
 * @param posY: number - The y coordinate of the block node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @param blockType: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = <T extends object | undefined>({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  executionControl = false,
}: BlockBuilderProps<T>) => {
  const {
    variant: variantLib,
    executionControl: executionControlAux,
    lockExecutionControl,
  } = getBlockVariantAndExecutionControl({ ...((variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE) }, executionControl)
  const { handles, leftHandles, rightHandles, height, width } = getBlockSize(variantLib, { x: handleX, y: handleY })

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputHandles: leftHandles,
      outputHandles: rightHandles,
      inputConnector: leftHandles[0],
      outputConnector: rightHandles[0],
      numericId: generateNumericUUID(),
      variant: variantLib,
      variable: { name: '' },
      executionOrder: 0,
      executionControl: executionControlAux,
      lockExecutionControl,
      connectedVariables: {},
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width,
    height,
    measured: {
      width,
      height,
    },
    draggable: true,
    selectable: true,
    selected: variantLib.type === 'function' ? false : true,
  }
}

export const getBlockSize = (
  variant: BlockVariant,
  handlePosition: {
    x: number
    y: number
  },
) => {
  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => variable.name)
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => variable.name)

  const blockHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    24 +
    Math.max(inputConnectors.length - 1, outputConnectors.length - 1) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  let variableInputWidth = 0
  let variableOutputWidth = 0
  const blockNameWidth = variant.name.length * 12
  inputConnectors.forEach((input) => {
    const inputWidth = input.length * 12
    if (inputWidth > variableInputWidth) variableInputWidth = inputWidth
  })
  outputConnectors.forEach((output) => {
    const outputWidth = output.length * 12
    if (outputWidth > variableOutputWidth) variableOutputWidth = outputWidth
  })

  const blockWidth = Math.min(
    Math.max(variableInputWidth + 18 + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handlePosition.x,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = outputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handlePosition.x + blockWidth,
      glbY: handlePosition.y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: blockWidth,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  return {
    handles,
    leftHandles,
    rightHandles,
    height: blockHeight,
    width: blockWidth,
  }
}

const getBlockVariantAndExecutionControl = (variantLib: BlockVariant, executionControl: boolean) => {
  const variant = { ...variantLib }

  const inputConnectors = variant.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'inOut')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))
  const outputConnectors = variant.variables
    .filter((variable) => variable.class === 'output' || variable.class === 'inOut')
    .map((variable) => ({
      name: variable.name,
      type: variable.type,
    }))

  const mustHaveExecutionControlEnabled =
    inputConnectors.length === 0 ||
    !validateVariableType('BOOL', inputConnectors[0].type.value.toUpperCase()).isValid ||
    outputConnectors.length === 0 ||
    !validateVariableType('BOOL', outputConnectors[0].type.value.toUpperCase()).isValid

  if (executionControl || mustHaveExecutionControlEnabled) {
    const executionControlVariable = variant.variables.some(
      (variable) => variable.name === 'EN' || variable.name === 'ENO',
    )

    if (!executionControlVariable) {
      variant.variables = [
        {
          name: 'EN',
          class: 'input',
          type: { definition: 'generic-type', value: 'BOOL' },
        },
        {
          name: 'ENO',
          class: 'output',
          type: { definition: 'generic-type', value: 'BOOL' },
        },
        ...variant.variables,
      ]
    }
  } else {
    variant.variables = variant.variables.filter((variable) => variable.name !== 'EN' && variable.name !== 'ENO')
  }

  return {
    variant: variant,
    executionControl: executionControl || mustHaveExecutionControlEnabled,
    lockExecutionControl: mustHaveExecutionControlEnabled,
  }
}
