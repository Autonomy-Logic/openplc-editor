import * as Popover from '@radix-ui/react-popover'
import { EMPTY_NAME_PLACEHOLDER, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout'
import { memo, useEffect, useRef, useState } from 'react'

import { PLCVariable } from '../../../../../middleware/shared/ports'
import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useDebugValue, useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { forceDebugVariable, releaseDebugVariable } from '../../../../services/debug-force-variable'
import { resolveScopeExpressionType } from '../../../../services/graphical-scope'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../store'
import { RungLadderState } from '../../../../store/slices/ladder'
import { cn } from '../../../../utils/cn'
import { getLiteralType } from '../../../../utils/keywords'
import { encodeForceValue, isForcedValueHigh } from '../../../../utils/variable-sizes'
import { toast } from '../../../_features/[app]/toast/use-toast'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { Modal, ModalContent, ModalTitle } from '../../../_molecules/modal'
import { Label } from '../../label'
import { DebugValueBadge } from '../debug-value-badge'
import { VariablesBlockAutoComplete } from './autocomplete'
import { CustomHandle, ladderHandleStyle } from './handle'
import { LadderNameField } from './ladder-text'
import { LADDER_ERROR_COLOUR, LADDER_FORCED_COLOURS, useLadderNodeView } from './rung-view'
import { getLadderPouVariablesRungNodeAndEdges, validateVariableType } from './utils'
import { DEFAULT_VARIABLE_HEIGHT, DEFAULT_VARIABLE_WIDTH } from './utils/constants'
import { BlockNodeData, BlockVariant, LadderBlockConnectedVariables, VariableNode, VariableProps } from './utils/types'
import { LadderPinVariableVisual } from './variable-visual'

const VariableElement = (block: VariableProps) => {
  const store = useOpenPLCStoreApi()
  const { id, data, width, height } = block
  const pouName = useBoundPou()
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const updateNode = useOpenPLCStore((state) => state.ladderFlowActions.updateNode)
  const debugger_ = useDebugger()
  const isDebuggerVisible = useIsDebuggerVisible()
  const getCompositeKey = useDebugCompositeKey()
  const compositeKey = getCompositeKey(data.variable.name)
  const { isForced, forcedValue: forcedBoolValue, debugIndex } = useDebugValue(compositeKey)

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
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [forceValueModalOpen, setForceValueModalOpen] = useState<boolean>(false)
  const [forceValue, setForceValue] = useState<string>('')

  const [variableValue, setVariableValue] = useState(data.variable.name)
  const [editing, setEditing] = useState<boolean>(false)
  const { palette } = useLadderNodeView(id)
  const placeholder = `(*${data.block.variableType.type.value}*)`
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  const updateRelatedNode = (rung: RungLadderState, variableNode: VariableNode, variable: PLCVariable) => {
    const relatedBlock = rung.nodes.find((node) => node.id === variableNode.data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }

    const existing = Array.isArray((relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables)
      ? (relatedBlock.data as BlockNodeData<BlockVariant>).connectedVariables
      : []
    const connectedVariables: LadderBlockConnectedVariables = [
      ...existing.filter(
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
      editorName: pouName,
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
   * (e.g., from variable rename propagation or autocomplete selection).
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
   * Validate the variable node against the block pin's expected type via the
   * STruC++ LSP. The pin type may be a generic (ANY_NUM, …) and the typed
   * value may be an instance member or struct/array access the local
   * interface list can't resolve. `isAVariable` (yellow) means "not a known
   * symbol"; `inputError` (red) means "known but type-incompatible".
   */
  useEffect(() => {
    const name = data.variable?.name?.trim() ?? ''
    if (!name) {
      setIsAVariable(false)
      setInputError(false)
      return
    }
    let cancelled = false
    void resolveScopeExpressionType(pouName, name).then((res) => {
      if (cancelled) return
      // Leave the current state untouched while the LSP is still warming so
      // we never flash a false error/warning during boot.
      if (res.status === 'unavailable') return
      if (res.status === 'unknown') {
        setIsAVariable(false)
        setInputError(false)
        return
      }
      setIsAVariable(true)
      setInputError(!validateVariableType(res.type, data.block.variableType).isValid)
    })
    return () => {
      cancelled = true
    }
  }, [pous, pouName, data.variable?.name, data.block.variableType.type.value])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (currentValue?: string) => {
    const variableNameToSubmit = currentValue ?? variableValue

    const { project, ladderFlows } = store.getState()
    const { pou, rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    // Allow clearing a variable from a block handle by submitting an empty name.
    // This resets the variable node so a branch (contacts/coils) can be placed instead.
    if (!variableNameToSubmit.trim()) {
      const emptyVariable = { id: '', name: '' }
      setVariableValue('')
      setIsAVariable(false)
      setInputError(false)
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: variableNode.id,
        node: {
          ...variableNode,
          data: {
            ...variableNode.data,
            variable: emptyVariable,
          },
        },
      })
      updateRelatedNode(rung, variableNode, emptyVariable as PLCVariable)
      return
    }

    // For variable nodes (block pins), allow all types including derived (user-defined types)
    // Don't use getVariableByName here as it filters out derived types
    let variable: PLCVariable | { name: string } | undefined = (pou.interface?.variables ?? []).find(
      (v) => v.name.toLowerCase() === variableNameToSubmit.toLowerCase(),
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
      editorName: pouName,
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
    const pou = pous.find((pou) => pou.name === pouName)
    if (!pou) return undefined
    const variable = (pou.interface?.variables ?? []).find(
      (v) => v.name.toLowerCase() === data.variable.name.toLowerCase(),
    )
    return variable?.type.value
  }

  const handleForceTrue = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name)
      await forceDebugVariable(store, debugger_, compositeKey, debugIndex, new Uint8Array([1]), true)
  }

  const handleForceFalse = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name)
      await forceDebugVariable(store, debugger_, compositeKey, debugIndex, new Uint8Array([0]), false)
  }

  const handleReleaseForce = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name) await releaseDebugVariable(store, debugger_, compositeKey, debugIndex)
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

    if (debugIndex === undefined) {
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

    let valueBuffer: Uint8Array
    try {
      valueBuffer = encodeForceValue(forceValue, variableType)
    } catch (error) {
      toast({
        title: 'Cannot force value',
        description: error instanceof Error ? error.message : String(error),
        variant: 'fail',
      })
      setForceValueModalOpen(false)
      setForceValue('')
      return
    }

    await forceDebugVariable(
      store,
      debugger_,
      compositeKey,
      debugIndex,
      valueBuffer,
      isForcedValueHigh(forceValue),
      variableType,
    )

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

  const nameFill = (() => {
    if (isForced) return forcedBoolValue ? LADDER_FORCED_COLOURS.high : LADDER_FORCED_COLOURS.low
    if (inputError) return LADDER_ERROR_COLOUR
    return isAVariable ? palette.text : palette.literal
  })()

  return (
    <>
      <div
        className='relative'
        style={{ width: width ?? DEFAULT_VARIABLE_WIDTH, height: height ?? DEFAULT_VARIABLE_HEIGHT }}
        onClick={isDebuggerVisible ? handleClick : undefined}
      >
        <LadderPinVariableVisual
          nodeId={id}
          side={data.variant}
          variableName={data.variable.name}
          placeholder={EMPTY_NAME_PLACEHOLDER}
          width={width ?? DEFAULT_VARIABLE_WIDTH}
          badge={
            isDebuggerVisible && isAVariable ? (
              <DebugValueBadge
                compositeKey={compositeKey}
                variableType={variableType}
                position={data.variant === 'output' ? 'right' : 'left'}
              />
            ) : undefined
          }
          nameSlot={(label) => (
            <LadderNameField
              label={label}
              text={data.variable.name}
              testId={`ld-name-${id}`}
              palette={palette}
              fill={nameFill}
              hint={placeholder}
              placeholderOnHover
              fontWeight={isForced ? LADDER_TYPOGRAPHY.semiboldWeight : undefined}
              editable={!isDebuggerVisible}
              editing={editing}
              onEditingChange={setEditing}
              value={variableValue}
              onValueChange={(value) => {
                setVariableValue(value)
                if (editing) onChangeHandler()
              }}
              onCommit={handleSubmitVariableValueOnTextareaBlur}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
                if (e.key === 'Enter' && openAutocomplete) {
                  e.preventDefault()
                  autocompleteRef.current?.triggerSubmit?.()
                  return true
                }
                setKeyPressedAtTextarea(e.key)
                return false
              }}
              onKeyUp={() => setKeyPressedAtTextarea('')}
            >
              {openAutocomplete ? (
                <VariablesBlockAutoComplete
                  ref={autocompleteRef}
                  block={block}
                  blockType={'variable'}
                  valueToSearch={variableValue}
                  isOpen={openAutocomplete}
                  setIsOpen={(value) => setOpenAutocomplete(value)}
                  keyPressed={keyPressedAtTextarea}
                />
              ) : undefined}
            </LadderNameField>
          )}
        />

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
        <CustomHandle key={index} {...handle} style={ladderHandleStyle(handle)} />
      ))}
    </>
  )
}

const exportVariableElement = memo(VariableElement)

export { exportVariableElement as VariableElement }
