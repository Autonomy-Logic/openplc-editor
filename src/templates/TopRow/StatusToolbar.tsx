import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BiRun } from 'react-icons/bi';
import { HiArrowDown, HiCpuChip, HiEllipsisVertical } from 'react-icons/hi2';

import { Toolbar } from '@/components';
import { ToolsProps } from '@/components/Toolbar';

type StatusToolbarProps = {
  currentPosition: React.Dispatch<React.SetStateAction<ToolbarPositionProps>>;
  isCurrentToolbar?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
};

const StatusToolbar: React.FC<StatusToolbarProps> = ({
  currentPosition,
  isCurrentToolbar,
  onMouseDown,
}) => {
  const { t } = useTranslation('toolbar');
  const [position, setPosition] = useState<ToolbarPositionProps>({ x: 0, y: 0 });

  const onClick = () => console.log('will be created soon');

  const statusTools: ToolsProps[] = [
    {
      id: 0,
      icon: HiEllipsisVertical,
      className: 'handle cursor-move',
    },
    {
      id: 1,
      onClick,
      icon: BiRun,
      tooltip: t('statusToolbar.startSimulation'),
    },
    {
      id: 2,
      onClick,
      icon: HiArrowDown,
      tooltip: t('statusToolbar.generateProgram'),
    },
    {
      id: 3,
      onClick,
      icon: HiCpuChip,
      tooltip: t('statusToolbar.transferProgram'),
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
      title={t('statusToolbar.title')}
      tools={statusTools}
      position={position}
      setPosition={setPosition}
      isCurrentToolbar={isCurrentToolbar}
      onMouseDown={onMouseDown}
    />
  );
};

export default StatusToolbar;
