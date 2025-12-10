import * as Popover from '@radix-ui/react-popover'
import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
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
import { useEffect, useMemo, useRef, useState } from 'react'

import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { Label } from '../../label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockVariant } from '../types/block'
import { getVariableByName, validateVariableType } from '../utils'
import { FBDBlockAutoComplete } from './autocomplete'
import { BlockNode } from './block'
import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils/types'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input-variable' | 'output-variable' | 'inout-variable'
    negated: boolean
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input-variable' | 'output-variable' | 'inout-variable'
}

export const DEFAULT_VARIABLE_WIDTH = 112
export const DEFAULT_VARIABLE_HEIGHT = 32

export const ELEMENT_SIZE = 128
export const ELEMENT_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

export const Z_INDEX_DEBUGGER_VARIABLE = 10

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
    workspace: {
      isDebuggerVisible,
      debugVariableIndexes,
      debugVariableValues,
      debugForcedVariables,
      fbSelectedInstance,
      fbDebugInstances,
    },
    workspaceActions: { setDebugForcedVariables },
  } = useOpenPLCStore()

  // Helper to get composite key with FB instance context
  const getCompositeKey = (variableName: string): string => {
    const currentPou = pous.find((p) => p.data.name === editor.meta.name)
    if (currentPou?.type === 'function-block') {
      const fbTypeKey = currentPou.data.name.toUpperCase()
      const selectedKey = fbSelectedInstance.get(fbTypeKey)
      if (selectedKey) {
        const instances = fbDebugInstances.get(fbTypeKey) || []
        const selectedInstance = instances.find((inst) => inst.key === selectedKey)
        if (selectedInstance) {
          return `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${variableName}`
        }
      }
    }
    return `${editor.meta.name}:${variableName}`
  }

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

  const [variableValue, setVariableValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)
  const [errorDescription, setErrorDescription] = useState<string>('')
  const [isAVariable, setIsAVariable] = useState<boolean>(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [forceValue, setForceValue] = useState<string>('')

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
    const { node: variableNode, variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
      variableName: data.variable.name,
    })
    if (!variableNode) return

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      const nodeVariableName = (variableNode as VariableNode).data.variable.name

      if (variable.name.toLowerCase() !== nodeVariableName.toLowerCase()) {
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

      if (variable.name.toLowerCase() === nodeVariableName.toLowerCase() && variable.name !== nodeVariableName) {
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

      setVariableValue(variable.name)
      setInputError(!isValid)
      setIsAVariable(true)
    }

    if (!connections.length) {
      setErrorDescription('Variable not connected')
      setInputError(true)
      return
    }
  }, [pous, data.variable.name])

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

    let variable: PLCVariable | { name: string } | undefined = getVariableByName(
      pou.data.variables as PLCVariable[],
      variableNameToSubmit,
    )
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

  const getVariableType = (): string | undefined => {
    if (!data.variable || !data.variable.name) return undefined
    const { pou } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, { nodeId: id })
    if (!pou) return undefined
    const variable = pou.data.variables.find((v) => v.name.toLowerCase() === data.variable.name.toLowerCase())
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
      const forcedValue = debugForcedVariables.get(compositeKey)
      return forcedValue ? '#80C000' : '#4080FF'
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

    const compositeKey = getCompositeKey(data.variable.name)
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

    const compositeKey = getCompositeKey(data.variable.name)
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
    // forcedValueForState is used for visual feedback (green/blue color indicator) in the UI.
    // For non-BOOL types, we use a simple heuristic: positive values = true (green), negative = false (blue).
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

  const compositeKeyForForced = getCompositeKey(data.variable.name)
  const isForced = debugForcedVariables.has(compositeKeyForForced)
  const forcedValue = debugForcedVariables.get(compositeKeyForForced)

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          {/* asChild prop is required to prevent TooltipTrigger from intercepting click events during diagram locking. (important-comment) */}
          {/* Without asChild, the context menu cannot be opened when nodes are locked (draggable/selectable=false). (important-comment) */}
          <TooltipTrigger asChild>
            <div
              style={{
                width: ELEMENT_SIZE,
                height: ELEMENT_HEIGHT,
                ...(debuggerColor
                  ? {
                      borderColor: debuggerColor,
                      boxShadow: `0 0 0 2px ${debuggerColor}33 inset`,
                    }
                  : {}),
                ...(isDebuggerVisible
                  ? {
                      pointerEvents: 'auto' as const,
                      zIndex: Z_INDEX_DEBUGGER_VARIABLE,
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
                    'text-[#80C000]': isForced && forcedValue,
                    'text-[#4080FF]': isForced && !forcedValue,
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
                    if (e.key === 'Enter' && autocompleteRef.current?.selectedVariable.positionInArray !== -1) {
                      inputVariableRef.current?.blur({ submit: false })
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
                            onClick={(e) => void handleForceValue(e)}
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
        <CustomHandle key={index} {...handle} isDebuggerVisible={isDebuggerVisible} />
      ))}
    </>
  )
}

const buildVariableNode = ({ id, position, variant }: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'input-variable',
          position: Position.Left,
          type: 'target',
          glbX: position.x,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'output-variable',
          position: Position.Right,
          type: 'source',
          glbX: position.x + DEFAULT_VARIABLE_CONNECTOR_X,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: DEFAULT_VARIABLE_CONNECTOR_X,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: variant,
    position,
    width: ELEMENT_SIZE,
    height: ELEMENT_HEIGHT,
    measured: {
      width: ELEMENT_SIZE,
      height: ELEMENT_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { name: '' },
      executionOrder: 0,
      variant,
      negated: false,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    deletable: true,
    selectable: true,
    draggable: true,
    selected: true,
  }
}

export { buildVariableNode, VariableElement }
