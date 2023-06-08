import { ToolbarPositionProps } from '@shared/types/toolbar';
import React from 'react';
import { useState } from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FaRegHandRock } from 'react-icons/fa';
import { HiChevronRight } from 'react-icons/hi2';
import { HiEllipsisVertical } from 'react-icons/hi2';
import { HiOutlineDocument } from 'react-icons/hi2';
import { TbPointer } from 'react-icons/tb';

import { Toolbar } from '@/components';
import { ToolsProps } from '@/components/Toolbar';

type EditorToolbarProps = {
  currentPosition: React.Dispatch<React.SetStateAction<ToolbarPositionProps>>;
  isCurrentToolbar?: boolean;
  onMouseDown?: (e: MouseEvent) => void;
};

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  currentPosition,
  isCurrentToolbar,
  onMouseDown,
}) => {
  const { t } = useTranslation('toolbar');
  const [position, setPosition] = useState<ToolbarPositionProps>({ x: 0, y: 0 });

  const onClick = () => console.log('will be created soon');

  const editorTools: ToolsProps[] = [
    {
      id: 0,
      icon: HiEllipsisVertical,
      className: 'handle cursor-move',
    },
    {
      id: 1,
      onClick,
      icon: TbPointer,
      tooltip: t('editorToolbar.select'),
    },
    {
      id: 2,
      onClick,
      icon: FaRegHandRock,
      tooltip: t('editorToolbar.move'),
    },
    {
      id: 3,
      onClick,
      icon: () => (
        <div className="flex items-end justify-center hover:opacity-90">
          <HiOutlineDocument className="h-7 w-7 text-gray-500 comment-icon" />
          <span className="absolute font-bold mb-1" style={{ fontSize: '0.5rem' }}>
            CMT
          </span>
        </div>
      ),
      tooltip: t('editorToolbar.comment'),
    },
    {
      id: 4,
      onClick,
      icon: () => (
        <div className="relative flex items-center justify-center border-2 border-gray-500 w-8 h-5 hover:opacity-90">
          <span className="font-bold" style={{ fontSize: '0.5rem' }}>
            VAR
          </span>
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -right-2" />
        </div>
      ),
      tooltip: t('editorToolbar.variable'),
    },
    {
      id: 5,
      onClick,
      icon: () => (
        <div className="relative flex items-start justify-center border-2 border-gray-500 w-7 h-8 ml-4 mr-2 hover:opacity-90">
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -left-2 top-1/4" />
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -left-2 top-1/2" />
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -left-2 top-3/4" />
          <span className="font-bold mt-1" style={{ fontSize: '0.5rem' }}>
            FB
          </span>
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -right-2 top-1/4" />
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -right-2 top-3/4" />
        </div>
      ),
      tooltip: t('editorToolbar.block'),
    },
    {
      id: 6,
      onClick,
      icon: () => (
        <div className="relative flex items-center justify-center border-2 border-gray-500 w-8 h-5 mr-4 hover:opacity-90">
          <HiChevronRight className="h-5 w-5 text-gray-500 absolute -left-1" />
          <span className="font-bold" style={{ fontSize: '0.5rem' }}>
            C
          </span>
          <HiChevronRight className="h-5 w-5 text-gray-500 absolute -right-1" />
          <div className="w-2 h-[0.125rem] bg-gray-500 absolute -right-2" />
        </div>
      ),
      tooltip: t('editorToolbar.connection'),
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
      title={t('editorToolbar.title')}
      tools={editorTools}
      position={position}
      setPosition={setPosition}
      isCurrentToolbar={isCurrentToolbar}
      onMouseDown={onMouseDown}
    />
  );
};

export default EditorToolbar;
