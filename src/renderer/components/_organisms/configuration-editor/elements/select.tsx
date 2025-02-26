import { cn } from '@root/utils'

import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../_atoms'
const SelectField = ({
  label,
  placeholder,
  width,
  ariaLabel,
  className,
  setSelectedOption,
  selectedOption,
  options = [],
}: {
  label?: string
  placeholder?: string
  width?: string
  ariaLabel?: string
  className?: string
  setSelectedOption?: (value: string) => void
  selectedOption?: string
  options?: string[]
}) => {
  return (
    <div
      className={`flex items-center gap-2.5 text-xs font-medium text-neutral-850 dark:text-neutral-300 ${className}`}
    >
      <label htmlFor={ariaLabel} className='text-neutral-950 dark:text-white'>
        {label}
      </label>
      <Select value={selectedOption} onValueChange={setSelectedOption}>
        <SelectTrigger
          aria-label={ariaLabel}
          withIndicator
          placeholder={placeholder}
          className={cn(
            'flex h-7 min-w-0 items-center justify-between rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300',
            width ? `w-[${width}]` : 'flex-1',
          )}
        />
        <SelectContent
          position='popper'
          side='bottom'
          sideOffset={-28}
          className='box h-fit max-h-52 w-[--radix-select-trigger-width] overflow-auto rounded-lg bg-white outline-none dark:bg-neutral-950'
        >
          {options.map((option, idx) => {
            return (
              <SelectItem
                key={idx}
                className='flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
                value={option}
              >
                <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                  <span>{option}</span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
export { SelectField }
