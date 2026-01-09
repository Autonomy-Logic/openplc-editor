import * as Popover from '@radix-ui/react-popover'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungLadderState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { getLiteralType } from '@root/utils/keywords'
import {
  floatToBuffer,
  getVariableTypeInfo,
  integerToBuffer,
  parseFloatValue,
  parseIntegerValue,
  parseStringValue,
  stringToBuffer,
} from '@root/utils/PLC/variable-types'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { Label } from '../../label'
import { getVariableByName, validateVariableType } from '../utils'
import { VariablesBlockAutoComplete } from './autocomplete'
import { BlockNodeData, BlockVariant, LadderBlockConnectedVariables } from './block'
import { buildHandle, CustomHandle } from './handle'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input' | 'output'
    block: {
      id: string
      handleId: string
      variableType: BlockVariant['variables'][0]
    }
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input' | 'output'
  block: {
    id: string
    handleId: string
    variableType: BlockVariant['variables'][0]
  }
  variable: PLCVariable | undefined
}

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

const VariableElement = (block: VariableProps) => {
  const { id, data } = block
  const {
    editor,
    project: {
      data: { pous, dataTypes },
    },
    ladderFlows,
    ladderFlowActions: { updateNode },
    workspace: { isDebuggerVisible, debugVariableIndexes, debugForcedVariables },
    workspaceActions: { setDebugForcedVariables },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [forceValue, setForceValue] = useState<string>('')

  const [variableValue, setVariableValue] = useState(data.variable.name)
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  const updateRelatedNode = (rung: RungLadderState, variableNode: VariableNode, variable: PLCVariable) => {
    const relatedBlock = rung.nodes.find((node) => node.id === variableNode.data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }

    const connectedVariables: LadderBlockConnectedVariables = [
      ...(relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables.filter(
        (v) => v.type !== variableNode.data.variant || v.handleId !== variableNode.data.block.handleId,
      ),
      {
        handleId: variableNode.data.block.handleId,
        handleTableId: (relatedBlock.data as BlockNodeData<BlockVariant>).variant.variables.find(
          (v) => v.name === variableNode.data.block.handleId,
        )?.id,
        type: variableNode.data.variant,
        variable,
      },
    ]

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: relatedBlock.id,
      node: {
        ...relatedBlock,
        data: {
          ...relatedBlock.data,
          connectedVariables,
        },
      },
    })
  }

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setVariableValue(data.variable.name)
      return
    }
  }, [])

  /**
   * Update inputError state when the table of variables is updated
   */
  useEffect(() => {
    const {
      node: variableNode,
      rung,
      variables,
    } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
      variableName: data.variable.name,
    })
    if (!rung || !variableNode) {
      return
    }

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      const nodeVariableName = (variableNode as VariableNode).data.variable.name

      if (variable.name.toLowerCase() !== nodeVariableName.toLowerCase()) {
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })
        updateRelatedNode(rung, variableNode as VariableNode, variable)
      }

      if (variable.name.toLowerCase() === nodeVariableName.toLowerCase() && variable.name !== nodeVariableName) {
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })
        updateRelatedNode(rung, variableNode as VariableNode, variable)
      }

      const validation = validateVariableType(variable.type.value, data.block.variableType)
      if (!validation.isValid && dataTypes.length > 0) {
        const userDataTypes = dataTypes.map((dataType) => dataType.name)
        validation.isValid = userDataTypes.includes(variable.type.value)
        validation.error = undefined
      }
      setVariableValue(variable.name)
      setInputError(!validation.isValid)
      setIsAVariable(true)
    }

    if (!rung) return

    const relatedBlock = rung.nodes.find((node) => node.id === data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }
  }, [pous, data.variable.name])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || variableValue

    const { pou, rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    let variable: PLCVariable | { name: string } | undefined = getVariableByName(
      pou.data.variables as PLCVariable[],
      variableNameToSubmit,
    )
    const literalTypes = getLiteralType(variableNameToSubmit)
    if (variable) {
      setIsAVariable(true)
      setInputError(false)
    } else if (literalTypes) {
      setIsAVariable(false)
      const mismatchType = !literalTypes.includes(data.block.variableType.type.value)
      setInputError(mismatchType)
      variable = { name: variableNameToSubmit }
    } else {
      setIsAVariable(true)
      setInputError(true)
      variable = { name: variableNameToSubmit }
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: variableNode.id,
      node: {
        ...variableNode,
        data: {
          ...variableNode.data,
          variable: variable,
        },
      },
    })

    updateRelatedNode(rung, variableNode, variable as PLCVariable)
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

  const getVariableType = (): string | undefined => {
    if (!data.variable || !data.variable.name) return undefined
    const { pou } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, { nodeId: id })
    if (!pou) return undefined
    const variable = pou.data.variables.find((v) => v.name.toLowerCase() === data.variable.name.toLowerCase())
    return variable?.type.value
  }

  const handleForceTrue = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = `${editor.meta.name}:${data.variable.name}`
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) return

    const valueBuffer = new Uint8Array([1])
    const result = await window.bridge.debuggerSetVariable(variableIndex, true, valueBuffer)

    if (result.success) {
      const newForcedVariables = new Map(Array.from(debugForcedVariables))
      newForcedVariables.set(compositeKey, true)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleForceFalse = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = `${editor.meta.name}:${data.variable.name}`
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) return

    const valueBuffer = new Uint8Array([0])
    const result = await window.bridge.debuggerSetVariable(variableIndex, true, valueBuffer)

    if (result.success) {
      const newForcedVariables = new Map(Array.from(debugForcedVariables))
      newForcedVariables.set(compositeKey, false)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleReleaseForce = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = `${editor.meta.name}:${data.variable.name}`
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) return

    const result = await window.bridge.debuggerSetVariable(variableIndex, false)

    if (result.success) {
      const newForcedVariables = new Map(Array.from(debugForcedVariables))
      newForcedVariables.delete(compositeKey)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleForceValue = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    setForceValueModalOpen(true)
  }

  const handleForceValueConfirm = async () => {
    if (!data.variable.name || !forceValue.trim()) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const compositeKey = `${editor.meta.name}:${data.variable.name}`
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const variableType = getVariableType()
    if (!variableType) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const typeInfo = getVariableTypeInfo(variableType)
    if (!typeInfo) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const normalizedType = variableType.toLowerCase()
    const isFloatType = normalizedType === 'real' || normalizedType === 'lreal'
    const isStringType = normalizedType === 'string'

    let valueBuffer: Uint8Array
    let forcedValueForState: boolean

    if (isStringType) {
      const parsedStringValue: string | null = parseStringValue(forceValue)
      if (parsedStringValue === null) {
        setForceValueModalOpen(false)
        setForceValue('')
        return
      }
      valueBuffer = stringToBuffer(parsedStringValue)
      forcedValueForState = true
    } else if (isFloatType) {
      const parsedFloatValue = parseFloatValue(forceValue, typeInfo.byteSize)
      if (parsedFloatValue === null) {
        setForceValueModalOpen(false)
        setForceValue('')
        return
      }
      valueBuffer = floatToBuffer(parsedFloatValue, typeInfo.byteSize)
      forcedValueForState = parsedFloatValue >= 0
    } else {
      const parsedIntValue = parseIntegerValue(forceValue, typeInfo)
      if (parsedIntValue === null) {
        setForceValueModalOpen(false)
        setForceValue('')
        return
      }
      valueBuffer = integerToBuffer(parsedIntValue, typeInfo.byteSize, typeInfo.signed)
      forcedValueForState = parsedIntValue >= BigInt(0)
    }

    const result = await window.bridge.debuggerSetVariable(variableIndex, true, valueBuffer)

    if (result.success) {
      const newForcedVariables = new Map(Array.from(debugForcedVariables))
      newForcedVariables.set(compositeKey, forcedValueForState)
      setDebugForcedVariables(newForcedVariables)
    }

    setForceValueModalOpen(false)
    setForceValue('')
  }

  const handleForceValueCancel = () => {
    setForceValueModalOpen(false)
    setForceValue('')
  }

  const handleForceValueModalChange = (open: boolean) => {
    setForceValueModalOpen(open)
    if (!open) {
      setForceValue('')
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!isDebuggerVisible || !isAVariable) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  const variableType = getVariableType()
  const isBoolVariable = variableType?.toUpperCase() === 'BOOL'

  const compositeKey = `${editor.meta.name}:${data.variable.name}`
  const isForced = debugForcedVariables.has(compositeKey)
  const forcedValue = debugForcedVariables.get(compositeKey)

  return (
    <>
      <div
        style={{ width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }}
        onClick={isDebuggerVisible ? handleClick : undefined}
      >
        <HighlightedTextArea
          id={`variable-input-${id}`}
          textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3', {
            'text-yellow-500': !isAVariable,
            'text-red-500': inputError,
            'text-left placeholder:text-left': data.variant === 'output',
            'text-right placeholder:text-right': data.variant === 'input',
            'font-bold': isForced,
            'text-[#80C000]': isForced && forcedValue,
            'text-[#4080FF]': isForced && !forcedValue,
          })}
          highlightClassName={cn('text-center placeholder:text-center text-xs leading-3', {
            'text-left placeholder:text-left': data.variant === 'output',
            'text-right placeholder:text-right': data.variant === 'input',
          })}
          scrollableIndicatorClassName={cn({
            '-right-3': data.variant === 'output',
            '-left-3': data.variant === 'input',
          })}
          placeholder={`(*${data.block.variableType.type.value}*)`}
          textAreaValue={variableValue}
          setTextAreaValue={setVariableValue}
          handleSubmit={handleSubmitVariableValueOnTextareaBlur}
          inputHeight={{
            height: DEFAULT_VARIABLE_HEIGHT,
            scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
          }}
          ref={inputVariableRef}
          disabled={isDebuggerVisible}
          readOnly={isDebuggerVisible}
          onChange={onChangeHandler}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
            if (e.key === 'Enter' && (autocompleteRef.current?.selectedVariable?.positionInArray ?? -1) !== -1) {
              inputVariableRef.current?.blur({ submit: false })
            }
            setKeyPressedAtTextarea(e.key)
          }}
          onKeyUp={() => setKeyPressedAtTextarea('')}
        />
        {openAutocomplete && (
          <div className='relative flex justify-center'>
            <div className='absolute -bottom-1'>
              <VariablesBlockAutoComplete
                ref={autocompleteRef}
                block={block}
                blockType={'variable'}
                valueToSearch={variableValue}
                isOpen={openAutocomplete}
                setIsOpen={(value) => setOpenAutocomplete(value)}
                keyPressed={keyPressedAtTextarea}
              />
            </div>
          </div>
        )}

        {isDebuggerVisible && contextMenuPosition && (
          <Popover.Root open={isContextMenuOpen} onOpenChange={setIsContextMenuOpen}>
            <Popover.Portal>
              <Popover.Content
                align='start'
                side='bottom'
                sideOffset={5}
                className={cn(
                  'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
                  'focus:outline-none focus-visible:outline-none',
                  'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
                )}
                style={{
                  position: 'fixed',
                  left: `${contextMenuPosition.x}px`,
                  top: `${contextMenuPosition.y}px`,
                }}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                {isBoolVariable ? (
                  <>
                    <div
                      className='flex w-full cursor-pointer items-center gap-2 rounded-t-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      onClick={(e) => void handleForceTrue(e)}
                    >
                      <p>Force True</p>
                    </div>
                    <div
                      className='flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      onClick={(e) => void handleForceFalse(e)}
                    >
                      <p>Force False</p>
                    </div>
                    {isForced && (
                      <div
                        className='flex w-full cursor-pointer items-center gap-2 rounded-b-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                        onClick={(e) => void handleReleaseForce(e)}
                      >
                        <p>Release Force</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className='flex w-full cursor-pointer items-center gap-2 rounded-t-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                      onClick={handleForceValue}
                    >
                      <p>Force value...</p>
                    </div>
                    {isForced && (
                      <div
                        className='flex w-full cursor-pointer items-center gap-2 rounded-b-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                        onClick={(e) => void handleReleaseForce(e)}
                      >
                        <p>Release Force</p>
                      </div>
                    )}
                  </>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>

      <Modal open={forceValueModalOpen} onOpenChange={handleForceValueModalChange}>
        <ModalContent className='flex h-fit min-h-0 w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
          <ModalTitle className='mb-4 text-lg font-semibold'>Force Value</ModalTitle>

          <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
            Enter the value to force for {data.variable?.name || 'this variable'}
          </p>

          <div className='flex w-full flex-col gap-4'>
            <div>
              <Label htmlFor='force-value-input' className='mb-2 block text-sm'>
                Value
              </Label>
              <input
                id='force-value-input'
                type='text'
                value={forceValue}
                onChange={(e) => setForceValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleForceValueConfirm()}
                placeholder='Enter value'
                className='w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-850 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
                autoFocus
              />
            </div>

            <div className='mt-4 flex gap-3'>
              <button
                onClick={() => void handleForceValueConfirm()}
                className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
              >
                OK
              </button>
              <button
                onClick={handleForceValueCancel}
                className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Cancel
              </button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const buildVariableNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  block,
  variable,
}: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output'
      ? buildHandle({
          id: 'input',
          position: Position.Left,
          isConnectable: false,
          type: 'target',
          glbX: handleX,
          glbY: handleY,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input'
      ? buildHandle({
          id: 'output',
          position: Position.Right,
          isConnectable: false,
          type: 'source',
          glbX: handleX + DEFAULT_VARIABLE_WIDTH,
          glbY: handleY,
          relX: DEFAULT_VARIABLE_WIDTH,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: 'variable',
    position: {
      x: posX,
      y: posY,
    },
    width: DEFAULT_VARIABLE_WIDTH,
    height: DEFAULT_VARIABLE_HEIGHT,
    measured: {
      width: DEFAULT_VARIABLE_WIDTH,
      height: DEFAULT_VARIABLE_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: variable ?? { name: '' },
      executionOrder: 0,
      variant,
      block,
      draggable: false,
      selectable: true,
      deletable: false,
    },
    deletable: false,
    selectable: true,
    draggable: false,
  }
}

export { buildVariableNode, VariableElement }
