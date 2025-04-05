import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'
const CheckBox = ({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) => (
  <div className={cn('flex items-center gap-2', disabled ?? 'opacity-50')}>
    <Checkbox.Root
      className={cn(
        'flex h-4 w-4 appearance-none items-center justify-center rounded-[4px] border bg-white outline-none dark:border-neutral-850',
        checked ? 'border-brand' : 'border-neutral-300',
      )}
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    >
      <Checkbox.Indicator>
        <CheckIcon className='stroke-brand' />
      </Checkbox.Indicator>
    </Checkbox.Root>
    <label htmlFor={id} className={cn('text-sm font-medium text-neutral-950 dark:text-white')}>
      {label}
    </label>
  </div>
)

export { CheckBox }
