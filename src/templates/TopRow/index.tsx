import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { useEffect } from 'react';
import { useState } from 'react';

import { useProject } from '@/hooks';

import EditorToolbar from './EditorToolbar';
import MenuToolbar from './MenuToolbar';
import StatusToolbar from './StatusToolbar';

const TopRow: React.FC = () => {
  const [currentMenuToolbarPosition, setCurrentMenuToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentEditorToolbarPosition, setCurrentEditorToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentStatusToolbarPosition, setCurrentStatusToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentToolbar, setCurrentToolbar] = useState<string>();
  const { project } = useProject();

  const isFloatingMenuToolbar = currentMenuToolbarPosition.y > 0;
  const isFloatingEditorToolbar = currentEditorToolbarPosition.y > 0;
  const isFloatingStatusToolbar = currentStatusToolbarPosition.y > 0;

  useEffect(() => {
    const topRow = document.getElementById('top-row');
    if (
      (isFloatingMenuToolbar && currentMenuToolbarPosition.y <= 28) ||
      currentMenuToolbarPosition?.y === 0 ||
      (isFloatingEditorToolbar && currentEditorToolbarPosition.y <= 28) ||
      currentEditorToolbarPosition?.y === 0 ||
      (isFloatingStatusToolbar && currentStatusToolbarPosition.y <= 28) ||
      currentStatusToolbarPosition?.y === 0
    ) {
      topRow?.classList.remove('hide-top-row');
    } else if (
      isFloatingMenuToolbar &&
      isFloatingEditorToolbar &&
      isFloatingStatusToolbar
    ) {
      topRow?.classList.add('hide-top-row');
    }
  }, [
    currentEditorToolbarPosition.y,
    currentMenuToolbarPosition.y,
    currentStatusToolbarPosition.y,
    isFloatingEditorToolbar,
    isFloatingMenuToolbar,
    isFloatingStatusToolbar,
  ]);

  return (
    <>
      {project && (
        <>
          <StatusToolbar
            currentPosition={setCurrentMenuToolbarPosition}
            onMouseDown={() => setCurrentToolbar('statusToolbar')}
            isCurrentToolbar={currentToolbar === 'statusToolbar'}
          />
          <EditorToolbar
            currentPosition={setCurrentEditorToolbarPosition}
            onMouseDown={() => setCurrentToolbar('editorToolbar')}
            isCurrentToolbar={currentToolbar === 'editorToolbar'}
          />
        </>
      )}
      <MenuToolbar
        currentPosition={setCurrentStatusToolbarPosition}
        onMouseDown={() => setCurrentToolbar('menuToolbar')}
        isCurrentToolbar={currentToolbar === 'menuToolbar'}
      />
    </>
  );
};

export default TopRow;
