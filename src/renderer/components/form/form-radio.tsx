// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable react/function-component-definition */
// Review this eslint rule
/* eslint-disable react/require-default-props */
import { FC, InputHTMLAttributes } from 'react';
import { useFormContext } from 'react-hook-form';
/**
 * Props for the Radio component.
 * Inherits HTML attributes for an `input` element of type "radio".
 */
type RadioProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string;
  label?: string;
};
/**
 * Radio component used to render radio input elements.
 * @param name - The name of the radio input.
 * @param label - The label text for the radio input.
 * @param rest - Other HTML attributes for the radio input element.
 */
const Radio: FC<RadioProps> = ({ name, label, ...rest }) => {
  const { register } = useFormContext();

  return (
    <div className="flex items-center">
      <input
        id={name}
        className="h-4 w-4 border-gray-900/10 text-brand focus:ring-brand dark:border-white/5 dark:bg-white/5"
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
  );
};

export default Radio;
