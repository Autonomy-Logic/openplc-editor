import { FC, InputHTMLAttributes } from 'react'
import { useFormContext } from 'react-hook-form'

type RadioProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string
  label?: string
}

const Radio: FC<RadioProps> = ({ name, label, ...rest }) => {
  const { register } = useFormContext()

  return (
    <div className="flex items-center">
      <input
        id={name}
        className="h-4 w-4 border-gray-900/10 text-open-plc-blue focus:ring-open-plc-blue dark:border-white/5 dark:bg-white/5"
        {...register(name)}
        {...rest}
        type="radio"
      />
      <label
        htmlFor={name}
        className="ml-3 block text-sm font-medium text-gray-500 dark:text-gray-400"
      >
        {label}
      </label>
    </div>
  )
}

export default Radio
