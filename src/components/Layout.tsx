import React from 'react';
import { ResizableBox } from 'react-resizable';

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
  return (
    // h-screen w-screen overflow-hidden
    <div className="layout-grid  h-screen w-screen overflow-hidden">
      <div className="flex items-center top-row border-b border-gray-200 h-14 dark:border-gray-700">
        {topRow}
      </div>
      <ResizableBox
        width={300}
        height={Infinity}
        className="left-column border-r border-gray-200 dark:border-gray-700"
        minConstraints={[300, Infinity]}
        resizeHandles={['e']}
        axis="x"
      >
        {leftColumn}
      </ResizableBox>
      <main className="flex-1 main-content">{mainContent}</main>
      <ResizableBox
        width={300}
        height={Infinity}
        className="right-column border-l border-gray-200 dark:border-gray-700"
        minConstraints={[300, Infinity]}
        resizeHandles={['w']}
        axis="x"
      >
        {rightColumn}
      </ResizableBox>
      <ResizableBox
        width={Infinity}
        height={300}
        className="bottom-row border-t border-gray-200 dark:border-gray-700"
        minConstraints={[Infinity, 300]}
        resizeHandles={['n']}
        axis="y"
      >
        {bottomRow}
      </ResizableBox>
    </div>
  );
};

export default Layout;
