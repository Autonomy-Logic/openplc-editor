import { XCircleIcon } from '@heroicons/react/20/solid';
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
import { CONSTANTS } from '@shared/constants';
import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { Fragment, useEffect, useState } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { useTranslation } from 'react-i18next';

import { useFullScreen, useIpcRender, useTheme, useWindowSize } from '@/hooks';
import { classNames } from '@/utils';

import Toggle from './Toggle';
import Tooltip from './Tooltip';

const {
  theme: { variants },
  channels: { get, set },
} = CONSTANTS;

const Toolbar: React.FC = () => {
  const { t } = useTranslation('toolbar');
  const [position, setPosition] = useState<ToolbarPositionProps | null>(null);
  const { requestFullscreen, exitFullScreen, isFullScreen } = useFullScreen();
  const { width, height } = useWindowSize();
  const { send, data: storedPosition } = useIpcRender<ToolbarPositionProps>({
    get: get.TOOLBAR_POSITION,
    set: set.TOOLBAR_POSITION,
  });

  const onClick = () => console.log('will be created soon');

  const tools = [
    {
      id: 0,
      icon: EllipsisVerticalIcon,
      className: 'handle cursor-move',
    },
    {
      id: 1,
      onClick,
      icon: DocumentPlusIcon,
      className: '',
      tooltip: t('new'),
    },
    {
      id: 2,
      onClick,
      icon: FolderOpenIcon,
      className: '',
      tooltip: t('open'),
    },
    {
      id: 3,
      onClick,
      icon: ArrowDownTrayIcon,
      className: '',
      tooltip: t('save'),
    },
    {
      id: 4,
      onClick,
      icon: ArrowDownOnSquareStackIcon,
      className: '',
      tooltip: t('saveAs'),
    },
    {
      id: 5,
      onClick,
      icon: PrinterIcon,
      className: '',
      tooltip: t('print'),
    },
    {
      id: 6,
      onClick,
      icon: ArrowUturnLeftIcon,
      className: '',
      tooltip: t('undo'),
      divider: 'before',
    },
    {
      id: 7,
      onClick,
      icon: ArrowUturnRightIcon,
      className: '',
      tooltip: t('redo'),
      divider: 'after',
    },

    {
      id: 8,
      onClick,
      icon: ScissorsIcon,
      className: '',
      tooltip: t('cut'),
    },
    {
      id: 9,
      onClick,
      icon: DocumentDuplicateIcon,
      className: '',
      tooltip: t('copy'),
    },
    {
      id: 10,
      onClick,
      icon: ClipboardDocumentIcon,
      className: '',
      tooltip: t('paste'),
    },
    {
      id: 11,
      onClick,
      icon: DocumentMagnifyingGlassIcon,
      className: '',
      tooltip: t('search'),
    },
    {
      id: 12,
      onClick: () => (isFullScreen ? exitFullScreen() : requestFullscreen()),
      icon: isFullScreen ? ArrowsPointingInIcon : ArrowsPointingOutIcon,
      className: '',
      tooltip: t('fullScreen'),
    },
  ];

  const isFloatingOnScreen = position && position.y > 0;

  const { theme, toggleTheme } = useTheme();

  const onDrag = (_e: DraggableEvent, data: DraggableData) => {
    setPosition({
      x: data.x,
      y: data.y,
    });
  };

  const onStop = (_e: DraggableEvent, data: DraggableData) => {
    send({
      x: data.x,
      y: data.y,
    });
  };

  const handleCancelFloating = () => setPosition({ x: 0, y: 0 });

  useEffect(() => {
    if (storedPosition)
      setPosition((state) => ({
        x: !state
          ? storedPosition.x > width
            ? storedPosition.x - width
            : storedPosition.x
          : state.x > width
          ? state.x - width
          : state.x,
        y: !state
          ? storedPosition.y > height
            ? storedPosition.y - height
            : storedPosition.y
          : state.y > height
          ? state.y - height
          : state.y,
      }));
  }, [storedPosition, width, height]);

  useEffect(() => {
    setPosition((state) => state && (state.y === 0 ? { ...state, y: 0 } : state));
  }, [width, height]);

  useEffect(() => {
    const topRow = document.getElementById('top-row');
    if ((isFloatingOnScreen && position.y <= 28) || position?.y === 0) {
      topRow?.classList.remove('hide-top-row');
      setPosition((state) => state && { ...state, y: 0 });
    } else if (isFloatingOnScreen) topRow?.classList.add('hide-top-row');
  }, [isFloatingOnScreen, position?.y]);

  const Divider = () => {
    return (
      <div className="h-full w-[0.125rem] bg-gray-200 rounded shadow-inner dark:bg-gray-700" />
    );
  };

  if (!position || !theme) return <>loading</>;

  return (
    <Draggable
      axis="both"
      handle=".handle"
      bounds="body"
      onStop={onStop}
      onDrag={onDrag}
      position={position}
      defaultPosition={position}
      grid={[1, isFloatingOnScreen ? 1 : 250]}
    >
      <div
        className={classNames(
          'flex gap-3 p-2 bg-white dark:bg-gray-900 z-40',
          isFloatingOnScreen ? 'shadow h-14' : 'h-full',
        )}
      >
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
                <Icon className={`h-6 w-6 text-gray-500 ${className}`} />
              </button>
            </Tooltip>
            {divider === 'after' && <Divider />}
          </Fragment>
        ))}

        <div className="press-animated flex items-center justify-center">
          <Tooltip label={t('toggleTheme')}>
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
        {isFloatingOnScreen && (
          <div className="flex justify-center items-center handle cursor-move absolute bg-gray-400 h-5 -top-5 left-0 w-full dark:bg-gray-800">
            <span className="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-gray-500">
              Menu toolbar
            </span>
            <Tooltip label={t('close')}>
              <button
                className="press-animated"
                data-tooltip-target="tooltip"
                type="button"
                onClick={handleCancelFloating}
              >
                <XCircleIcon className="h-4 w-4 text-gray-800 mr-1 dark:text-gray-500" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </Draggable>
  );
};

export default Toolbar;
