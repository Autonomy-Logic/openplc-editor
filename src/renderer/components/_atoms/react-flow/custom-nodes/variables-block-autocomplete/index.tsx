import * as Popover from '@radix-ui/react-popover'
import { PlusIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { ComponentPropsWithRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
      return ['bool']
    case 'variable': {
      const variableType = (block as VariableNode).data.block.variableType.type.value
      return getVariableRestrictionType(variableType)
    }
    default:
      return undefined
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
          (variableRestrictions === undefined || variableRestrictions.includes(variable.type.value.toLowerCase())),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
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
          setInputFocus(false)
          setIsOpen && setIsOpen(false)
          submitVariableToBlock()
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

    const submitVariableToBlock = () => {
      const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
        nodeId: (block as Node<BasicNodeData>).id,
      })
      if (!rung || !node) return

      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: filteredVariables[selectedVariable.positionInArray],
          },
        },
      })
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
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              setInputFocus(false)
              setIsOpen && setIsOpen(false)
            }}
            onEscapeKeyDown={() => {
              setInputFocus(false)
              setIsOpen && setIsOpen(false)
            }}
            onPointerDownOutside={() => {
              setInputFocus(false)
              setIsOpen && setIsOpen(false)
            }}
            onFocus={() => setInputFocus(true)}
            onBlur={() => setInputFocus(false)}
            onKeyDown={(e) => setKeyDown(e.key)}
          >
            {filteredVariables.length > 0 && (
              <div className='h-fit w-full p-1'>
                <div className='flex max-h-32 w-full flex-col overflow-y-auto' ref={filteredDivRef}>
                  {filteredVariables.map((variable) => (
                    <div
                      key={variable.name}
                      className={cn(
                        'flex h-fit w-full cursor-pointer select-none items-center justify-center p-1 hover:bg-neutral-700',
                        {
                          'bg-brand': selectedVariable.variableName === variable.name,
                        },
                      )}
                      onClick={() => {
                        console.log('variable', variable)
                      }}
                    >
                      {variable.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className='flex h-fit w-full flex-row items-center justify-center p-1'>
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
