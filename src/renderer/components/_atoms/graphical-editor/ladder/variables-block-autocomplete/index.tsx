import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { extractNumberAtEnd } from '@root/renderer/store/slices/project/validation/variables'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { BlockNodeData } from '../block'
import { getPouVariablesRungNodeAndEdges, getVariableRestrictionType } from '../utils'
import { BasicNodeData } from '../utils/types'
import { VariableNode } from '../variable'

type VariablesBlockAutoCompleteProps = ComponentPropsWithRef<'div'> & {
  block: unknown
  blockType?: 'variable' | 'coil' | 'contact' | 'block' | 'other'
  isOpen?: boolean
  setIsOpen?: (isOpen: boolean) => void
  keyPressed?: string
  valueToSearch: string
}

const blockTypeRestrictions = (block: unknown, blockType: VariablesBlockAutoCompleteProps['blockType']) => {
  switch (blockType) {
    case 'contact':
      return {
        values: ['bool'],
        definition: 'base-type',
        limitations: ['derived'],
      }
    case 'variable': {
      const variableType = (block as VariableNode).data.block.variableType.type
      const restriction = getVariableRestrictionType(variableType.value)
      return {
        ...restriction,
        limitations: ['derived'],
      }
    }
    case 'coil':
      return {
        values: ['bool'],
        definition: 'base-type',
        limitations: ['derived'],
      }
    default:
      return {
        values: undefined,
        definition: undefined,
        limitations: undefined,
      }
  }
}

