import {
  ArrowDownOnSquareStackIcon,
  ArrowDownTrayIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  DocumentMagnifyingGlassIcon,
  DocumentPlusIcon,
  EllipsisVerticalIcon,
  FolderOpenIcon,
  MoonIcon,
  PrinterIcon,
  ScissorsIcon,
  SunIcon,
} from '@heroicons/react/24/solid';
import React, { Fragment, useEffect, useState } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { useTranslation } from 'react-i18next';

import { useFullScreen, useIpcRender, useTheme, useWindowSize } from '@/hooks';
import { CONSTANTS } from '@/shared';

import Toggle from './Toggle';
import Tooltip from './Tooltip';

const {
  theme: { variants },
  channels,
} = CONSTANTS;

const ToolBar: React.FC = () => {
  const { t } = useTranslation();
  const [position, setPosition] = useState<number>(0);
  const { requestFullscreen, exitFullScreen, isFullScreen } = useFullScreen();
  const { width } = useWindowSize();
  const {
    send,
    data: storedPosition,
    receivedFirstResponse,
  } = useIpcRender<number>({
    get: channels.GET_TOOLBAR_POSITION,
    set: channels.SET_TOOLBAR_POSITION,
  });
  const tools = [
    {
      id: 0,
      icon: EllipsisVerticalIcon,
      className: 'handle cursor-move',
    },
    {
      id: 1,
      onClick: () => console.log('will be created soon'),
      icon: DocumentPlusIcon,
      className: '',
      tooltip: t('toolBar.new'),
    },
    {
      id: 2,
      onClick: () => console.log('will be created soon'),
      icon: FolderOpenIcon,
      className: '',
      tooltip: t('toolBar.open'),
    },
    {
      id: 3,
      onClick: () => console.log('will be created soon'),
      icon: ArrowDownTrayIcon,
      className: '',
      tooltip: t('toolBar.save'),
    },
    {
      id: 4,
      onClick: () => console.log('will be created soon'),
      icon: ArrowDownOnSquareStackIcon,
      className: '',
      tooltip: t('toolBar.saveAs'),
    },
    {
      id: 5,
      onClick: () => console.log('will be created soon'),
      icon: PrinterIcon,
      className: '',
      tooltip: t('toolBar.print'),
    },
    {
      id: 6,
      onClick: () => console.log('will be created soon'),
      icon: ArrowUturnLeftIcon,
      className: '',
      tooltip: t('toolBar.undo'),
      divider: 'before',
    },
    {
      id: 7,
      onClick: () => console.log('will be created soon'),
      icon: ArrowUturnRightIcon,
      className: '',
      tooltip: t('toolBar.redo'),
      divider: 'after',
    },

    {
      id: 8,
      onClick: () => console.log('will be created soon'),
      icon: ScissorsIcon,
      className: '',
      tooltip: t('toolBar.cut'),
    },
    {
      id: 9,
      onClick: () => console.log('will be created soon'),
      icon: DocumentDuplicateIcon,
      className: '',
      tooltip: t('toolBar.copy'),
    },
    {
      id: 10,
      onClick: () => console.log('will be created soon'),
      icon: ClipboardDocumentIcon,
      className: '',
      tooltip: t('toolBar.paste'),
    },
    {
      id: 11,
      onClick: () => console.log('will be created soon'),
      icon: DocumentMagnifyingGlassIcon,
      className: '',
      tooltip: t('toolBar.search'),
    },
    {
      id: 12,
      onClick: () => (isFullScreen ? exitFullScreen() : requestFullscreen()),
      icon: isFullScreen ? ArrowsPointingInIcon : ArrowsPointingOutIcon,
      className: '',
      tooltip: t('toolBar.fullScreen'),
    },
  ];

  const { theme, toggleTheme } = useTheme();

  const onDrag = (_e: DraggableEvent, data: DraggableData) => {
    setPosition(data.x);
  };

  const onStop = (_e: DraggableEvent, data: DraggableData) => {
    send(data.x);
  };

  useEffect(() => {
    if (receivedFirstResponse && storedPosition)
      setPosition((state) =>
        state === 0
          ? storedPosition > width
            ? storedPosition - width
            : storedPosition
          : state > width
          ? state - width
          : state,
      );
  }, [storedPosition, receivedFirstResponse, width]);

  const Divider = () => {
    return <div className="h-full w-[2px] bg-gray-400 rounded dark:bg-gray-600" />;
  };

  if (!receivedFirstResponse || !theme) return <></>;

  return (
    <Draggable
      axis="x"
      handle=".handle"
      bounds="parent"
      onStop={onStop}
      onDrag={onDrag}
      position={{
        x: position,
        y: 0,
      }}
      defaultPosition={{
        x: position,
        y: 0,
      }}
    >
      <div className="flex h-full gap-3 p-2">
        {tools.map(({ id, onClick, icon: Icon, className, tooltip, divider }) => (
          <Fragment key={id}>
            {divider === 'before' && <Divider />}
            <Tooltip label={tooltip}>
              <button
                className="press-animated"
                data-tooltip-target="tooltip"
                type="button"
                onClick={onClick}
              >
                <Icon
                  className={`h-6 w-6 text-gray-500 dark:text-gray-500 ${className}`}
                />
              </button>
            </Tooltip>
            {divider === 'after' && <Divider />}
          </Fragment>
        ))}

        <div className="press-animated flex items-center justify-center">
          <Tooltip label={t('toolBar.toggleTheme')}>
            <Toggle
              data-tooltip-target="tooltip"
              enabled={theme === variants.DARK}
              setEnabled={toggleTheme}
              icons={{
                enabled: <MoonIcon className="h-3 w-3 text-open-plc-blue" />,
                disabled: <SunIcon className="h-4 w-4 text-gray-400" />,
              }}
            />
          </Tooltip>
        </div>
      </div>
    </Draggable>
  );
};

export default ToolBar;
