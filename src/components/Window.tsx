import { XCircleIcon } from '@heroicons/react/20/solid';
import React, { PropsWithChildren } from 'react';
import Draggable, { ControlPosition } from 'react-draggable';
import { useTranslation } from 'react-i18next';

import Tooltip from './Tooltip';

export type WindowProps = {
  closeWindow: () => void;
  title: string;
  defaultPosition?: ControlPosition;
};

const Window: React.FC<PropsWithChildren<WindowProps>> = ({
  title,
  defaultPosition,
  closeWindow,
  children,
}) => {
  const { t } = useTranslation('toolbar');

  return (
    <Draggable
      axis="both"
      handle=".handle"
      bounds="body"
      defaultPosition={defaultPosition || { x: 0, y: 0 }}
    >
      <div className="min-h-[12rem] min-w-[12rem] shadow bg-white z-50 dark:bg-gray-900">
        <div className="flex justify-center items-center handle cursor-move bg-gray-400 h-5 w-full dark:bg-gray-800">
          <span className="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-gray-500">
            {title}
          </span>
          <Tooltip label={t('close')}>
            <button
              className="press-animated"
              data-tooltip-target="tooltip"
              type="button"
              onClick={closeWindow}
            >
              <XCircleIcon className="h-4 w-4 text-gray-800 mr-1 dark:text-gray-500" />
            </button>
          </Tooltip>
        </div>
        <div className="p-2">{children}</div>
      </div>
    </Draggable>
  );
};

export default Window;
