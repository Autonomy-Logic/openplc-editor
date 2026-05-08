import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState } from 'react'

import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useDebugValue, useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { forceDebugVariable, releaseDebugVariable } from '../../../../services/debug-force-variable'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { VariablesBlockAutoComplete } from './autocomplete'
import { CustomHandle } from './handle'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'
import { DEFAULT_CONTACT_BLOCK_HEIGHT, DEFAULT_CONTACT_BLOCK_WIDTH, DEFAULT_CONTACT_TYPES } from './utils/constants'
import type { BasicNodeData, ContactProps } from './utils/types'

export type { ContactNode } from './utils/types'

export const Contact = (block: ContactProps) => {
  const { selected, data, id } = block
  const {
    editor,
    project: {
      data: { pous },
    },
    ladderFlows,
    ladderFlowActions: { updateNode },
  } = useOpenPLCStore()

  const debugger_ = useDebugger()
  const isDebuggerVisible = useIsDebuggerVisible()
  const getCompositeKey = useDebugCompositeKey()
  const compositeKey = getCompositeKey(data.variable.name)
  const { value: debugValue, isForced, forcedValue, debugIndex } = useDebugValue(compositeKey)

  const contact = DEFAULT_CONTACT_TYPES[data.variant]
  const [contactVariableValue, setContactVariableValue] = useState<string>(data.variable.name)
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

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
      triggerSubmit: () => void
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  useEffect(() => {
    if (inputVariableRef.current && inputWrapperRef.current) {
      // top
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-24px' : '-20px'
    }
  }, [contactVariableValue])

  /**
   * useEffect to sync contactVariableValue with data.variable.name when it changes externally
   * (e.g., from variable rename propagation)
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setContactVariableValue(data.variable.name)
    }
  }, [data.variable.name])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (inputVariableRef.current && selected) {
      inputVariableRef.current.focus()
    }
  }, [])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    const {
      node: contactNode,
      rung,
      variables,
    } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
      nodeId: id,
    })
    if (!rung || !contactNode) return

    const canonicalVariableName = (contactNode.data as BasicNodeData).variable?.name?.trim() ?? ''

    const variable = variables.all.find(
      (v) => v.name.toLowerCase() === canonicalVariableName.toLowerCase() && v.type.definition !== 'derived',
    )

    if (!variable) {
      setWrongVariable(true)
      return
    }
    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }

    if ((contactNode.data as BasicNodeData).variable.name.toLowerCase() !== variable.name.toLowerCase()) {
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: contactNode.id,
        node: {
          ...contactNode,
          data: {
            ...contactNode.data,
            variable,
          },
        },
      })
      setContactVariableValue(variable.name)
      setWrongVariable(false)
      return
    }

    setWrongVariable(false)
  }, [pous])

  const debuggerStrokeColor = (() => {
    if (!isDebuggerVisible || !data.variable.name || wrongVariable) return undefined
    if (debugValue === undefined) return undefined

    const isTrue = debugValue === '1' || debugValue.toUpperCase() === 'TRUE'
    const displayState = data.variant === 'negated' ? !isTrue : isTrue

    if (isForced) return forcedValue ? '#80C000' : '#4080FF'
    return displayState ? '#00FF00' : '#0464FB'
  })()

  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)

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

  const handleClick = (e: React.MouseEvent) => {
    if (!isDebuggerVisible) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
    setIsContextMenuOpen(true)
  }

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitContactVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || contactVariableValue
    const { rung, node, variables } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
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
          variable,
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
        style={{ width: DEFAULT_CONTACT_BLOCK_WIDTH, height: DEFAULT_CONTACT_BLOCK_HEIGHT }}
        onClick={isDebuggerVisible ? handleClick : undefined}
      >
        {contact.svg(wrongVariable, debuggerStrokeColor)}
        <div className='absolute left-1/2 w-[72px] -translate-x-1/2' ref={inputWrapperRef}>
          <HighlightedTextArea
            id={`contact-variable-input-${id}`}
            textAreaValue={contactVariableValue}
            setTextAreaValue={setContactVariableValue}
            handleSubmit={handleSubmitContactVariableOnTextareaBlur}
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
                  draggable: node.data.draggable,
                },
              })
              return
            }}
            onChange={onChangeHandler}
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
          {openAutocomplete && (
            <div className='relative flex justify-center'>
              <div className='absolute -bottom-4'>
                <VariablesBlockAutoComplete
                  ref={autocompleteRef}
                  block={block}
                  blockType={'contact'}
                  valueToSearch={contactVariableValue}
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
