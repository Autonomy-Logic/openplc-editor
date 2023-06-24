import { FC, LabelHTMLAttributes } from 'react'

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>

const Label: FC<LabelProps> = ({ htmlFor, ...rest }) => {
  return (
    <label
      htmlFor={htmlFor}
      className="flex items-center justify-between text-sm font-medium leading-6 text-gray-500 dark:text-gray-400"
      {...rest}
    />
  )
}

export default Label
