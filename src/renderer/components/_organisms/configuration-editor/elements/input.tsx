import { InputWithRef } from '../../../_atoms'
const InputField = ({
  label,
  placeholder,
  className,
  value,
  onChange,
}: {
  label: string
  placeholder?: string
  className?: string
  value?: string
  onChange?: (value: string) => void
}) => (
  <div className={`flex w-full items-center gap-2  ${className}`}>
    <span className='whitespace-nowrap text-xs font-medium text-neutral-950 dark:text-white'>{label}</span>
    <InputWithRef
      onChange={(e) => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      value={value}
      className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
    />
  </div>
)
export { InputField }
