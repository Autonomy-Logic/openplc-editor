import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'
import { cn } from '@root/utils'
import { startCase } from 'lodash'
import { useEffect, useRef, useState } from 'react'

import { ScrollAreaComponent } from '../../ui'
import { InputWithRef } from '..'

export const GenericComboboxCell = ({
  value,
  onValueChange,
  selectValues,
  selected = true,
  openOnSelectedOption = false,
}: {
  value: string
  onValueChange: (value: string) => void
  selectValues: {
    id: string
    value: string
    label?: string
  }[]
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

  const filteredSelectValues = selectValues.filter((sv) =>
    sv.label
      ? sv.label.toLowerCase().includes(inputValue.toLowerCase())
      : sv.value.toLowerCase().includes(inputValue.toLowerCase()),
  )

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
        {startCase(value) || 'Select an option'}
      </PrimitiveDropdown.Trigger>
      <PrimitiveDropdown.Content
        sideOffset={5}
        alignOffset={5}
        align='center'
        side='bottom'
        className='w-[--radix-select-trigger-width] rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
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
            {filteredSelectValues.map((sv) => (
              <PrimitiveDropdown.Item
                key={sv.id}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900',
                  {
                    'bg-neutral-100 dark:bg-neutral-900': value === sv.value,
                  },
                )}
                onSelect={() => {
                  handleOnValueChange(sv.value)
                }}
                data-checked={value === sv.value ? true : false}
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  {sv.label ? startCase(sv.label) : sv.value}
                </span>
              </PrimitiveDropdown.Item>
            ))}
          </ScrollAreaComponent.Viewport>
          <ScrollAreaComponent.ScrollBar />
        </ScrollAreaComponent.Root>
      </PrimitiveDropdown.Content>
    </PrimitiveDropdown.Root>
  )
}
