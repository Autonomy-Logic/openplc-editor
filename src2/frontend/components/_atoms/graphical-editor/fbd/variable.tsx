import * as Popover from '@radix-ui/react-popover'
import { useEffect, useMemo, useRef, useState } from 'react'

import { resolveArrayVariableByName } from '../../../../../backend/shared/array-variable-utils'
import { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useOpenPLCStore } from '../../../../store'
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
import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { Label } from '../../label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { DebugValueBadge } from '../debug-value-badge'
import { BlockVariant } from '../types/block'
import { validateVariableType } from '../utils'
import { FBDBlockAutoComplete } from './autocomplete'
import { CustomHandle } from './handle'
import { BlockNode, VariableNode, VariableProps } from './utils'
import {
  DEFAULT_VARIABLE_HEIGHT,
  DEFAULT_VARIABLE_WIDTH,
  VARIABLE_ELEMENT_HEIGHT,
  VARIABLE_ELEMENT_SIZE,
} from './utils/constants'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

const VariableElement = (block: VariableProps) => {
  const { id, data, selected } = block
  const {
    editor,
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous, dataTypes },
    },
    workspace: { isDebuggerVisible, debugVariableValues, debugVariableIndexes, debugForcedVariables },
    workspaceActions: { setDebugForcedVariables },
  } = useOpenPLCStore()

  const debugger_ = useDebugger()

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
      triggerSubmit?: () => void
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  const [variableValue, setVariableValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)
  const [errorDescription, setErrorDescription] = useState<string>('')
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [forceValue, setForceValue] = useState<string>('')

  const getCompositeKey = useDebugCompositeKey()

  /**
   * Get the connection type
   */
  const flow = useMemo(() => fbdFlows.find((flow) => flow.name === editor.meta.name), [fbdFlows, editor])

  const connections = useMemo(() => {
    const rung = flow?.rung
    if (!rung) return []

    const connectedEdges = rung.edges.filter((edge) => edge.source === id || edge.target === id)
    const connectionsTmp = connectedEdges.map((edge) => {
      const isSource = edge.source === id
      const connectedNodeId = isSource ? edge.target : edge.source
      return rung.nodes.find((block) => block.id === connectedNodeId && block.type === 'block')
    })

    return connectionsTmp
      .filter((node): node is BlockNode<BlockVariant> => node !== undefined)
      .map((node, index) => ({
        node,
        edge: connectedEdges[index],
        isSource: connectedEdges[index].source === id,
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  const primaryConnection = useMemo(() => {
    const primaryConnection = connections[0]
    return primaryConnection
      ? {
          node: primaryConnection.node,
          targetEdge: primaryConnection.isSource ? undefined : primaryConnection.edge,
          sourceEdge: primaryConnection.isSource ? primaryConnection.edge : undefined,
        }
      : {
          node: undefined,
          targetEdge: undefined,
          sourceEdge: undefined,
        }
  }, [connections])

  const primaryConnectionType = useMemo(() => {
    const variable = primaryConnection.node?.data.variant.variables.find(
      (variable) =>
        variable.name === primaryConnection.sourceEdge?.targetHandle ||
        variable.name === primaryConnection.targetEdge?.sourceHandle,
    )
    return variable
      ? {
          string: `(*${variable.type.value}*)`,
          variable: {
            name: variable.name,
            class: variable.class,
            type: {
              value: variable.type.value,
              definition: variable.type.definition,
            },
          },
        }
      : {
          string: 'NOT CONNECTED',
          variable: {
            name: '',
            class: '',
            type: {
              value: '',
              definition: '',
            },
          },
        }
  }, [primaryConnection])

  const allConnectionsType = useMemo(() => {
    return connections.map((connection) => {
      const variable = connection.node?.data.variant.variables.find(
        (variable) => variable.name === connection.edge.sourceHandle || variable.name === connection.edge.targetHandle,
      )
      return variable
        ? {
            string: `(*${variable.type.value}*)`,
            variable: {
              name: variable.name,
              class: variable.class,
              type: {
                value: variable.type.value,
                definition: variable.type.definition,
              },
            },
          }
        : {
            string: 'NOT CONNECTED',
            variable: {
              name: '',
              class: '',
              type: {
                value: '',
                definition: '',
              },
            },
          }
    })
  }, [connections])

  /**
   * useEffect to initialize the variable value when the component mounts
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setVariableValue(data.variable.name)
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * useEffect to sync variableValue from node props when autocomplete is closed
   * This ensures the UI updates after autocomplete selection
   */
  useEffect(() => {
    // Only sync when autocomplete is closed to avoid overwriting user input while typing
    const name = data.variable?.name ?? ''
    if (!openAutocomplete && name !== '') {
      setVariableValue(name)
    }
  }, [data.variable?.name, openAutocomplete])

  /**
   * Update inputError state when the table of variables is updated
   */
  useEffect(() => {
    const { node: variableNode, variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
      variableName: variableValue,
    })
    if (!variableNode) return

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      if (variable.name.toLowerCase() !== (variableNode as VariableNode).data.variable.name.toLowerCase()) {
        updateNode({
          editorName: editor.meta.name,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })
      }

      let isValid = allConnectionsType.every(
        (connection) => validateVariableType(variable.type.value, connection.variable).isValid,
      )

      if (!isValid && dataTypes.length > 0) {
        const userDataTypes = dataTypes.map((dataType) => dataType.name)
        isValid = userDataTypes.includes(variable.type.value)
      }

      if (!isValid) {
        const validWithPrimaryConnection = validateVariableType(
          variable.type.value,
          primaryConnectionType.variable,
        ).isValid

        if (!validWithPrimaryConnection) {
          setErrorDescription(
            `Variable type ${variable.type.value} is not compatible with ${primaryConnectionType.variable.name}`,
          )
        } else {
          setErrorDescription(
            `Variable type ${variable.type.value} is not compatible with one or more connections: ${allConnectionsType
              .map((connection) => connection.variable.name)
              .join(', ')}`,
          )
        }
      } else {
        setErrorDescription('')
      }

      if (!inputVariableRef.current?.isFocused) {
        setVariableValue(variable.name)
      }
      setInputError(!isValid)
      setIsAVariable(true)
    }

    if (!connections.length) {
      setErrorDescription('')
      setInputError(false)
      return
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pous])

  const getVariableType = (): string | undefined => {
    if (!data.variable || !data.variable.name) return undefined
    const { pou } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, { nodeId: id })
    if (!pou) return undefined
    const variable = (pou.interface?.variables ?? []).find((v: PLCVariable) => v.name.toLowerCase() === data.variable.name.toLowerCase())
    return variable?.type.value
  }

  const getDebuggerColor = (): string | undefined => {
    if (!isDebuggerVisible || !data.variable.name || !isAVariable) {
      return undefined
    }

    const variableType = getVariableType()
    if (!variableType || variableType.toUpperCase() !== 'BOOL') {
      return undefined
    }

    const compositeKey = getCompositeKey(data.variable.name)

    if (debugForcedVariables.has(compositeKey)) {
      const forcedVal = debugForcedVariables.get(compositeKey)
      return forcedVal ? '#80C000' : '#4080FF'
    }

    const value = debugVariableValues.get(compositeKey)
    if (value === undefined) {
      return undefined
    }

    const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
    return isTrue ? '#00FF00' : '#0464FB'
  }

  const debuggerColor = getDebuggerColor()

  const handleForceTrue = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)

    if (!data.variable.name) return

    const compositeKey = getCompositeKey(data.variable.name)
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) return

    const result = await debugger_.setVariable(variableIndex, true, new Uint8Array([1]))
    if (result.success) {
      const newForced = new Map(debugForcedVariables)
      newForced.set(compositeKey, true)
      setDebugForcedVariables(newForced)
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

    const result = await debugger_.setVariable(variableIndex, true, new Uint8Array([0]))
    if (result.success) {
      const newForced = new Map(debugForcedVariables)
      newForced.set(compositeKey, false)
      setDebugForcedVariables(newForced)
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

    const result = await debugger_.setVariable(variableIndex, false)
    if (result.success) {
      const newForced = new Map(debugForcedVariables)
      newForced.delete(compositeKey)
      setDebugForcedVariables(newForced)
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

    const compositeKey = getCompositeKey(data.variable.name)
    const variableIndex = debugVariableIndexes.get(compositeKey)

    if (variableIndex === undefined) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const varType = getVariableType()
    if (!varType) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const typeInfo = getVariableTypeInfo(varType)
    if (!typeInfo) {
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    const normalizedType = varType.toLowerCase()
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

    const result = await debugger_.setVariable(variableIndex, true, valueBuffer)

    if (result.success) {
      const newForced = new Map(debugForcedVariables)
      newForced.set(compositeKey, forcedValueForState)
      setDebugForcedVariables(newForced)
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

  const compositeKeyForForced = getCompositeKey(data.variable.name)
  const isForced = debugForcedVariables.has(compositeKeyForForced)
  const forcedValue_ = debugForcedVariables.get(compositeKeyForForced)

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || variableValue

    const { pou, rung, node } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    // For variable nodes, allow all types including derived (user-defined types)
    // Don't use getVariableByName here as it filters out derived types
    let variable: PLCVariable | { name: string } | undefined =
      ((pou.interface?.variables ?? [])).find((v) => v.name.toLowerCase() === variableNameToSubmit.toLowerCase()) ||
      resolveArrayVariableByName((pou.interface?.variables ?? []), variableNameToSubmit)
    if (!variable) {
      setIsAVariable(false)
      variable = { name: variableNameToSubmit }
    } else {
      setIsAVariable(true)
    }

    updateNode({
      editorName: editor.meta.name,
      nodeId: variableNode.id,
      node: {
        ...variableNode,
        data: {
          ...variableNode.data,
          variable: variable,
        },
      },
    })

    setInputError(false)
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

  const onMouseEnter = () => {
    updateModelFBD({
      canEditorZoom: false,
      hoveringElement: { elementId: id, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      canEditorZoom: true,
      hoveringElement: { elementId: null, hovering: false },
    })
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              style={{
                width: VARIABLE_ELEMENT_SIZE,
                height: VARIABLE_ELEMENT_HEIGHT,
                ...(debuggerColor
                  ? {
                      borderColor: debuggerColor,
                      boxShadow: `0 0 0 2px ${debuggerColor}33 inset`,
                    }
                  : {}),
                ...(isDebuggerVisible
                  ? {
                      pointerEvents: 'auto' as const,
                      zIndex: 10,
                    }
                  : {}),
              }}
              className={cn(
                'relative flex items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
                'hover:border-transparent hover:ring-2 hover:ring-brand',
                {
                  'border-transparent ring-2 ring-brand': selected && !debuggerColor,
                },
              )}
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
              onClick={isDebuggerVisible ? handleClick : undefined}
              onContextMenu={isDebuggerVisible ? handleClick : undefined}
            >
              <div
                className='relative flex items-center'
                style={{
                  width: DEFAULT_VARIABLE_WIDTH,
                  height: DEFAULT_VARIABLE_HEIGHT,
                }}
              >
                <HighlightedTextArea
                  textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3', {
                    'text-yellow-500': !isAVariable,
                    'text-red-500': inputError,
                    'font-bold': isForced,
                    'text-[#80C000]': isForced && forcedValue_,
                    'text-[#4080FF]': isForced && !forcedValue_,
                  })}
                  highlightClassName={cn('text-center placeholder:text-center text-xs leading-3', {})}
                  scrollableIndicatorClassName={cn({
                    '-right-1': data.variant === 'output-variable' || data.variant === 'inout-variable',
                    '-left-1': data.variant === 'input-variable',
                  })}
                  placeholder={primaryConnectionType.string}
                  textAreaValue={variableValue}
                  setTextAreaValue={setVariableValue}
                  handleSubmit={handleSubmitVariableValueOnTextareaBlur}
                  inputHeight={{
                    height: DEFAULT_VARIABLE_HEIGHT / 2,
                    scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
                  }}
                  ref={inputVariableRef}
                  disabled={isDebuggerVisible}
                  readOnly={isDebuggerVisible}
                  onChange={onChangeHandler}
                  onFocus={onChangeHandler}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
                    if (e.key === 'Enter' && openAutocomplete) {
                      e.preventDefault()
                      autocompleteRef.current?.triggerSubmit?.()
                      inputVariableRef.current?.blur({ submit: false })
                      return
                    }
                    setKeyPressedAtTextarea(e.key)
                  }}
                  onKeyUp={() => setKeyPressedAtTextarea('')}
                />
              </div>
              {openAutocomplete && (
                <div className='absolute -bottom-2'>
                  <FBDBlockAutoComplete
                    ref={autocompleteRef}
                    block={block}
                    valueToSearch={variableValue}
                    isOpen={openAutocomplete}
                    setIsOpen={(value) => setOpenAutocomplete(value)}
                    keyPressed={keyPressedAtTextarea}
                  />
                </div>
              )}

              {isDebuggerVisible && isAVariable && (
                <DebugValueBadge
                  compositeKey={getCompositeKey(data.variable.name)}
                  variableType={variableType}
                  position={data.variant === 'output-variable' ? 'left' : 'right'}
                />
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
                            <p>Force Value</p>
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
          </TooltipTrigger>
          {inputError && (
            <TooltipContent>
              {errorDescription && (
                <div className='flex items-center justify-center text-xs'>
                  <span className='text-red-500'>{errorDescription}</span>
                </div>
              )}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

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
