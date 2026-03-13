import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import * as Popover from '@radix-ui/react-popover'
import { useDebugger } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { RungLadderState } from '../../../../store/slices/ladder'
import { PLCVariable } from '../../../../../middleware/shared/ports'
import { cn } from '../../../../utils/cn'
import {
  floatToBuffer,
  getVariableTypeInfo,
  integerToBuffer,
  parseFloatValue,
  parseIntegerValue,
  parseStringValue,
  stringToBuffer,
} from '../../../../utils/variable-types'
import { useEffect, useRef, useState } from 'react'

import { Label } from '../../label'
import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { CustomHandle } from './handle'
import { getLadderPouVariablesRungNodeAndEdges, validateVariableType } from './utils'
import { VariablesBlockAutoComplete } from './autocomplete'
import { BlockNodeData, BlockVariant, LadderBlockConnectedVariables, VariableNode, VariableProps } from './utils/types'
import { DEFAULT_VARIABLE_HEIGHT, DEFAULT_VARIABLE_WIDTH } from './utils/constants'

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
  const debugger_ = useDebugger()
  const getCompositeKey = useDebugCompositeKey()

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
   * useEffect to sync variableValue with data.variable.name when it changes externally
   * (e.g., from variable rename propagation or autocomplete selection)
   * Only sync when autocomplete is closed to avoid overwriting user input while typing
   */
  useEffect(() => {
    const name = data.variable?.name ?? ''
    if (!openAutocomplete && name !== '') {
      setVariableValue(name)
    }
  }, [data.variable?.name, openAutocomplete])

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
      variableName: data.variable?.name,
    })
    if (!rung || !variableNode) return

    // Use the selected variable from getLadderPouVariablesRungNodeAndEdges which properly
    // handles derived types for 'variable' node types (block pin variables)
    const variable = variables.selected

    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      const nodeVariableName = (variableNode as VariableNode).data.variable.name
      const nodeVarRef = (variableNode as VariableNode).data.variable

      const namesMatchCI = variable.name.toLowerCase() === nodeVariableName.toLowerCase()
      const caseDiffers = variable.name !== nodeVariableName
      const refStale = nodeVarRef !== variable

      if (!namesMatchCI || caseDiffers || refStale) {
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
      // Only sync variableValue when not actively editing (autocomplete closed)
      if (!openAutocomplete) {
        setVariableValue(variable.name)
      }
      setInputError(!validation.isValid)
      setIsAVariable(true)
    }

    if (!rung) return

    const relatedBlock = rung.nodes.find((node) => node.id === data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pous, data.variable?.name])

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

    // For variable nodes (block pins), allow all types including derived (user-defined types)
    // Don't use getVariableByName here as it filters out derived types
    let variable: PLCVariable | { name: string } | undefined = (pou.data.variables as PLCVariable[]).find(
      (v) => v.name.toLowerCase() === variableNameToSubmit.toLowerCase(),
    )
    if (!variable) {
      setIsAVariable(false)
      variable = { name: variableNameToSubmit }
    } else {
      setIsAVariable(true)
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
    setInputError(false)
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

    const compositeKey = getCompositeKey(data.variable.name)
    const variableIndex = debugVariableIndexes.get(compositeKey)
    if (variableIndex === undefined) return

    const success = await debugger_.setVariable(variableIndex, true, new Uint8Array([1]))
    if (success) {
      const newForcedVariables = new Map(debugForcedVariables)
      newForcedVariables.set(compositeKey, true)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleForceFalse = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = getCompositeKey(data.variable.name)
    const variableIndex = debugVariableIndexes.get(compositeKey)
    if (variableIndex === undefined) return

    const success = await debugger_.setVariable(variableIndex, true, new Uint8Array([0]))
    if (success) {
      const newForcedVariables = new Map(debugForcedVariables)
      newForcedVariables.set(compositeKey, false)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleReleaseForce = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = getCompositeKey(data.variable.name)
    const variableIndex = debugVariableIndexes.get(compositeKey)
    if (variableIndex === undefined) return

    const success = await debugger_.setVariable(variableIndex, false)
    if (success) {
      const newForcedVariables = new Map(debugForcedVariables)
      newForcedVariables.delete(compositeKey)
      setDebugForcedVariables(newForcedVariables)
    }
  }

  const handleForceValueOpen = (e: React.MouseEvent) => {
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

    const compositeKey = getCompositeKey(data.variable.name)
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

    const success = await debugger_.setVariable(variableIndex, true, valueBuffer)

    if (success) {
      const newForcedVariables = new Map(debugForcedVariables)
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

  const compositeKey = getCompositeKey(data.variable.name)
  const isForced = debugForcedVariables.has(compositeKey)
  const forcedValue2 = debugForcedVariables.get(compositeKey)

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
            'text-[#80C000]': isForced && forcedValue2,
            'text-[#4080FF]': isForced && !forcedValue2,
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
            if (e.key === 'Enter' && (autocompleteRef.current?.selectedVariable.positionInArray ?? -1) !== -1) {
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
                      onClick={handleForceValueOpen}
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

export { VariableElement }
