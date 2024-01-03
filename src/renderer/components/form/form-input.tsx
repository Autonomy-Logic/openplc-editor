// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable react/function-component-definition */
import { isEmpty } from 'lodash';
import { FC, InputHTMLAttributes } from 'react';
import { useFormContext } from 'react-hook-form';
/**
 * Props for the Input component.
 * Inherits HTML attributes for an `input` element.
 */
type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  name: string;
};
/**
 * Input component used to render input fields within a form.
 * @param name - The name of the input element.
 * @param type - The type of input (e.g., 'text', 'number', 'password').
 * @param rest - Other HTML attributes for the input element.
 */
const Input: FC<InputProps> = ({ name, type, ...rest }) => {
  const { register } = useFormContext();

  return (
    <input
      id={name}
      className="w-full flex-1 rounded-md border border-gray-900/10 px-3 py-2 text-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand dark:border-white/5 dark:bg-white/5 dark:text-gray-400"
      type={type}
      {...register(
        name,
        type === 'number' ? { valueAsNumber: !isEmpty(name) } : undefined,
      )}
      {...rest}
    />
  );
};

export default Input;
