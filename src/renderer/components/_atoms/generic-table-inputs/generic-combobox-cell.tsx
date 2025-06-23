import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { PlusIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ScrollAreaComponent } from '../../ui'
import { InputWithRef } from '..'

type SelectOption = {
  id: string
  value: string
  label?: string
}

type SelectGroup = {
  label: string
  options: Array<SelectOption>
}

export const GenericComboboxCell = ({
  value,
  onValueChange,
  selectValues,
  selected = true,
  openOnSelectedOption = false,
  canAddACustomOption = false,
}: {
  value: string
  onValueChange: (value: string) => void
  selectValues: Array<SelectOption | SelectGroup>
  selected?: boolean
  openOnSelectedOption?: boolean
  canAddACustomOption?: boolean
}) => {
  const [selectIsOpen, setSelectIsOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const customButtonRef = useRef<HTMLDivElement>(null)

  const [inputValue, setInputValue] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])

  // Recursively find the first element with [data-state="checked"] in all children
  const findFirstCheckedElement = (element: HTMLElement | null): HTMLElement | null => {
    if (!element) return null
    if (element.getAttribute('data-checked') === 'checked') return element
    for (const child of Array.from(element.children)) {
      const found = findFirstCheckedElement(child as HTMLElement)
      if (found) return found
    }
    return null
  }

  const scrollToSelectedOption = (selectIsOpen: boolean) => {
    if (!openOnSelectedOption || !selectIsOpen) return
    const checkedElement = findFirstCheckedElement(selectRef.current)
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }

  // Scroll to selected option when dropdown opens or inputValue changes (options re-render)
  useEffect(() => {
    if (selectIsOpen) {
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => {
        scrollToSelectedOption(true)
        inputRef.current?.focus()
      }, 0)
    }
  }, [selectIsOpen, inputValue])

  const isButtonDisabled =
    !inputValue.trim() ||
    selectValues.some((item) =>
      'options' in item
        ? item.options.some((opt) => opt.value === inputValue.trim())
        : item.value === inputValue.trim(),
    )

  const handleOnOpenChange = (open: boolean) => {
    setSelectIsOpen(open)
    if (open) setInputValue('')
  }

  const handleOnValueChange = (value: string) => {
    onValueChange(value)
    setInputValue('') // Clear input value when a selection is made
  }

  // Helper to flatten options for keyboard navigation
  const flattenOptions = useMemo(
    () =>
      (options: Array<SelectOption | SelectGroup>): SelectOption[] => {
        let result: SelectOption[] = []
        for (const item of options) {
          if ('options' in item) {
            result = result.concat(flattenOptions(item.options))
          } else {
            result.push(item)
          }
        }
        return result
      },
    [selectValues],
  )

  // Helper to filter options/groups recursively (moved out for reuse)
  const filterOptions = (
    options: Array<SelectOption | SelectGroup>,
    input: string,
  ): Array<SelectOption | SelectGroup> => {
    return options
      .map((item) => {
        if ('options' in item) {
          const filteredGroupOptions = filterOptions(item.options, input)
          if (filteredGroupOptions.length > 0) {
            return { ...item, options: filteredGroupOptions }
          }
          return null
        } else {
          const label = item.label || item.value
          if (label.includes(input)) {
            return item
          }
          return null
        }
      })
      .filter(Boolean) as Array<SelectOption | SelectGroup>
  }

  // Flatten filtered options for navigation
  const filteredOptions = useMemo(() => filterOptions(selectValues, inputValue), [selectValues, inputValue])
  const flatFilteredOptions = useMemo(() => flattenOptions(filteredOptions), [filteredOptions])

  // Reset highlight only when dropdown is first opened
  useEffect(() => {
    if (selectIsOpen) {
      setHighlightedIndex(flatFilteredOptions.findIndex((opt) => opt.value === value))
    }
  }, [selectIsOpen])

  // Scroll highlighted option into view
  useEffect(() => {
    const showButton = canAddACustomOption && !isButtonDisabled
    if (
      highlightedIndex >= 0 &&
      highlightedIndex < flatFilteredOptions.length &&
      optionRefs.current[highlightedIndex]
    ) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    } else if (showButton && highlightedIndex === flatFilteredOptions.length && customButtonRef.current) {
      customButtonRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, selectIsOpen, flatFilteredOptions.length, canAddACustomOption, isButtonDisabled])

  // Keyboard navigation handler
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const showButton = canAddACustomOption && !isButtonDisabled
    const totalOptions = flatFilteredOptions.length + (showButton ? 1 : 0)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const next = prev < totalOptions - 1 ? prev + 1 : 0
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : totalOptions - 1
        return next
      })
    } else if (e.key === 'Enter') {
      if (
        highlightedIndex >= 0 &&
        highlightedIndex < flatFilteredOptions.length &&
        flatFilteredOptions[highlightedIndex]
      ) {
        handleOnValueChange(flatFilteredOptions[highlightedIndex].value)
        setSelectIsOpen(false)
      } else if (showButton && highlightedIndex === flatFilteredOptions.length) {
        handleOnValueChange(inputValue.trim())
        handleOnOpenChange(false)
      }
    }
  }

  return (
    <PrimitiveDropdown.Root open={selectIsOpen} onOpenChange={handleOnOpenChange}>
      <PrimitiveDropdown.Trigger
        className={cn(
          'w-full flex-1 items-center justify-center p-2 font-caption text-cp-sm font-medium text-neutral-700 outline-none dark:text-neutral-500',
          { 'pointer-events-none': !selected },
        )}
      >
        {value || ''}
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Content
        sideOffset={12}
        alignOffset={5}
        align='center'
        side='bottom'
        className='z-10 w-[--radix-dropdown-menu-trigger-width] min-w-36 rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        <div className='p-2'>
          <InputWithRef
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              e.stopPropagation()
              handleInputKeyDown(e)
            }}
            placeholder='Enter a value...'
            className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
          />
        </div>
        <ScrollAreaComponent.Root type='always'>
          <ScrollAreaComponent.Viewport
            className={cn('max-h-[200px] border border-transparent', {
              'rounded-b-lg': !canAddACustomOption,
            })}
            ref={selectRef}
          >
            {(() => {
              const renderOptions = (options: Array<SelectOption | SelectGroup>, startIdx: number) => {
                let currentIdx = startIdx
                return options.map((item, idx) => {
                  if ('options' in item) {
                    // It's a group
                    return (
                      <div key={item.label} className='cursor-default'>
                        {idx !== 0 && <div className='mx-3 my-2 border-t border-neutral-200 dark:border-neutral-800' />}
                        <PrimitiveDropdown.Group>
                          <PrimitiveDropdown.Label className='px-2 py-1 text-xs font-medium text-neutral-950 dark:text-neutral-200'>
                            {item.label}
                          </PrimitiveDropdown.Label>
                          {(() => {
                            const result = renderOptions(item.options, currentIdx)
                            currentIdx += item.options.length
                            return result
                          })()}
                        </PrimitiveDropdown.Group>
                      </div>
                    )
                  } else {
                    const currentFlatIdx = currentIdx++
                    return (
                      <div
                        key={item.id}
                        ref={(el) => (optionRefs.current[currentFlatIdx] = el)}
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900',
                          {
                            'bg-neutral-100 dark:bg-neutral-900':
                              value === item.value || highlightedIndex === currentFlatIdx,
                          },
                        )}
                        onMouseEnter={() => setHighlightedIndex(currentFlatIdx)}
                        onClick={() => {
                          handleOnValueChange(item.value)
                          setSelectIsOpen(false)
                        }}
                        tabIndex={-1}
                        role='option'
                        aria-selected={highlightedIndex === currentFlatIdx}
                        data-checked={value === item.value ? 'checked' : 'false'}
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          {item.label ? item.label : item.value}
                        </span>
                      </div>
                    )
                  }
                })
              }

              return filteredOptions.length > 0 ? (
                renderOptions(filteredOptions, 0)
              ) : (
                <div className='flex h-full w-full items-center justify-center py-2 opacity-60'>
                  <span className='text-neutral-500'>No options available</span>
                </div>
              )
            })()}
          </ScrollAreaComponent.Viewport>
          <ScrollAreaComponent.ScrollBar />
        </ScrollAreaComponent.Root>
        {canAddACustomOption && (
          <div
            ref={customButtonRef}
            className={cn(
              'flex h-fit min-h-8 w-full cursor-pointer flex-row items-center justify-center border-t border-neutral-200 p-1 dark:border-neutral-800',
              'hover:bg-neutral-600 dark:hover:bg-neutral-900',
              'bg-white dark:bg-neutral-950',
              'rounded-b-lg',
              isButtonDisabled ? 'pointer-events-none cursor-not-allowed opacity-50' : '',
              !isButtonDisabled && highlightedIndex === flatFilteredOptions.length
                ? 'bg-neutral-100 dark:bg-neutral-900'
                : '',
            )}
            tabIndex={0}
            role='button'
            aria-disabled={isButtonDisabled}
            onMouseEnter={() => !isButtonDisabled && setHighlightedIndex(flatFilteredOptions.length)}
            onClick={() => {
              if (!isButtonDisabled) {
                handleOnValueChange(inputValue.trim())
                handleOnOpenChange(false)
              }
            }}
          >
            <PlusIcon className='h-3 w-3 stroke-brand' />
            <div className='ml-2'>Add custom value</div>
          </div>
        )}
      </PrimitiveDropdown.Content>
    </PrimitiveDropdown.Root>
  )
}
