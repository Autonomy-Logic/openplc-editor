import { isEmpty } from 'lodash'
import { FC, InputHTMLAttributes } from 'react'
import { useFormContext } from 'react-hook-form'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string
}

const Input: FC<InputProps> = ({ name, type, ...rest }) => {
  const { register } = useFormContext()

  return (
    <input
      id={name}
      className="w-full flex-1 rounded-md border border-gray-900/10 px-3 py-2 text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-open-plc-blue dark:border-white/5 dark:bg-white/5 dark:text-gray-400"
      type={type}
      {...register(
        name,
        type === 'number' ? { valueAsNumber: !isEmpty(name) } : undefined,
      )}
      {...rest}
    />
  )
}

export default Input
