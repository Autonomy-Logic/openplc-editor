import React, { useContext, useState } from 'react';
import { Tree, TreeNodeInfo, Menu, MenuItem, ContextMenuTarget, Classes } from '@blueprintjs/core';
import { ProjectContext } from '../../contexts/ProjectContext';
import { ProjectItem, ProjectItemType } from '../../types/project';
import { useProjectOperations } from '../../hooks/useProjectOperations';

interface ProjectTreeProps {
  items: ProjectItem[];
  onItemSelected: (item: ProjectItem) => void;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({ items, onItemSelected }) => {
  const { project } = useContext(ProjectContext);
  const { deleteItem } = useProjectOperations();
  const [contextMenu, setContextMenu] = useState<{
    item: ProjectItem;
    isOpen: boolean;
    x: number;
    y: number;
  } | null>(null);

  const handleItemContextMenu = (item: ProjectItem, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      item,
      isOpen: true,
      x: e.clientX,
      y: e.clientY
    });
  };

  const handleExport = (item: ProjectItem) => {
    // Trigger export functionality
    window.electron.ipcRenderer.send('export-item', {
      projectId: project?.id,
      itemId: item.id,
      itemType: item.type
    });
    setContextMenu(null);
  };

  const handleDelete = (item: ProjectItem) => {
    deleteItem(item.id);
    setContextMenu(null);
  };

  const renderTree = (items: ProjectItem[]): React.ReactNode => {
    return items.map((item) => {
      const node: TreeNodeInfo = {
        id: item.id,
        label: item.name,
        isSelected: false,
        icon: getItemIcon(item.type),
        hasCaret: item.children && item.children.length > 0,
        childNodes: item.children ? renderTree(item.children) : undefined,
        onContextMenu: (e) => handleItemContextMenu(item, e)
      };

      return (
        <Tree 
          key={item.id}
          contents={[node]}
          onNodeClick={(node, _path, e) => {
            if (e.detail === 1) { // Single click
              onItemSelected(item);
            }
          }}
          onNodeContextMenu={(node, e) => handleItemContextMenu(item, e)}
        />
      );
    });
  };

  const getItemIcon = (type: ProjectItemType): string => {
    switch (type) {
      case 'folder': return 'folder-close';
      case 'program': return 'document';
      case 'function': return 'function';
      case 'variable': return 'variable';
      default: return 'document';
    }
  };

  return (
    <div className="project-tree">
      {renderTree(items)}
      
      <Menu 
        isOpen={contextMenu?.isOpen}
        onClose={() => setContextMenu(null)}
        style={{
          position: 'fixed',
          left: contextMenu?.x,
          top: contextMenu?.y
        }}
      >
        <MenuItem 
          text="Export" 
          icon="export" 
          onClick={() => contextMenu && handleExport(contextMenu.item)} 
        />
        <MenuItem 
          text="Delete" 
          icon="trash" 
          onClick={() => contextMenu && handleDelete(contextMenu.item)} 
        />
      </Menu>
    </div>
  );
};