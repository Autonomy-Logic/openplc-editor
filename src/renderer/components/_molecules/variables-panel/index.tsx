import * as Popover from '@radix-ui/react-popover'
import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'
import { TreeNode } from '@root/renderer/components/_atoms/debug-tree-node'
import { Label } from '@root/renderer/components/_atoms/label'
import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules/modal'
import { DebugTreeNode } from '@root/types/debugger'
import { cn } from '@root/utils'
import {
  floatToBuffer,
  getVariableTypeInfo,
  integerToBuffer,
  parseFloatValue,
  parseIntegerValue,
  parseStringValue,
  stringToBuffer,
} from '@root/utils/PLC/variable-types'
import { useCallback, useState } from 'react'

type Variable = {
  name: string
  type: string
  value?: string
  compositeKey: string
}

type VariablePanelProps = {
  variables?: Variable[]
  variableTree?: Map<string, DebugTreeNode>
  graphList?: string[]
  setGraphList: React.Dispatch<React.SetStateAction<string[]>>
  debugVariableValues?: Map<string, string>
  debugVariableIndexes?: Map<string, number>
  debugForcedVariables?: Map<string, boolean>
  debugExpandedNodes?: Map<string, boolean>
  onToggleExpandedNode?: (compositeKey: string) => void
  isDebuggerVisible?: boolean
  onForceVariable?: (
    compositeKey: string,
    variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ) => Promise<void>
}

