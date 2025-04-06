import type { CheckboxProps as PrimitiveCheckboxProps } from '@radix-ui/react-checkbox'
import * as PrimitiveCheckbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'

type CheckboxProps = PrimitiveCheckboxProps & {
  label?: string
}

const Checkbox = ({ label, disabled, checked, className, ...props }: CheckboxProps) => {
  return (
    <div className={cn('flex items-center gap-2', disabled && 'cursor-not-allowed opacity-50')}>
      <PrimitiveCheckbox.Root
        className={cn(
          'flex h-4 w-4 appearance-none items-center justify-center rounded-[4px] border bg-white outline-none dark:border-neutral-850',
          checked ? 'border-brand' : 'border-neutral-300',
          className,
        )}
        checked={checked}
        disabled={disabled}
        {...props}
      >
        <PrimitiveCheckbox.Indicator>
          <CheckIcon className='stroke-brand' />
        </PrimitiveCheckbox.Indicator>
      </PrimitiveCheckbox.Root>
      {label && (
        <label htmlFor={props.id} className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'>
          {label}
        </label>
      )}
    </div>
  )
}

export { Checkbox }
