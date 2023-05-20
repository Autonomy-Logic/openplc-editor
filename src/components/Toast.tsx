import { XMarkIcon } from '@heroicons/react/20/solid';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { ToastMessageProps } from '@shared/types/message';
import React from 'react';

export type ToastProps = ToastMessageProps & {
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
    <div className="w-full flex items-start p-4 rounded bg-gray-50 dark:bg-gray-800">
      <div className="flex-shrink-0">{icons[type]}</div>
      <div className="ml-3 w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-400">{title}</p>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="ml-4 flex flex-shrink-0">
        <button
          type="button"
          className="press-animated inline-flex rounded-md bg-white text-gray-400 hover:text-gray-500"
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
