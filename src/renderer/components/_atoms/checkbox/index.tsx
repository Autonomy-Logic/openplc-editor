import type { CheckboxProps as PrimitiveCheckboxProps } from '@radix-ui/react-checkbox'
import * as PrimitiveCheckbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'

const Checkbox = (props: PrimitiveCheckboxProps) => {
  return (
    <PrimitiveCheckbox.Root
      className={cn(
        'flex h-4 w-4 appearance-none items-center justify-center rounded-[4px] border bg-white outline-none dark:border-neutral-850',
        props.checked ? 'border-brand' : 'border-neutral-300',
      )}
      {...props}
    >
      <PrimitiveCheckbox.Indicator>
        <CheckIcon className='stroke-brand' />
      </PrimitiveCheckbox.Indicator>
    </PrimitiveCheckbox.Root>
  )
}

export { Checkbox }
