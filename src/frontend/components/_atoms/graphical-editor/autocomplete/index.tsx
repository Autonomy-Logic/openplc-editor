import * as Popover from '@radix-ui/react-popover'
import { ComponentPropsWithRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import { PlusIcon } from '../../../../assets/icons/interface/Plus'
import { cn } from '../../../../utils/cn'

export type GraphicalEditorAutocompleteProps = ComponentPropsWithRef<'div'> & {
  isOpen?: boolean
  setIsOpen?: (isOpen: boolean) => void
  keyPressed?: string
  searchValue: string
  submit: ({ variable }: { variable: { id: string; name: string } }) => void
  variables: PLCVariable[] | { id: string; name: string }[] | undefined
  canCreateNewVariable?: boolean
  newBlock?: {
    canCreate: boolean
    options?: {
      label: string
      block: {
        name: string
      }
    }
  }
}

export const GraphicalEditorAutocomplete = forwardRef<HTMLDivElement, GraphicalEditorAutocompleteProps>(
  (
    {
      onFocus: focusEvent,
      isOpen,
      setIsOpen,
      keyPressed,
      searchValue,
      submit,
      variables,
      canCreateNewVariable = true,
      newBlock = { canCreate: false },
    }: GraphicalEditorAutocompleteProps,
    ref,
  ) => {
    const popoverRef = useRef<HTMLDivElement>(null)
    const variablesDivRef = useRef<HTMLDivElement>(null)

    const [autocompleteFocus, setAutocompleteFocus] = useState<boolean>(false)
    const [keyDown, setKeyDown] = useState<string>('')
    const [selectedVariable, setSelectedVariable] = useState<{
      positionInArray: number
      variable: { id: string; name: string }
    }>({
      positionInArray: -1,
      variable: {
        id: '',
        name: '',
      },
    })

    const selectableValues = useMemo(() => {
      return [
        ...(variables?.map((variable) => ({
          type: 'variable',
          variable: {
            id: variable.id ?? '',
            name: variable.name,
          },
        })) || []),
        canCreateNewVariable
          ? {
              type: 'add',
              variable: {
                id: 'add',
                name: searchValue,
              },
            }
          : undefined,
        newBlock.canCreate
          ? {
              type: 'newBlock',
              variable: {
                id: 'newBlock',
                name: newBlock.options?.block.name ?? 'generic',
              },
            }
          : undefined,
      ].filter((variable) => variable !== undefined)
    }, [variables, searchValue])

    const closeModal = () => {
      setAutocompleteFocus(false)
      setSelectedVariable({ positionInArray: -1, variable: { id: '', name: '' } })
      if (setIsOpen) setIsOpen(false)
    }

    const submitAutocompletion = ({ variable }: { variable: { id: string; name: string } }) => {
      closeModal()
      submit({ variable })
    }

    /**
     * Resolve what to submit when the user presses Enter/Tab without
     * arrowing down to a row.  Previously this always sent the "Add
     * variable" option, so typing the exact name of an existing
     * variable and hitting Return would create a brand-new variable
     * with a name-collision-resolved suffix (forum bug, v4.2.0).
     *
     * Exact case-insensitive match against the visible `variables`
     * list takes precedence — the dropdown was already showing that
     * variable, so the user clearly meant to bind to it.  Only when
     * no match exists do we fall through to "Add variable".
     */
    const resolveImplicitSubmitOption = () => {
      const trimmed = searchValue.trim().toLowerCase()
      if (trimmed) {
        const exactMatch = variables?.find((v) => v.name.toLowerCase() === trimmed)
        if (exactMatch) {
          return {
            id: exactMatch.id ?? '',
            name: exactMatch.name,
          }
        }
      }
      const addVariableOption = selectableValues.find((item) => item.type === 'add')
      return addVariableOption ? addVariableOption.variable : null
    }

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          popoverRef.current?.focus()
        },
        isFocused: autocompleteFocus,
        selectedVariable: selectedVariable,
        /**
         * Synchronously triggers the submit action.
         * Used by parent components to bypass the async keyPressed → keyDown useEffect chain
         * which can cause race conditions when the autocomplete unmounts on blur.
         */
        triggerSubmit: () => {
          if (selectedVariable.positionInArray === -1) {
            const implicit = resolveImplicitSubmitOption()
            if (implicit) {
              submitAutocompletion({ variable: implicit })
            } else {
              closeModal()
            }
          } else {
            submitAutocompletion({ variable: selectedVariable.variable })
          }
        },
      }
    }, [
      selectedVariable,
      selectableValues,
      variables,
      searchValue,
      popoverRef,
      autocompleteFocus,
      submitAutocompletion,
      closeModal,
    ])

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
              variable: selectableValues[newPosition].variable,
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
              variable: selectableValues[newPosition].variable,
            }
          })
          break
        case 'Tab':
        case 'Enter':
          if (selectedVariable.positionInArray === -1) {
            const implicit = resolveImplicitSubmitOption()
            if (implicit) {
              submitAutocompletion({ variable: implicit })
            } else {
              // Nothing matched and no 'add' option available; close
              // the autocomplete to give the user clear feedback.
              closeModal()
            }
          } else {
            submitAutocompletion({
              variable: selectedVariable.variable,
            })
          }
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
      if (variablesDivRef.current) {
        const selectedElement = variablesDivRef.current.children[selectedVariable.positionInArray]
        selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    return (
      <Popover.Root open={isOpen ? isOpen : false}>
        <Popover.Trigger />
        <Popover.Portal>
          {selectableValues.length > 0 && (
            <Popover.Content
              className='box flex w-36 flex-col items-center rounded-lg bg-white text-xs text-neutral-950 outline-none dark:bg-neutral-950 dark:text-white'
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
              {variables && variables.length > 0 && (
                <>
                  <div className='h-fit w-full p-1'>
                    <div className='flex max-h-32 w-full flex-col overflow-y-auto' ref={variablesDivRef}>
                      {variables.map((variable) => (
                        <div
                          key={variable.name}
                          className={cn(
                            'flex h-fit w-full cursor-pointer select-none items-center justify-center p-1 hover:bg-neutral-600 dark:hover:bg-neutral-900',
                            {
                              'bg-neutral-400 dark:bg-neutral-800': selectedVariable.variable.name === variable.name,
                            },
                          )}
                          // Keep the editor textarea focused through the click: some
                          // consumers (LD contact/coil) refocus their container on the
                          // textarea's blur, which would close this popover before the
                          // click resolves and swallow the selection.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            submitAutocompletion({
                              variable: {
                                id: variable.id ?? '',
                                name: variable.name,
                              },
                            })
                          }}
                        >
                          {variable.name}
                        </div>
                      ))}
                    </div>
                  </div>
                  {(canCreateNewVariable || newBlock.canCreate) && (
                    <div className='h-px w-full bg-neutral-300 dark:bg-neutral-700' />
                  )}
                </>
              )}
              {canCreateNewVariable && (
                <>
                  <div
                    className={cn(
                      'flex h-fit w-full cursor-pointer flex-row items-center justify-center border-0 p-1 hover:bg-neutral-600 dark:hover:bg-neutral-900',
                      {
                        'bg-neutral-400 dark:bg-neutral-800': newBlock.canCreate
                          ? selectedVariable.positionInArray === selectableValues.length - 2
                          : selectedVariable.positionInArray === selectableValues.length - 1,
                        'rounded-b-lg': !newBlock.canCreate && variables && variables.length > 0,
                        'rounded-lg': !variables || variables.length === 0,
                      },
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      submitAutocompletion({
                        variable: newBlock.canCreate
                          ? selectableValues[selectableValues.length - 2].variable
                          : selectableValues[selectableValues.length - 1].variable,
                      })
                    }
                  >
                    <PlusIcon className='h-3 w-3 stroke-brand' />
                    <div className='ml-2'>Add variable</div>
                  </div>
                  {newBlock.canCreate && <div className='h-px w-full bg-neutral-300 dark:bg-neutral-700' />}
                </>
              )}
              {newBlock.canCreate && (
                <div
                  className={cn(
                    'flex h-fit w-full cursor-pointer flex-row items-center justify-center  border-0 p-1 hover:bg-neutral-600 dark:hover:bg-neutral-900',
                    {
                      'bg-neutral-400 dark:bg-neutral-800':
                        selectedVariable.positionInArray === selectableValues.length - 1,
                      'rounded-b-lg': variables && variables.length > 0,
                      'rounded-lg': !variables || variables.length === 0,
                    },
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (newBlock.options) {
                      submitAutocompletion({ variable: selectableValues[selectableValues.length - 1].variable })
                    }
                  }}
                >
                  <PlusIcon className='h-3 w-3 stroke-brand' />
                  <div className='ml-2'>{newBlock.options?.label}</div>
                </div>
              )}
            </Popover.Content>
          )}
        </Popover.Portal>
      </Popover.Root>
    )
  },
)
