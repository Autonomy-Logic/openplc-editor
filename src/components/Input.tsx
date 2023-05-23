import { ExclamationCircleIcon } from '@heroicons/react/24/solid';
import React, { InputHTMLAttributes } from 'react';

import { classNames } from '@/utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  isInvalid?: string;
};

const Input: React.FC<InputProps> = ({ id, label, isInvalid, className, ...rest }) => {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative rounded-md shadow-sm">
        <input
          id={id}
          className={classNames(
            isInvalid
              ? 'border-red-300 text-red-900 placeholder-red-300 focus:ring-red-500 focus:border-red-500'
              : ' border-gray-300 text-gray-500 placeholder-gray-500 focus:ring-open-plc-blue focus:border-open-plc-blue',
            `block w-full pr-10 focus:outline-none sm:text-sm rounded-md ${className}`,
          )}
          aria-invalid="true"
          aria-describedby={id}
          {...rest}
        />
        {isInvalid && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500" aria-hidden="true" />
          </div>
        )}
      </div>
      {isInvalid && (
        <p className="mt-1 text-sm text-red-600" id={id}>
          {isInvalid}
        </p>
      )}
    </div>
  );
};

export default Input;
