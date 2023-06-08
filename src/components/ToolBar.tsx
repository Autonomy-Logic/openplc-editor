import { CONSTANTS } from '@shared/constants';
import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { Fragment, useCallback, useEffect, useRef } from 'react';
import Draggable, { DraggableData, DraggableEvent } from 'react-draggable';
import { useTranslation } from 'react-i18next';
import { IconType } from 'react-icons';
import { HiMoon, HiSun, HiXMark } from 'react-icons/hi2';

import { useTheme, useWindowSize } from '@/hooks';
import { classNames } from '@/utils';

import Toggle from './Toggle';
import Tooltip from './Tooltip';

const {
  theme: { variants },
} = CONSTANTS;

export type ToolsProps = {
  id: number;
  icon?: IconType;
  className?: string;
  onClick?: () => void;
  tooltip?: string;
  divider?: 'before' | 'after';
  type?: 'toggleTheme';
};

export type ToolbarProps = {
  tools: ToolsProps[];
  position: ToolbarPositionProps;
  setPosition: React.Dispatch<React.SetStateAction<ToolbarPositionProps>>;
  title?: string;
  isCurrentToolbar?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
};

const Toolbar: React.FC<ToolbarProps> = ({
  tools,
  position,
  setPosition,
  title,
  isCurrentToolbar,
  onMouseDown,
}) => {
  const { t } = useTranslation('toolbar');
  const { width, height } = useWindowSize();
  const { theme, toggleTheme } = useTheme();
  const nodeRef = useRef<HTMLDivElement>(null);

  const isFloatingOnScreen = position.y > 0;

  const onDrag = (_e: DraggableEvent, data: DraggableData) =>
    setPosition({ x: data.x, y: data.y });

  const handleCancelFloating = () => setPosition({ x: 0, y: 0 });

  useEffect(() => {
    setPosition((state) => ({
      x: state.x > width ? state.x - width : state.x,
      y: state.y > height ? state.y - height : state.y,
    }));
  }, [width, height, setPosition]);

  useEffect(() => {
    setPosition((state) => (state.y === 0 ? { ...state, y: 0 } : state));
  }, [width, height, setPosition]);

  const overlayCheck = useCallback(() => {
    const points = document.querySelectorAll('.react-draggable');
    const rightPos = (elem: Element) => elem.getBoundingClientRect().right;
    const leftPos = (elem: Element) => elem.getBoundingClientRect().left;
    const topPos = (elem: Element) => elem.getBoundingClientRect().top;
    const btmPos = (elem: Element) => elem.getBoundingClientRect().bottom;

    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < points.length; j++) {
        const isOverlapping = !(
          rightPos(points[i]) < leftPos(points[j]) ||
          leftPos(points[i]) > rightPos(points[j]) ||
          btmPos(points[i]) < topPos(points[j]) ||
          topPos(points[i]) > btmPos(points[j])
        );
        if (isOverlapping && j !== i) {
          //
        }
      }
    }
  }, []);

  const Divider = () => {
    return (
      <div className="h-full w-[0.125rem] bg-gray-200 rounded shadow-inner dark:bg-gray-700" />
    );
  };

  if (!position || !theme) return <></>;

  return (
    <Draggable
      axis="both"
      handle=".handle"
      bounds="body"
      onDrag={onDrag}
      position={position}
      grid={[1, isFloatingOnScreen ? 1 : 250]}
      nodeRef={nodeRef}
      onMouseDown={onMouseDown}
      onStop={overlayCheck}
    >
      <div
        ref={nodeRef}
        className={classNames(
          'flex gap-3 p-2 bg-white dark:bg-gray-900',
          isFloatingOnScreen ? 'shadow h-14' : 'h-full',
          isCurrentToolbar ? 'z-40' : 'z-30',
        )}
      >
        {tools.map(({ id, onClick, icon: Icon, className, tooltip, divider, type }) => (
          <Fragment key={id}>
            {type === 'toggleTheme' && (
              <div className="press-animated flex items-center justify-center">
                <Tooltip label={t('menuToolbar.toggleTheme')}>
                  <Toggle
                    data-tooltip-target="tooltip"
                    enabled={theme === variants.DARK}
                    setEnabled={toggleTheme}
                    icons={{
                      enabled: <HiMoon className="h-3 w-3 text-open-plc-blue" />,
                      disabled: <HiSun className="h-4 w-4 text-gray-400" />,
                    }}
                  />
                </Tooltip>
              </div>
            )}
            {divider === 'before' && <Divider />}
            <Tooltip label={tooltip}>
              <button
                className="press-animated"
                data-tooltip-target="tooltip"
                type="button"
                onClick={() => onClick && onClick()}
              >
                {Icon && (
                  <Icon
                    className={`h-6 w-6 text-gray-500 hover:opacity-90 ${className}`}
                  />
                )}
              </button>
            </Tooltip>
            {divider === 'after' && <Divider />}
          </Fragment>
        ))}
        {isFloatingOnScreen && (
          <div className="flex justify-center items-center handle cursor-move absolute bg-gray-400 h-5 -top-5 left-0 w-full dark:bg-gray-800">
            <span className="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-gray-500">
              {title}
            </span>
            <Tooltip label={t('common.close')}>
              <button
                className="press-animated"
                data-tooltip-target="tooltip"
                type="button"
                onClick={handleCancelFloating}
              >
                <HiXMark className="h-4 w-4 text-gray-800 mr-1 dark:text-gray-500" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </Draggable>
  );
};

export default Toolbar;
