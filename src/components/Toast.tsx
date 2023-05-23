import { XMarkIcon } from '@heroicons/react/20/solid';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { ToastProps as SharedToastProps } from '@shared/types/toast';
import React from 'react';

import { classNames } from '@/utils';

export type ToastProps = SharedToastProps & {
  closeToast?: () => void;
};

const Toast: React.FC<ToastProps> = ({ type, title, description, closeToast }) => {
  const icons = {
    success: <CheckCircleIcon className="h-6 w-6 text-green-400" />,
    error: <XCircleIcon className="h-6 w-6 text-red-400" />,
    warning: <ExclamationTriangleIcon className="h-6 w-6 text-yellow-400" />,
    info: <InformationCircleIcon className="h-6 w-6 text-blue-400" />,
  };
  return (
    <div
      className={classNames(
        'w-full flex items-start p-4 rounded shadow',
        type === 'error' && 'bg-red-50',
        type === 'success' && 'bg-green-50',
        type === 'warning' && 'bg-yellow-50',
        type === 'info' && 'bg-blue-50',
      )}
    >
      <div className="flex-shrink-0">{icons[type]}</div>
      <div className="ml-3 w-0 flex-1 pt-0.5">
        <h3
          className={classNames(
            'text-sm font-semibold',
            type === 'error' && 'text-red-800',
            type === 'success' && 'text-green-800',
            type === 'warning' && 'text-yellow-800',
            type === 'info' && 'text-blue-800',
          )}
        >
          {title}
        </h3>
        <p
          className={classNames(
            'mt-1 text-sm',
            type === 'error' && 'text-red-700',
            type === 'success' && 'text-green-700',
            type === 'warning' && 'text-yellow-700',
            type === 'info' && 'text-blue-700',
          )}
        >
          {description}
        </p>
      </div>
      <div className="ml-4 flex flex-shrink-0">
        <button
          type="button"
          className="press-animated inline-flex rounded-md text-gray-400 hover:text-gray-500"
          onClick={closeToast}
        >
          <span className="sr-only">Close</span>
          <XMarkIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default Toast;
