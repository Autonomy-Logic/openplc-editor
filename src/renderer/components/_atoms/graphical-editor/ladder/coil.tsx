import { useDebugCompositeKey } from '@hooks/use-debug-composite-key'
import * as Popover from '@radix-ui/react-popover'
import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { VariablesBlockAutoComplete } from './autocomplete'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'

export type CoilNode = Node<
  BasicNodeData & {
    variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
  }
>
type CoilProps = NodeProps<CoilNode>
type CoilBuilderProps = BuilderBasicProps & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
}

export const DEFAULT_COIL_BLOCK_WIDTH = 28
export const DEFAULT_COIL_BLOCK_HEIGHT = 24

export const DEFAULT_COIL_CONNECTOR_X = DEFAULT_COIL_BLOCK_WIDTH
export const DEFAULT_COIL_CONNECTOR_Y = DEFAULT_COIL_BLOCK_HEIGHT / 2

type CoilType = {
  [key in CoilNode['data']['variant']]: {
    svg: (wrongVariable: boolean, debuggerColor?: string) => ReactNode
  }
}
export const DEFAULT_COIL_TYPES: CoilType = {
  default: {
    svg: (wrongVariable, debuggerColor) => (
      <DefaultCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  negated: {
    svg: (wrongVariable, debuggerColor) => (
      <NegatedCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  risingEdge: {
    svg: (wrongVariable, debuggerColor) => (
      <RisingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  fallingEdge: {
    svg: (wrongVariable, debuggerColor) => (
      <FallingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  set: {
    svg: (wrongVariable, debuggerColor) => (
      <SetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
  reset: {
    svg: (wrongVariable, debuggerColor) => (
      <ResetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
        parenthesesColor={debuggerColor}
      />
    ),
  },
}

export const Coil = (block: CoilProps) => {
  const { selected, data, id } = block

  const {
    editor,
    project: {
      data: { pous },
    },
    ladderFlows,
    ladderFlowActions: { updateNode },
    workspace: { isDebuggerVisible, debugVariableValues, debugVariableIndexes, debugForcedVariables },
    workspaceActions: { setDebugForcedVariables },
  } = useOpenPLCStore()
  const getCompositeKey = useDebugCompositeKey()

  const coil = DEFAULT_COIL_TYPES[data.variant]
  const [coilVariableValue, setCoilVariableValue] = useState<string>(data.variable.name)
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const getDebuggerFillColor = (): string | undefined => {
    if (!isDebuggerVisible || !data.variable.name || wrongVariable) {
      return undefined
    }

    const compositeKey = getCompositeKey(data.variable.name)
    const isForced = debugForcedVariables.has(compositeKey)

    // When forced, use immediate value from debugForcedVariables (no 200ms poll delay)
    const value = isForced
      ? debugForcedVariables.get(compositeKey)
        ? '1'
        : '0'
      : debugVariableValues.get(compositeKey)

    if (value === undefined) {
      return undefined
    }

    const isTrue = value === '1' || value.toUpperCase() === 'TRUE'
    const displayState = data.variant === 'negated' ? !isTrue : isTrue

    if (isForced) {
      return displayState ? '#80C000' : '#4080FF'
    }

    return displayState ? '#00FF00' : '#0464FB'
  }

  const debuggerFillColor = getDebuggerFillColor()

  const inputWrapperRef = useRef<HTMLDivElement>(null)
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
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (inputVariableRef.current && inputWrapperRef.current) {
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-24px' : '-20px'
    }
  }, [coilVariableValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setCoilVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current && selected) {
      inputVariableRef.current.focus()
    }
  }, [])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    const { variables, node, rung } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
      variableName: data.variable.name,
    })

    if (!rung || !node) return

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }

    const nodeVariableName = (node.data as BasicNodeData).variable.name
    if (nodeVariableName.toLowerCase() !== variable.name.toLowerCase()) {
      setCoilVariableValue(variable.name)
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

    if (nodeVariableName.toLowerCase() === variable.name.toLowerCase() && variable.name !== coilVariableValue) {
      if (nodeVariableName !== variable.name) {
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: {
                ...variable,
                name: variable.name,
              },
            },
          },
        })
      }
      setCoilVariableValue(variable.name)
      setWrongVariable(false)
      return
    }

    setWrongVariable(false)
  }, [pous, data.variable.name])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitCoilVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || coilVariableValue
    const { variables, rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
      variableName: variableNameToSubmit,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (
      !variable ||
      variable.name !== variableNameToSubmit ||
      variable.type.definition !== 'base-type' ||
      variable.type.value.toUpperCase() !== 'BOOL'
    ) {
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: { name: variableNameToSubmit },
          },
        },
      })
      setWrongVariable(true)
      return
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: node.id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: variable,
        },
      },
    })
    setWrongVariable(false)
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

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

  const handleClick = (e: React.MouseEvent) => {
    if (!isDebuggerVisible) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  return (
    <div
      className={cn({
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <div
        className={cn(
          'relative rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[3px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[3px] outline-brand': selected,
          },
        )}
        style={{ width: DEFAULT_COIL_BLOCK_WIDTH, height: DEFAULT_COIL_BLOCK_HEIGHT }}
        onClick={isDebuggerVisible ? handleClick : undefined}
      >
        {coil.svg(wrongVariable, debuggerFillColor)}
        <div className='absolute left-1/2 w-[72px] -translate-x-1/2' ref={inputWrapperRef}>
          <HighlightedTextArea
            id={`coil-variable-input-${id}`}
            textAreaValue={coilVariableValue}
            setTextAreaValue={setCoilVariableValue}
            handleSubmit={handleSubmitCoilVariableOnTextareaBlur}
            inputHeight={{
              height: 24,
              scrollLimiter: 32,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
            disabled={isDebuggerVisible}
            readOnly={isDebuggerVisible}
            onFocus={(e) => {
              e.target.select()
              const { node, rung } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
                nodeId: id ?? '',
              })
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
              const { node, rung } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
                nodeId: id ?? '',
              })
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
            onChange={onChangeHandler}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
              if (e.key === 'Enter' && openAutocomplete) {
                e.preventDefault()
                // Call triggerSubmit synchronously before blur to avoid race condition
                // where autocomplete unmounts before processing the Enter key
                autocompleteRef.current?.triggerSubmit?.()
                inputVariableRef.current?.blur({ submit: false })
                return
              }
              setKeyPressedAtTextarea(e.key)
            }}
            onKeyUp={() => setKeyPressedAtTextarea('')}
          />
          {openAutocomplete && (
            <div className='relative flex justify-center'>
              <div className='absolute -bottom-4'>
                <VariablesBlockAutoComplete
                  ref={autocompleteRef}
                  block={block}
                  blockType={'coil'}
                  valueToSearch={coilVariableValue}
                  isOpen={openAutocomplete}
                  setIsOpen={(value) => setOpenAutocomplete(value)}
                  keyPressed={keyPressedAtTextarea}
                />
              </div>
            </div>
          )}
        </div>

        {isDebuggerVisible &&
          contextMenuPosition &&
          (() => {
            const compositeKey = getCompositeKey(data.variable.name)
            const isForced = debugForcedVariables.has(compositeKey)

            return (
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
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )
          })()}
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
}

export const buildCoilNode = ({ id, posX, posY, handleX, handleY, variant }: CoilBuilderProps) => {
  const inputHandle = buildHandle({
    id: 'input',
    position: Position.Left,
    isConnectable: false,
    type: 'target',
    glbX: handleX,
    glbY: handleY,
    relX: 0,
    relY: DEFAULT_COIL_CONNECTOR_Y,
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    isConnectable: false,
    type: 'source',
    glbX: handleX + DEFAULT_COIL_BLOCK_WIDTH,
    glbY: handleY,
    relX: DEFAULT_COIL_BLOCK_WIDTH,
    relY: DEFAULT_COIL_CONNECTOR_Y,
    style: { right: -3 },
  })
  const handles = [inputHandle, outputHandle]

  return {
    id,
    type: 'coil',
    position: { x: posX, y: posY },
    data: {
      handles,
      variant,
      inputHandles: [inputHandle],
      outputHandles: [outputHandle],
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width: DEFAULT_COIL_BLOCK_WIDTH,
    height: DEFAULT_COIL_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_COIL_BLOCK_WIDTH,
      height: DEFAULT_COIL_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: true,
  }
}
