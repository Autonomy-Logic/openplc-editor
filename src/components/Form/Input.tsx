import React, { InputHTMLAttributes } from 'react';
import { useFormContext } from 'react-hook-form';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
}

const Input: React.FC<InputProps> = ({ name, ...rest }) => {
  const { register } = useFormContext();

  return (
    <input
      id={name}
      className="flex-1 rounded-md border border-gray-200 shadow-sm px-3 py-2 text-gray-500 focus:outline-none focus:ring-2 focus:ring-open-plc-blue dark:text-gray-400 dark:border-gray-700 dark:bg-white/5"
      {...register(name)}
      {...rest}
    />
  );
};

export default Input;
