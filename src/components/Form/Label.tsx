import { FC, LabelHTMLAttributes } from 'react'
/**
 * Props for the Label component.
 * Inherits HTML attributes for a `label` element.
 */
type LabelProps = LabelHTMLAttributes<HTMLLabelElement>
/**
 * Label component used to render label elements for form fields.
 * @param htmlFor - The ID of the input element associated with the label.
 * @param rest - Other HTML attributes for the label element.
 */
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
