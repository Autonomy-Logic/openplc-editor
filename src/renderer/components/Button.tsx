// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable no-nested-ternary */
// Review this eslint rule
/* eslint-disable react/require-default-props */
import React, { ButtonHTMLAttributes, FC } from 'react';

import { classNames } from '../../utils';
/**
 * Props for the Button component.
 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: 'primary' | 'secondary';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  widthFull?: boolean;
};
/**
 * The Button component renders a button element with customizable appearance, size, and other properties.
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const Button: FC<ButtonProps> = ({
  appearance = 'primary',
  size = 'md',
  children,
  className,
  disabled = false,
  label,
  widthFull = false,
  ...rest
}) => (
    <button
      type="button"
      disabled={disabled}
      className={classNames(
        appearance === 'primary'
          ? 'border border-transparent bg-open-plc-blue text-white  focus:ring-open-plc-blue'
          : 'border border-gray-300 bg-white text-gray-700 focus:ring-open-plc-blue dark:border-white/5 dark:bg-white/5 dark:text-gray-400',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'press-animated hover:opacity-90',
        size === 'xs'
          ? 'rounded px-2.5 py-1.5 text-xs'
          : size === 'sm'
          ? 'rounded-md px-3 py-2 text-sm leading-4'
          : size === 'md'
          ? 'rounded-md px-4 py-2 text-sm'
          : size === 'lg'
          ? 'rounded-md px-4 py-2 text-base'
          : 'rounded-md px-6 py-3 text-base',
        widthFull && 'w-full',
        `inline-flex items-center font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-open-plc-blue ${className}`,
      )}
      {...rest}
    >
      {children ||
        (label && (
          <div className="flex h-full w-full items-center justify-center">
            {label}
          </div>
        ))}
    </button>
  );

export default Button;
