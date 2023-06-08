import { CONSTANTS } from '@shared/constants';
import { ChildWindowProps } from '@shared/types/childWindow';
import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiArrowDownOnSquareStack,
  HiArrowDownTray,
  HiArrowsPointingIn,
  HiArrowsPointingOut,
  HiArrowUturnLeft,
  HiArrowUturnRight,
  HiClipboard,
  HiDocumentDuplicate,
  HiDocumentMagnifyingGlass,
  HiDocumentPlus,
  HiEllipsisVertical,
  HiFolderOpen,
  HiPrinter,
  HiScissors,
} from 'react-icons/hi2';

import { Toolbar } from '@/components';
import { ToolsProps } from '@/components/Toolbar';
import { useFullScreen, useIpcRender, useProject, useToast } from '@/hooks';

const {
  channels: { set },
  paths,
} = CONSTANTS;

type CreateProjectFromToolbarProps = {
  ok: boolean;
  reason?: { title: string; description?: string };
  data?: string;
};

type MenuToolbarProps = {
  currentPosition: React.Dispatch<React.SetStateAction<ToolbarPositionProps>>;
  isCurrentToolbar?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
};

const MenuToolbar: React.FC<MenuToolbarProps> = ({
  currentPosition,
  isCurrentToolbar,
  onMouseDown,
}) => {
  const { t } = useTranslation('toolbar');
  const [position, setPosition] = useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const { t: createPOUTranslation } = useTranslation('createPOU');
  const { createToast } = useToast();
  const { requestFullscreen, exitFullScreen, isFullScreen } = useFullScreen();
  const { invoke: createProjectFromToolbar } = useIpcRender<
    undefined,
    CreateProjectFromToolbarProps
  >();
  const { invoke: createChildWindow } = useIpcRender<ChildWindowProps>();
  const { getProject } = useProject();

  const onClick = () => console.log('will be created soon');

  const handleCreateProjectFromToolbar = async () => {
    const { ok, reason, data } = await createProjectFromToolbar(
      set.CREATE_PROJECT_FROM_TOOLBAR,
    );
    if (!ok && reason) {
      createToast({
        type: 'error',
        ...reason,
      });
    } else if (ok && data) {
      createChildWindow(set.CREATE_CHILD_WINDOW, {
        path: paths.CREATE_POU,
        resizable: false,
        center: true,
        modal: true,
        minimizable: false,
        fullscreenable: false,
        fullscreen: false,
        width: 576,
        height: 360,
        hideMenuBar: true,
        title: createPOUTranslation('title'),
      });
      await getProject(data);
    }
  };

  const menuTools: ToolsProps[] = [
    {
      id: 0,
      icon: HiEllipsisVertical,
      className: 'handle cursor-move',
    },
    {
      id: 1,
      onClick: handleCreateProjectFromToolbar,
      icon: HiDocumentPlus,
      tooltip: t('menuToolbar.new'),
    },
    {
      id: 2,
      onClick,
      icon: HiFolderOpen,
      tooltip: t('menuToolbar.open'),
    },
    {
      id: 3,
      onClick,
      icon: HiArrowDownTray,
      tooltip: t('menuToolbar.save'),
    },
    {
      id: 4,
      onClick,
      icon: HiArrowDownOnSquareStack,
      tooltip: t('menuToolbar.saveAs'),
    },
    {
      id: 5,
      onClick,
      icon: HiPrinter,
      tooltip: t('menuToolbar.print'),
    },
    {
      id: 6,
      onClick,
      icon: HiArrowUturnLeft,
      tooltip: t('menuToolbar.undo'),
      divider: 'before',
    },
    {
      id: 7,
      onClick,
      icon: HiArrowUturnRight,
      tooltip: t('menuToolbar.redo'),
      divider: 'after',
    },
    {
      id: 8,
      onClick,
      icon: HiScissors,
      tooltip: t('menuToolbar.cut'),
    },
    {
      id: 9,
      onClick,
      icon: HiDocumentDuplicate,
      tooltip: t('menuToolbar.copy'),
    },
    {
      id: 10,
      onClick,
      icon: HiClipboard,
      tooltip: t('menuToolbar.paste'),
    },
    {
      id: 11,
      onClick,
      icon: HiDocumentMagnifyingGlass,
      tooltip: t('menuToolbar.search'),
    },
    {
      id: 12,
      onClick: () => (isFullScreen ? exitFullScreen() : requestFullscreen()),
      icon: isFullScreen ? HiArrowsPointingIn : HiArrowsPointingOut,
      tooltip: t('menuToolbar.fullScreen'),
    },
    {
      id: 13,
      type: 'toggleTheme',
    },
  ];

  useEffect(() => {
    currentPosition(position);
  }, [currentPosition, position]);

  useEffect(() => {
    if ((position.y > 0 && position.y <= 28) || position?.y === 0) {
      setPosition((state) => ({ ...state, y: 0 }));
    }
  }, [position.y]);

  return (
    <Toolbar
      title={t('menuToolbar.title')}
      tools={menuTools}
      position={position}
      setPosition={setPosition}
      isCurrentToolbar={isCurrentToolbar}
      onMouseDown={onMouseDown}
    />
  );
};

export default MenuToolbar;
