import { CONSTANTS } from '@shared/constants';
import { ToolbarPositionProps } from '@shared/types/toolbar';
import React, { useCallback, useEffect } from 'react';
import { useState } from 'react';

import { useProject } from '@/hooks';

import EditorToolbar from './EditorToolbar';
import MenuToolbar from './MenuToolbar';
import StatusToolbar from './StatusToolbar';

const { languages } = CONSTANTS;

const TopRow: React.FC = () => {
  const [currentMenuToolbarPosition, setCurrentMenuToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentEditorToolbarPosition, setCurrentEditorToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentStatusToolbarPosition, setCurrentStatusToolbarPosition] =
    useState<ToolbarPositionProps>({ x: 0, y: 0 });
  const [currentToolbar, setCurrentToolbar] = useState<string>();
  const { project } = useProject();

  const isLDLanguage = project?.language === languages.LD;

  const addTopRow = useCallback(
    (position: ToolbarPositionProps) =>
      (position.y > 0 && position.y <= 28) || position.y === 0,
    [],
  );

  const removeTopRow = useCallback(
    (position: ToolbarPositionProps) => position.y > 0,
    [],
  );

  useEffect(() => {
    const topRow = document.getElementById('top-row');
    const toolbarsPositions = [
      currentMenuToolbarPosition,
      ...(isLDLanguage ? [currentEditorToolbarPosition] : []),
      ...(isLDLanguage ? [currentStatusToolbarPosition] : []),
    ];
    if (toolbarsPositions.map((position) => addTopRow(position)).includes(true)) {
      topRow?.classList.remove('hide-top-row');
    } else if (
      !toolbarsPositions.map((position) => removeTopRow(position)).includes(false)
    ) {
      topRow?.classList.add('hide-top-row');
    }
  }, [
    addTopRow,
    currentEditorToolbarPosition,
    currentMenuToolbarPosition,
    currentStatusToolbarPosition,
    isLDLanguage,
    removeTopRow,
  ]);

  return (
    <>
      {isLDLanguage && (
        <>
          <StatusToolbar
            currentPosition={setCurrentStatusToolbarPosition}
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
        currentPosition={setCurrentMenuToolbarPosition}
        onMouseDown={() => setCurrentToolbar('menuToolbar')}
        isCurrentToolbar={currentToolbar === 'menuToolbar'}
      />
    </>
  );
};

export default TopRow;
