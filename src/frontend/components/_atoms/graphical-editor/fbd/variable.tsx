import * as Popover from '@radix-ui/react-popover'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useDebugValue, useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { forceDebugVariable, releaseDebugVariable } from '../../../../services/debug-force-variable'
import { resolveScopeExpressionType } from '../../../../services/graphical-scope'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { resolveArrayVariableByName } from '../../../../utils/PLC/array-variable-utils'
import {
  floatToBuffer,
  getVariableTypeInfo,
  integerToBuffer,
  parseFloatValue,
  parseIntegerValue,
  parseStringValue,
  stringToBuffer,
} from '../../../../utils/variable-types'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
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
  const pouName = useBoundPou()
  const {
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const debugger_ = useDebugger()
  const isDebuggerVisible = useIsDebuggerVisible()
  const getCompositeKey = useDebugCompositeKey()
  const compositeKey = getCompositeKey(data.variable.name)
  const { value: debugValue, isForced, forcedValue: forcedBoolValue, debugIndex } = useDebugValue(compositeKey)

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

  /**
   * Get the connection type
   */
  const flow = useMemo(() => fbdFlows.find((flow) => flow.name === pouName), [fbdFlows, pouName])

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
   * useEffect to initialize the variable value when the component mounts
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setVariableValue(data.variable.name)
      return
    }
  }, [])

  /**
   * useEffect to sync variableValue from node props when the variable name changes externally
   * (e.g., from autocomplete selection or variable rename propagation).
   * Only sync when autocomplete is closed to avoid overwriting user input while typing.
   * Note: openAutocomplete is intentionally NOT in the dependency array to prevent a race
   * condition where closing the autocomplete (before blur) would restore the old node value,
   * overwriting the user's cleared input.
   */
  useEffect(() => {
    const name = data.variable?.name ?? ''
    if (!openAutocomplete && name !== '') {
      setVariableValue(name)
    }
  }, [data.variable?.name])

  /**
   * Validate the variable node against its connected block pins via the
   * STruC++ LSP. The typed value may be an instance member or struct/array
   * access the local interface list can't resolve; `isAVariable` (yellow)
   * means "not a known symbol", `inputError` (red) means "known but
   * incompatible with a connection". Re-runs when the project variables or
   * the node's own variable name change.
   */
  useEffect(() => {
    const name = data.variable?.name?.trim() ?? ''
    if (!name) {
      setIsAVariable(false)
      setInputError(false)
      setErrorDescription('')
      return
    }
    let cancelled = false
    void resolveScopeExpressionType(pouName, name).then((res) => {
      if (cancelled) return
      // Leave state untouched while the LSP warms so we never flash a false flag.
      if (res.status === 'unavailable') return
      if (res.status === 'unknown') {
        setIsAVariable(false)
        setInputError(false)
        setErrorDescription('')
        return
      }
      setIsAVariable(true)

      // No connections → nothing to type-check against.
      if (!connections.length) {
        setInputError(false)
        setErrorDescription('')
        return
      }

      const resolvedType = res.type
      const isValid = allConnectionsType.every(
        (connection) => validateVariableType(resolvedType, connection.variable).isValid,
      )
      setInputError(!isValid)
      if (!isValid) {
        const validWithPrimaryConnection = validateVariableType(resolvedType, primaryConnectionType.variable).isValid
        setErrorDescription(
          validWithPrimaryConnection
            ? `Variable type ${resolvedType} is not compatible with one or more connections: ${allConnectionsType
                .map((connection) => connection.variable.name)
                .join(', ')}`
            : `Variable type ${resolvedType} is not compatible with ${primaryConnectionType.variable.name}`,
        )
      } else {
        setErrorDescription('')
      }
    })
    return () => {
      cancelled = true
    }
    // `connections`/`allConnectionsType`/`primaryConnectionType` are read from
    // the latest render via closure; keeping them out of the dep array avoids
    // re-run storms from their changing object identity (which would flood the
    // single-threaded LSP worker).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pous, pouName, data.variable?.name])

  const getVariableType = (): string | undefined => {
    if (!data.variable || !data.variable.name) return undefined
    const { pou } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, { nodeId: id })
    if (!pou) return undefined
    const variable = (pou.interface?.variables ?? []).find(
      (v: PLCVariable) => v.name.toLowerCase() === data.variable.name.toLowerCase(),
    )
    return variable?.type.value
  }

  const debuggerColor = (() => {
    if (!isDebuggerVisible || !data.variable.name || !isAVariable) return undefined
    const vType = getVariableType()
    if (!vType || vType.toUpperCase() !== 'BOOL') return undefined
    if (isForced) return forcedBoolValue ? '#80C000' : '#4080FF'
    if (debugValue === undefined) return undefined
    const isTrue = debugValue === '1' || debugValue.toUpperCase() === 'TRUE'
    return isTrue ? '#00FF00' : '#0464FB'
  })()

  const handleForceTrue = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name) await forceDebugVariable(debugger_, compositeKey, debugIndex, new Uint8Array([1]), true)
  }

  const handleForceFalse = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name) await forceDebugVariable(debugger_, compositeKey, debugIndex, new Uint8Array([0]), false)
  }

  const handleReleaseForce = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name) await releaseDebugVariable(debugger_, compositeKey, debugIndex)
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

    if (debugIndex === undefined) {
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

    await forceDebugVariable(debugger_, compositeKey, debugIndex, valueBuffer, forcedValueForState, varType)

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

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || variableValue

    const { pou, rung, node } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    // Persist the typed value: enrich with the local variable (carrying its
    // type) when it's a plain local/array reference, otherwise store the raw
    // name (e.g. an instance member like `TON0.Q`). The validation effect
    // resolves and type-checks it against the full project scope.
    const variable: PLCVariable | { name: string } = (pou.interface?.variables ?? []).find(
      (v) => v.name.toLowerCase() === variableNameToSubmit.toLowerCase(),
    ) ||
      resolveArrayVariableByName(pou.interface?.variables ?? [], variableNameToSubmit) || {
        name: variableNameToSubmit,
      }

    updateNode({
      editorName: pouName,
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
                    'text-[#80C000]': isForced && forcedBoolValue,
                    'text-[#4080FF]': isForced && !forcedBoolValue,
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
                  compositeKey={compositeKey}
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
