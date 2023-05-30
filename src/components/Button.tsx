import React, { ButtonHTMLAttributes } from 'react';

import { classNames } from '@/utils';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: 'primary' | 'secondary';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  widthFull?: boolean;
};

const Button: React.FC<ButtonProps> = ({
  appearance = 'primary',
  size = 'md',
  children,
  className,
  disabled = false,
  label,
  widthFull = false,
  ...rest
}) => {
  return (
    <button
      disabled={disabled}
      className={classNames(
        appearance === 'primary'
          ? 'bg-open-plc-blue border border-transparent text-white  focus:ring-open-plc-blue'
          : 'bg-white border border-gray-300 text-gray-700 focus:ring-open-plc-blue',
        disabled ? 'cursor-not-allowed opacity-50' : 'press-animated hover:opacity-90',
        size === 'xs'
          ? 'px-2.5 py-1.5 text-xs rounded'
          : size === 'sm'
          ? 'px-3 py-2 text-sm leading-4 rounded-md'
          : size === 'md'
          ? 'px-4 py-2 text-sm rounded-md'
          : size === 'lg'
          ? 'px-4 py-2 text-base rounded-md'
          : 'px-6 py-3 text-base rounded-md',
        widthFull && 'w-full',
        `inline-flex items-center font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-open-plc-blue ${className}`,
      )}
      {...rest}
    >
      {children ||
        (label && (
          <div className="flex items-center justify-center w-full h-full">{label}</div>
        ))}
    </button>
  );
};

export default Button;