const VariablesPanel = ({
  variables,
  variableTree,
  setGraphList,
  graphList,
  debugVariableValues,
  debugVariableIndexes,
  debugForcedVariables,
  debugExpandedNodes,
  onToggleExpandedNode,
  isDebuggerVisible,
  onForceVariable,
}: VariablePanelProps) => {
  const expandedNodes = debugExpandedNodes ?? new Map<string, boolean>()
  const [contextMenuState, setContextMenuState] = useState<{
    isOpen: boolean
    compositeKey: string
    lookupKey: string
    variableType: string
    position: { x: number; y: number }
  } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [forceValue, setForceValue] = useState<string>('')
  const [pendingForceContext, setPendingForceContext] = useState<{
    compositeKey: string
    lookupKey: string
    variableType: string
  } | null>(null)

  const getValue = (compositeKey: string): string | undefined => {
    return debugVariableValues?.get(compositeKey)
  }

  const toggleGraphVisibility = (variableName: string) => {
    setGraphList((prevGraphList) => {
      if (prevGraphList.includes(variableName)) {
        return prevGraphList.filter((name) => name !== variableName)
      } else {
        return [...prevGraphList, variableName]
      }
    })
  }

  const handleToggleExpand = (compositeKey: string) => {
    if (onToggleExpandedNode) {
      onToggleExpandedNode(compositeKey)
    }
  }

  const updateNodeExpansion = (node: DebugTreeNode): DebugTreeNode => {
    const isExpanded = expandedNodes.get(node.compositeKey) ?? false
    return {
      ...node,
      isExpanded,
      children: node.children?.map(updateNodeExpansion),
    }
  }

  const isViewingPredicate = useCallback(
    (compositeKey: string) => {
      return graphList?.includes(compositeKey) ?? false
    },
    [graphList],
  )

  const isForcedPredicate = useCallback(
    (compositeKey: string) => {
      return debugForcedVariables?.has(compositeKey) ?? false
    },
    [debugForcedVariables],
  )

  const getForcedValue = useCallback(
    (compositeKey: string) => {
      return debugForcedVariables?.get(compositeKey)
    },
    [debugForcedVariables],
  )

  const canForceVariable = useCallback(
    (node: DebugTreeNode) => {
      if (!isDebuggerVisible || node.isComplex) return false
      if (node.debugIndex !== undefined) return true
      return debugVariableIndexes?.has(node.fullPath) ?? debugVariableIndexes?.has(node.compositeKey) ?? false
    },
    [isDebuggerVisible, debugVariableIndexes],
  )

  const handleRowClick = useCallback(
    (node: DebugTreeNode, position: { x: number; y: number }) => {
      if (!canForceVariable(node)) return

      const lookupKey = node.debugIndex !== undefined ? node.fullPath : node.compositeKey

      setContextMenuState({
        isOpen: true,
        compositeKey: node.compositeKey,
        lookupKey,
        variableType: node.type,
        position,
      })
    },
    [canForceVariable],
  )

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuState(null)
  }, [])

  const handleForceTrue = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(contextMenuState.compositeKey, 'BOOL', true, undefined, contextMenuState.lookupKey)
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleForceFalse = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(contextMenuState.compositeKey, 'BOOL', false, undefined, contextMenuState.lookupKey)
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleReleaseForce = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (contextMenuState && onForceVariable) {
        void onForceVariable(
          contextMenuState.compositeKey,
          contextMenuState.variableType,
          undefined,
          undefined,
          contextMenuState.lookupKey,
        )
      }
      handleCloseContextMenu()
    },
    [contextMenuState, onForceVariable, handleCloseContextMenu],
  )

  const handleForceValue = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Save context before popover closes (popover auto-closes on click)
      if (contextMenuState) {
        setPendingForceContext({
          compositeKey: contextMenuState.compositeKey,
          lookupKey: contextMenuState.lookupKey,
          variableType: contextMenuState.variableType,
        })
      }
      setForceValueModalOpen(true)
    },
    [contextMenuState],
  )

  const handleForceValueConfirm = useCallback(() => {
    const closeModal = () => {
      setForceValueModalOpen(false)
      setForceValue('')
      setPendingForceContext(null)
    }

    if (!pendingForceContext || !forceValue.trim() || !onForceVariable) {
      closeModal()
      return
    }

    const variableType = pendingForceContext.variableType
    const typeInfo = getVariableTypeInfo(variableType)
    if (!typeInfo) {
      closeModal()
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
        closeModal()
        return
      }
      valueBuffer = stringToBuffer(parsedStringValue)
      forcedValueForState = true
    } else if (isFloatType) {
      const parsedFloatValue = parseFloatValue(forceValue, typeInfo.byteSize)
      if (parsedFloatValue === null) {
        closeModal()
        return
      }
      valueBuffer = floatToBuffer(parsedFloatValue, typeInfo.byteSize)
      forcedValueForState = parsedFloatValue >= 0
    } else {
      const parsedIntValue = parseIntegerValue(forceValue, typeInfo)
      if (parsedIntValue === null) {
        closeModal()
        return
      }
      valueBuffer = integerToBuffer(parsedIntValue, typeInfo.byteSize, typeInfo.signed)
      forcedValueForState = parsedIntValue >= BigInt(0)
    }

    void onForceVariable(
      pendingForceContext.compositeKey,
      variableType,
      forcedValueForState,
      valueBuffer,
      pendingForceContext.lookupKey,
    )

    closeModal()
  }, [pendingForceContext, forceValue, onForceVariable])

  const handleForceValueCancel = useCallback(() => {
    setForceValueModalOpen(false)
    setForceValue('')
    setPendingForceContext(null)
  }, [])

  const handleForceValueModalChange = useCallback((open: boolean) => {
    setForceValueModalOpen(open)
    if (!open) {
      setForceValue('')
      setPendingForceContext(null)
    }
  }, [])

  const renderTreeView = () => {
    if (!variableTree || variableTree.size === 0) return null

    const rootNodes = Array.from(variableTree.values()).map(updateNodeExpansion)

    return (
      <div className='flex h-full flex-col overflow-auto whitespace-nowrap'>
        {rootNodes.map((node) => (
          <TreeNode
            key={node.compositeKey}
            node={node}
            onToggleExpand={handleToggleExpand}
            onViewToggle={toggleGraphVisibility}
            isViewing={isViewingPredicate}
            getValue={getValue}
            isForced={isForcedPredicate}
            getForcedValue={getForcedValue}
            canForce={canForceVariable}
            onRowClick={handleRowClick}
          />
        ))}
      </div>
    )
  }

  const renderFlatView = () => {
    if (!variables || variables.length === 0) return null

    return (
      <div className='flex h-full flex-col gap-2 overflow-auto whitespace-nowrap'>
        {variables.map((variable) => {
          const isForced = isForcedPredicate(variable.compositeKey)
          const forcedValue = getForcedValue(variable.compositeKey)

          const nodeForFlat: DebugTreeNode = {
            name: variable.name,
            fullPath: variable.compositeKey,
            compositeKey: variable.compositeKey,
            type: variable.type,
            isComplex: false,
            debugIndex: debugVariableIndexes?.get(variable.compositeKey),
          }

          const canForce = canForceVariable(nodeForFlat)

          const textColor = isForced ? (forcedValue ? '#80C000' : '#4080FF') : undefined

          return (
            <div key={variable.compositeKey} className='flex h-auto w-full items-center gap-2'>
              <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                <ViewIcon
                  type='button'
                  className='h-4 w-4 cursor-pointer'
                  stroke={graphList?.includes(variable.compositeKey) ? '#7C3AED' : '#B4D0FE'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleGraphVisibility(variable.compositeKey)
                  }}
                />
              </div>
              <div
                className={`grid min-w-0 flex-1 grid-cols-[1fr_auto_auto] items-center gap-2 ${
                  canForce ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-850' : ''
                }`}
                onClick={(e) => {
                  if (canForce) {
                    handleRowClick(nodeForFlat, { x: e.clientX, y: e.clientY })
                  }
                }}
              >
                <div className='flex min-w-0 items-center gap-2'>
                  <p
                    className='truncate text-neutral-1000 dark:text-white'
                    style={{
                      color: textColor,
                      fontWeight: isForced ? 600 : undefined,
                    }}
                  >
                    {variable.name}
                  </p>
                </div>
                <p className='uppercase text-neutral-400 dark:text-neutral-700'>{variable.type}</p>
                <p
                  className='text-neutral-1000 dark:text-white'
                  style={{
                    color: textColor,
                    fontWeight: isForced ? 600 : undefined,
                  }}
                >
                  {variable.value || '0'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const isBoolVariable = contextMenuState?.variableType.toUpperCase() === 'BOOL'
  const isForced = contextMenuState ? isForcedPredicate(contextMenuState.compositeKey) : false

  return (
    <>
      <div className='flex h-full w-full min-w-52 flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
        <div className='flex h-7 w-[90px] select-none items-center gap-1 rounded-lg bg-neutral-100 p-1 text-cp-sm dark:bg-brand-dark'>
          <ZapIcon className='h-4 w-4' />
          <p>Variables</p>
        </div>
        {variableTree && variableTree.size > 0 ? renderTreeView() : renderFlatView()}
      </div>

      {isDebuggerVisible && contextMenuState && (
        <Popover.Root open={contextMenuState.isOpen} onOpenChange={(open) => !open && handleCloseContextMenu()}>
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
                left: `${contextMenuState.position.x}px`,
                top: `${contextMenuState.position.y}px`,
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

      <Modal open={forceValueModalOpen} onOpenChange={handleForceValueModalChange}>
        <ModalContent className='flex h-fit min-h-0 w-[400px] select-none flex-col items-center justify-start rounded-lg p-6'>
          <ModalTitle className='mb-4 text-lg font-semibold'>Force Value</ModalTitle>

          <p className='mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400'>
            Enter the value to force for {pendingForceContext?.compositeKey.split(':')[1] || 'this variable'}
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
    </>
  )
}

export { VariablesPanel }
