import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { cn } from '@root/utils'
import { startCase } from 'lodash'
import { useEffect, useRef, useState } from 'react'

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
}: {
  value: string
  onValueChange: (value: string) => void
  selectValues: Array<SelectOption | SelectGroup>
  selected?: boolean
  openOnSelectedOption?: boolean
}) => {
  const [selectIsOpen, setSelectIsOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  const [inputValue, setInputValue] = useState('')

  const scrollToSelectedOption = (selectRef: React.RefObject<HTMLDivElement>, selectIsOpen: boolean) => {
    if (!openOnSelectedOption || !selectIsOpen) return
    const checkedElement = selectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }
  useEffect(() => {
    scrollToSelectedOption(selectRef, selectIsOpen)
  }, [selectIsOpen])

  // const filteredSelectValues = selectValues.filter((sv) =>
  //   sv.label
  //     ? sv.label.toLowerCase().includes(inputValue.toLowerCase())
  //     : sv.value.toLowerCase().includes(inputValue.toLowerCase()),
  // )

  const handleOnValueChange = (value: string) => {
    onValueChange(value)
    setInputValue('') // Clear input value when a selection is made
  }

  return (
    <PrimitiveDropdown.Root open={selectIsOpen} onOpenChange={setSelectIsOpen}>
      <PrimitiveDropdown.Trigger
        className={cn(
          'flex h-full w-full items-center justify-center p-2 font-caption text-cp-sm font-medium text-neutral-700 outline-none dark:text-neutral-500',
          { 'pointer-events-none': !selected },
        )}
      >
        {startCase(value) || ''}
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Content
        sideOffset={12}
        alignOffset={5}
        align='center'
        side='bottom'
        className='z-10 w-[--radix-dropdown-menu-trigger-width] rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        <div className='p-2'>
          <InputWithRef
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.stopPropagation()}
            placeholder='Search...'
            className='w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
          />
        </div>
        <ScrollAreaComponent.Root type='always'>
          <ScrollAreaComponent.Viewport
            className='max-h-[200px] rounded-b-lg border border-transparent'
            ref={selectRef}
          >
            {(() => {
              // Helper to filter options/groups recursively
              const filterOptions = (
                options: Array<SelectOption | SelectGroup>,
                input: string,
              ): Array<SelectOption | SelectGroup> => {
                return options
                  .map((item) => {
                    if ('options' in item) {
                      // It's a group
                      const filteredGroupOptions = filterOptions(item.options, input)
                      if (filteredGroupOptions.length > 0) {
                        return { ...item, options: filteredGroupOptions }
                      }
                      return null
                    } else {
                      // It's an option
                      const label = item.label || item.value
                      if (label.toLowerCase().includes(input.toLowerCase())) {
                        return item
                      }
                      return null
                    }
                  })
                  .filter(Boolean) as Array<SelectOption | SelectGroup>
              }

              const renderOptions = (options: Array<SelectOption | SelectGroup>) => {
                return options.map((item, idx) => {
                  if ('options' in item) {
                    // It's a group
                    return (
                      <div key={item.label} className='cursor-default'>
                        {idx !== 0 && <div className='mx-3 my-2 border-t border-neutral-200 dark:border-neutral-800' />}
                        <PrimitiveDropdown.Group>
                          <PrimitiveDropdown.Label className='px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-200'>
                            {item.label}
                          </PrimitiveDropdown.Label>
                          {renderOptions(item.options)}
                        </PrimitiveDropdown.Group>
                      </div>
                    )
                  } else {
                    // It's an option
                    return (
                      <PrimitiveDropdown.Item
                        key={item.id}
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900',
                          {
                            'bg-neutral-100 dark:bg-neutral-900': value === item.value,
                          },
                        )}
                        onSelect={() => {
                          handleOnValueChange(item.value)
                        }}
                        data-checked={value === item.value ? 'checked' : 'false'}
                      >
                        <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                          {item.label ? startCase(item.label) : item.value}
                        </span>
                      </PrimitiveDropdown.Item>
                    )
                  }
                })
              }

              const filtered = filterOptions(selectValues, inputValue)

              return filtered.length > 0 ? (
                renderOptions(filtered)
              ) : (
                <div className='flex h-full w-full items-center justify-center py-2'>
                  <span className='text-neutral-500'>No options available</span>
                </div>
              )
            })()}
          </ScrollAreaComponent.Viewport>
          <ScrollAreaComponent.ScrollBar />
        </ScrollAreaComponent.Root>
      </PrimitiveDropdown.Content>
    </PrimitiveDropdown.Root>
  )
}
