import { cn } from '@utils/cn'
import { ButtonHTMLAttributes, Dispatch, ElementType, SetStateAction } from 'react'

type DropdownSelectProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selectedOption: string
  Icon?: ElementType
  setShowOptions: Dispatch<SetStateAction<boolean>>
  showOptions: boolean
  placeholder?: string
}
export default function Select({
  selectedOption,
  Icon,
  setShowOptions,
  showOptions,
  placeholder,
  className,
  ...props
}: DropdownSelectProps) {
  return (
    <button
      type='button'
      data-testid='dropdown-icon'
      className={cn('select-none', className)}
      onClick={() => setShowOptions(!showOptions)}
      {...props}
    >
      {placeholder}
      <div className='flex w-28 items-center justify-between'>
        <span className='text-black '>{selectedOption}</span>
        {Icon && (
          <Icon
            size='md'
            direction='right'
            variant='primary'
            className={cn(`${showOptions && 'rotate-270'}`, 'inline stroke-brand transition-all')}
          />
        )}
      </div>
    </button>
  )
}
