import React from 'react';
import { ResizableBox } from 'react-resizable';

import { useFullScreen } from '@/hooks';

import BottomRow from './BottomRow';
import LeftColumn from './LeftColumn';
import RightColumn from './RightColumn';
import TopRow from './TopRow';

const Layout: React.FC = () => {
  const { isFullScreen } = useFullScreen();
  const initialSize = 300;

  return (
    <>
      <header
        id="top-row"
        className="flex items-center border-b border-gray-200 h-14 dark:border-gray-700 z-40"
      >
        <TopRow />
      </header>
      <div
        className={`layout-grid ${
          isFullScreen ? 'h-screen' : 'h-[calc(100vh_-_1.875rem)]'
        }`}
      >
        <ResizableBox
          width={initialSize}
          height={Infinity}
          className="left-column border-r border-gray-200 dark:border-gray-700"
          minConstraints={[initialSize, Infinity]}
          resizeHandles={['e']}
          axis="x"
        >
          <LeftColumn />
        </ResizableBox>
        <main className="main-content"></main>
        <ResizableBox
          width={initialSize}
          height={Infinity}
          className="right-column border-l border-gray-200 dark:border-gray-700"
          minConstraints={[initialSize, Infinity]}
          resizeHandles={['w']}
          axis="x"
        >
          <RightColumn />
        </ResizableBox>
        <ResizableBox
          width={Infinity}
          height={initialSize}
          className="bottom-row border-t border-gray-200 dark:border-gray-700"
          minConstraints={[Infinity, initialSize]}
          resizeHandles={['n']}
          axis="y"
        >
          <BottomRow />
        </ResizableBox>
      </div>
    </>
  );
};

export default Layout;
