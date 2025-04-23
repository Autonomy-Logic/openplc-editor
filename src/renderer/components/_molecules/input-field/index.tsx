import { cn } from '@root/utils'

import { InputWithRef } from '../../_atoms'

type InputFieldProps = {
  label: string
  placeholder?: string
  className?: string
  value?: string
  onChange?: (value: string) => void
}

const InputField = ({ label, placeholder, className, value, onChange }: InputFieldProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => onChange && onChange(e.target.value)
  const id = `input-${label.toLowerCase().replace(' ', '-')}`

  return (
    <div className={cn('flex w-full items-center gap-2', className)}>
      <label htmlFor={id} className='whitespace-nowrap text-xs font-medium text-neutral-950 dark:text-white'>
        {label}
      </label>
      <InputWithRef
        onChange={handleChange}
        placeholder={placeholder}
        value={value}
        id={id}
        className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
      />
    </div>
  )
}
export { InputField }
