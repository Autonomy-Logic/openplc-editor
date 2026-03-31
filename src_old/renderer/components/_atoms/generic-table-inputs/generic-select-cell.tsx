import { cn } from '@root/utils'
import { startCase } from 'lodash'
import { useEffect, useRef, useState } from 'react'

import { ScrollAreaComponent } from '../../ui'
import { Select, SelectContent, SelectItem, SelectTrigger } from '..'

export const GenericSelectCell = ({
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

  return (
    <Select value={value} onValueChange={(value) => onValueChange(value)} onOpenChange={setSelectIsOpen}>
      <SelectTrigger
        aria-label='generic-table-select'
        placeholder={value}
        className={cn(
          'flex h-full w-full items-center justify-center p-2 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:text-neutral-300',
          { 'pointer-events-none': !selected },
        )}
      />
      <SelectContent
        sideOffset={5}
        alignOffset={5}
        position='popper'
        align='center'
        side='bottom'
        className='w-[--radix-select-trigger-width] rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
      >
        <ScrollAreaComponent.Root type='always'>
          <ScrollAreaComponent.Viewport className='max-h-[250px] rounded-lg border border-transparent' ref={selectRef}>
            {selectValues.map((sv) => (
              <SelectItem
                key={sv.id}
                value={sv.value}
                className={cn(
                  'flex w-full cursor-pointer items-center justify-center py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900',
                  'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                )}
              >
                <span className='text-center font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500'>
                  {sv.label ? startCase(sv.label) : sv.value}
                </span>
              </SelectItem>
            ))}
          </ScrollAreaComponent.Viewport>
          <ScrollAreaComponent.ScrollBar />
        </ScrollAreaComponent.Root>
      </SelectContent>
    </Select>
  )
}
