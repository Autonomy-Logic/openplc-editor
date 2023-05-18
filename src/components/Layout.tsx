import React from 'react';
import { ResizableBox } from 'react-resizable';

import { useFullScreen } from '@/hooks';

export type LayoutProps = {
  topRow: React.ReactNode;
  rightColumn: React.ReactNode;
  bottomRow: React.ReactNode;
  leftColumn: React.ReactNode;
  mainContent: React.ReactNode;
};

const Layout: React.FC<LayoutProps> = ({
  topRow,
  rightColumn,
  bottomRow,
  leftColumn,
  mainContent,
}) => {
  const { isFullScreen } = useFullScreen();
  const initialSize = 300;

  return (
    <div
      className={`layout-grid ${isFullScreen ? 'h-screen' : 'h-[calc(100vh_-_30px)]'}`}
    >
      <header className="flex items-center top-row border-b border-gray-200 h-14 dark:border-gray-700">
        {topRow}
      </header>
      <ResizableBox
        width={initialSize}
        height={Infinity}
        className="left-column border-r border-gray-200 dark:border-gray-700"
        minConstraints={[initialSize, Infinity]}
        resizeHandles={['e']}
        axis="x"
      >
        {leftColumn}
      </ResizableBox>
      <main className="main-content">{mainContent}</main>
      <ResizableBox
        width={initialSize}
        height={Infinity}
        className="right-column border-l border-gray-200 dark:border-gray-700"
        minConstraints={[initialSize, Infinity]}
        resizeHandles={['w']}
        axis="x"
      >
        {rightColumn}
      </ResizableBox>
      <ResizableBox
        width={Infinity}
        height={initialSize}
        className="bottom-row border-t border-gray-200 dark:border-gray-700"
        minConstraints={[Infinity, initialSize]}
        resizeHandles={['n']}
        axis="y"
      >
        {bottomRow}
      </ResizableBox>
    </div>
  );
};

export default Layout;
