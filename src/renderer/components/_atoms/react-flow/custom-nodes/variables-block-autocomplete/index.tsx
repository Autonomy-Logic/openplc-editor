import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { extractNumberAtEnd } from '@root/renderer/store/slices/project/utils/variables'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

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
      const values = getVariableRestrictionType(variableType.value).map((value) => value.toLowerCase())
      return {
        values,
        definition: variableType.definition,
        limitations: ['derived'],
      }
    }
    case 'coil':
      return {
        values: undefined,
        definition: undefined,
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
    { block, blockType = 'other', isOpen, setIsOpen, keyPressed, valueToSearch }: VariablesBlockAutoCompleteProps,
    ref,
  ) => {
    const {
      editor,
      project: {
        data: { pous },
      },
      projectActions: { createVariable },
      flows,
      flowActions: { updateNode },
    } = useOpenPLCStore()

    const popoverRef = useRef<HTMLDivElement>(null)
    const [inputFocus, setInputFocus] = useState<boolean>(false)
    const [keyDown, setKeyDown] = useState<string>('')

    const pou = pous.find((pou) => pou.data.name === editor.meta.name)
    const variables = pou?.data.variables || []
    const variableRestrictions = blockTypeRestrictions(block, blockType)

    const filteredDivRef = useRef<HTMLDivElement>(null)
    const filteredVariables = variables
      .filter(
        (variable) =>
          variable.name.includes(valueToSearch) &&
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
    const [selectedVariable, setSelectedVariable] = useState<{ positionInArray: number; variableName: string }>({
      positionInArray: -1,
      variableName: '',
    })

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          popoverRef.current?.focus()
        },
        isFocused: inputFocus,
      }
    }, [filteredVariables, popoverRef, inputFocus])

    useEffect(() => {
      switch (keyDown) {
        case 'ArrowDown':
          setSelectedVariable((prev) => {
            const newPosition = prev.positionInArray + 1
            if (newPosition >= filteredVariables.length) {
              return prev
            }
            return {
              positionInArray: newPosition,
              variableName: filteredVariables[newPosition].name,
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
              variableName: filteredVariables[newPosition].name,
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
      setInputFocus(false)
      setIsOpen && setIsOpen(false)
    }

    const submitVariableToBlock = ({ clickedVariable }: { clickedVariable?: number }) => {
      const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !node) return

      const variable =
        clickedVariable !== undefined
          ? filteredVariables[clickedVariable]
          : selectedVariable.positionInArray !== -1
            ? filteredVariables[selectedVariable.positionInArray]
            : undefined
      if (!variable) return

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

      setInputFocus(false)
      setIsOpen && setIsOpen(false)
    }

    const submitAddVariable = ({ variableName }: { variableName: string }) => {
      const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !node) return

      const variableTypeRestriction = {
        definition: blockType === 'coil' ? 'base-type' : variableRestrictions.definition || 'base-type',
        value: blockType === 'coil' ? 'bool' : variableRestrictions.values?.[0] || 'bool',
      }
      if (!variableTypeRestriction.definition || !variableTypeRestriction.value) return

      const res = createVariable({
        data: {
          id: uuidv4(),
          name: variableName,
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

      if (!res) return

      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: res.data as PLCVariable | undefined,
          },
        },
      })

      setInputFocus(false)
      setIsOpen && setIsOpen(false)
    }

    return (
      <Popover.Root open={isOpen ? isOpen : false}>
        <Popover.Trigger />
        <Popover.Portal>
          <Popover.Content
            className='flex w-32 flex-col items-center rounded-lg border-0 bg-white text-xs shadow-lg outline-none'
            side='bottom'
            sideOffset={5}
            ref={popoverRef}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={closeModal}
            onEscapeKeyDown={closeModal}
            onPointerDownOutside={closeModal}
            onFocusOutside={closeModal}
            onInteractOutside={closeModal}
            onFocus={() => setInputFocus(true)}
            onBlur={() => setInputFocus(false)}
            onKeyDown={(e) => setKeyDown(e.key)}
          >
            {filteredVariables.length > 0 && (
              <div className='h-fit w-full p-1'>
                <div className='flex max-h-32 w-full flex-col overflow-y-auto' ref={filteredDivRef}>
                  {filteredVariables.map((variable, index) => (
                    <div
                      key={variable.name}
                      className={cn(
                        'flex h-fit w-full cursor-pointer select-none items-center justify-center p-1 hover:bg-neutral-700',
                        {
                          'bg-brand': selectedVariable.variableName === variable.name,
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
            <div
              className='flex h-fit w-full flex-row items-center justify-center p-1'
              onClick={() => submitAddVariable({ variableName: valueToSearch })}
            >
              <PlusIcon className='h-3 w-3 fill-red-600 stroke-red-600' />
              <div className='ml-2'>Add variable</div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    )
  },
)

export { VariablesBlockAutoComplete }