const VariablesBlockAutoComplete = forwardRef<HTMLDivElement, VariablesBlockAutoCompleteProps>(
  (
    {
      block,
      blockType = 'other',
      isOpen,
      setIsOpen,
      keyPressed,
      onFocus: focusEvent,
      valueToSearch,
    }: VariablesBlockAutoCompleteProps,
    ref,
  ) => {
    const {
      editor,
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      ladderFlows,
      ladderFlowActions: { updateNode },
    } = useOpenPLCStore()

    const popoverRef = useRef<HTMLDivElement>(null)
    const [autocompleteFocus, setAutocompleteFocus] = useState<boolean>(false)
    const [keyDown, setKeyDown] = useState<string>('')

    const pou = pous.find((pou) => pou.data.name === editor.meta.name)
    const variables = pou?.data.variables || []
    const variableRestrictions = blockTypeRestrictions(block, blockType)

    const filteredDivRef = useRef<HTMLDivElement>(null)
    const filteredVariables =
      blockType !== 'block'
        ? variables
            .filter(
              (variable) =>
                variable.name.toLowerCase().includes(valueToSearch.toLowerCase()) &&
                (variableRestrictions.values === undefined ||
                  variableRestrictions.values.includes(variable.type.value.toLowerCase())) &&
                (variableRestrictions.limitations === undefined ||
                  !variableRestrictions.limitations.includes(variable.type.definition)),
            )
            .sort((a, b) => {
              const aNumber = extractNumberAtEnd(a.name).number
              const bNumber = extractNumberAtEnd(b.name).number
              if (aNumber === bNumber) {
                return a.name.localeCompare(b.name)
              }
              return aNumber - bNumber
            })
        : []

    const [selectedVariable, setSelectedVariable] = useState<{ positionInArray: number; variableName: string }>({
      positionInArray: -1,
      variableName: '',
    })
    const selectableValues = [
      ...filteredVariables.map((variable) => ({
        type: 'variable',
        value: variable.name,
      })),
      {
        type: 'add',
        value: valueToSearch,
      },
    ].filter((variable) => variable !== undefined)

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          popoverRef.current?.focus()
        },
        isFocused: autocompleteFocus,
        selectedVariable: selectedVariable,
      }
    }, [selectedVariable, popoverRef, autocompleteFocus])

    useEffect(() => {
      switch (keyDown) {
        case 'ArrowDown':
          setSelectedVariable((prev) => {
            const newPosition = prev.positionInArray + 1
            if (newPosition >= selectableValues.length) {
              return prev
            }
            return {
              positionInArray: newPosition,
              variableName: selectableValues[newPosition].value,
            }
          })
          break
        case 'ArrowUp':
          setSelectedVariable((prev) => {
            const newPosition = prev.positionInArray - 1
            if (newPosition < 0) {
              return prev
            }
            return {
              positionInArray: newPosition,
              variableName: selectableValues[newPosition].value,
            }
          })
          break
        case 'Tab':
        case 'Enter':
          submitVariableToBlock({})
          break
        default:
          break
      }
      setKeyDown('')
    }, [keyDown])

    useEffect(() => {
      setKeyDown((prev) => keyPressed || prev)
    }, [keyPressed])

    useEffect(() => {
      scrollWhenSelectedIsChanged()
    }, [selectedVariable])

    const scrollWhenSelectedIsChanged = () => {
      if (filteredDivRef.current) {
        const selectedElement = filteredDivRef.current.children[selectedVariable.positionInArray]
        selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    const closeModal = () => {
      setAutocompleteFocus(false)
      setSelectedVariable({ positionInArray: -1, variableName: '' })
      if (setIsOpen) setIsOpen(false)
    }

    const submitVariableToBlock = ({ clickedVariable }: { clickedVariable?: number }) => {
      closeModal()

      const { rung, node: variableNode } = getPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !variableNode) return

      // Get the variable that was clicked or the selected one
      const variable =
        clickedVariable !== undefined
          ? filteredVariables[clickedVariable]
          : selectedVariable.positionInArray !== -1
            ? selectableValues[selectedVariable.positionInArray].type === 'variable'
              ? filteredVariables.find((variable) => selectedVariable.variableName === variable.name)
              : undefined
            : undefined

      /// If the variable is undefined, check if the selected variable is an add variable
      if (!variable) {
        if (
          selectedVariable.positionInArray !== -1 &&
          selectableValues[selectedVariable.positionInArray].type === 'add'
        ) {
          submitAddVariable({ variableName: selectedVariable.variableName })
        }
        return
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

      // Check if the variable is connected to a block
      if ((variableNode as VariableNode).data.block === undefined) return

      // Get the block that is connected to the variable
      const relatedBlock = rung.nodes.find((node) => node.id === (variableNode as VariableNode).data.block.id)
      if (!relatedBlock) return

      // Update the block to include the variable
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: relatedBlock.id,
        node: {
          ...relatedBlock,
          data: {
            ...relatedBlock.data,
            connectedVariables: {
              ...(relatedBlock.data as BlockNodeData<object>).connectedVariables,
              [(variableNode as VariableNode).data.block.handleId]: {
                variable: variable,
                type: variableNode.data.variant,
              },
            },
          },
        },
      })
    }

    const submitAddVariable = ({ variableName }: { variableName: string }) => {
      const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !node) return

      const variableTypeRestriction = {
        definition: variableRestrictions.definition || 'base-type',
        value: variableRestrictions.values
          ? Array.isArray(variableRestrictions.values)
            ? variableRestrictions.values[0]
            : variableRestrictions.values
          : 'dint',
      }
      if (!variableTypeRestriction.definition || !variableTypeRestriction.value) return

      const res = createVariable({
        data: {
          id: uuidv4(),
          name: variableName,
          // @ts-expect-error - type is dynamic
          type: {
            definition: variableTypeRestriction.definition as 'base-type' | 'derived' | 'array' | 'user-data-type',
            value: variableTypeRestriction.value,
          },
          class: 'local',
          location: '',
          documentation: '',
          debug: false,
        },
        scope: 'local',
        associatedPou: editor.meta.name,
      })
      if (!res.ok) return

      const variable = res.data as PLCVariable | undefined

      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: variable ?? { name: '' },
          },
        },
      })

      setAutocompleteFocus(false)
      if (setIsOpen) setIsOpen(false)
    }

    return (
      <Popover.Root open={isOpen ? isOpen : false}>
        <Popover.Trigger />
        <Popover.Portal>
          <Popover.Content
            className='box flex w-32 flex-col items-center rounded-lg bg-white text-xs text-neutral-950 outline-none dark:bg-neutral-950 dark:text-white'
            side='bottom'
            sideOffset={5}
            ref={popoverRef}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={closeModal}
            onEscapeKeyDown={closeModal}
            onPointerDownOutside={closeModal}
            onFocusOutside={closeModal}
            onInteractOutside={closeModal}
            onFocus={(e) => {
              if (focusEvent) focusEvent(e)
              setAutocompleteFocus(true)
            }}
            onBlur={() => setAutocompleteFocus(false)}
            onKeyDown={(e) => setKeyDown(e.key)}
          >
            {filteredVariables.length > 0 && (
              <div className='h-fit w-full p-1'>
                <div className='flex max-h-32 w-full flex-col overflow-y-auto' ref={filteredDivRef}>
                  {filteredVariables.map((variable, index) => (
                    <div
                      key={variable.name}
                      className={cn(
                        'flex h-fit w-full cursor-pointer select-none items-center justify-center p-1 hover:bg-neutral-600 dark:hover:bg-neutral-900',
                        {
                          'bg-neutral-400 dark:bg-neutral-800': selectedVariable.variableName === variable.name,
                        },
                      )}
                      onClick={() => {
                        submitVariableToBlock({ clickedVariable: index })
                      }}
                    >
                      {variable.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {filteredVariables.length > 0 && <div className='h-px w-full bg-neutral-300 dark:bg-neutral-700' />}
            <div
              className={cn(
                'flex h-fit w-full cursor-pointer flex-row items-center justify-center rounded-b-lg border-0 p-1 hover:bg-neutral-600 dark:hover:bg-neutral-900',
                {
                  'bg-neutral-400 dark:bg-neutral-800':
                    selectedVariable.positionInArray === selectableValues.length - 1,
                },
              )}
              onClick={() => submitAddVariable({ variableName: valueToSearch })}
            >
              <PlusIcon className='h-3 w-3 stroke-brand' />
              <div className='ml-2'>Add variable</div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    )
  },
)

export { VariablesBlockAutoComplete }
