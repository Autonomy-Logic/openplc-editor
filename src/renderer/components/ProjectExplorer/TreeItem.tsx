import React, { useCallback, useContext, useMemo } from 'react';
import classNames from 'classnames';
import { ContextMenu, Menu, MenuItem } from '@blueprintjs/core';
import { ProjectContext } from '../../contexts/ProjectContext';
import { TreeItemProps } from '../../types';
import { generateUniqueId } from '../../utils/idGenerator';
import { getItemIcon } from '../../utils/iconUtils';

const TreeItem: React.FC<TreeItemProps> = ({ 
  item, 
  depth = 0, 
  onItemClick, 
  onItemDoubleClick,
  expandedItems,
  onToggleExpand
}) => {
  const { projectData, updateProjectData } = useContext(ProjectContext);
  
  const isExpanded = expandedItems.includes(item.id);
  
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    
    const menu = (
      <Menu>
        <MenuItem 
          text="Duplicate" 
          onClick={() => handleDuplicate(item)} 
        />
      </Menu>
    );
    
    ContextMenu.show(menu, { left: e.clientX, top: e.clientY });
  }, [item]);
  
  const handleDuplicate = useCallback((itemToDuplicate: TreeItemProps['item']) => {
    if (!projectData) return;
    
    const duplicatedItem = {
      ...itemToDuplicate,
      id: generateUniqueId(),
      name: `${itemToDuplicate.name} (Copy)`
    };
    
    const newProjectData = { ...projectData };
    
    if (itemToDuplicate.type === 'ladder') {
      if (!newProjectData.ladderPrograms) {
        newProjectData.ladderPrograms = [];
      }
      newProjectData.ladderPrograms.push(duplicatedItem);
    } else if (itemToDuplicate.type === 'functionBlock') {
      if (!newProjectData.functionBlockPrograms) {
        newProjectData.functionBlockPrograms = [];
      }
      newProjectData.functionBlockPrograms.push(duplicatedItem);
    }
    
    updateProjectData(newProjectData);
  }, [projectData, updateProjectData]);
  
  const hasChildren = useMemo(() => {
    return item.children && item.children.length > 0;
  }, [item.children]);
  
  const icon = useMemo(() => getItemIcon(item.type), [item.type]);
  
  return (
    <div 
      className={classNames('tree-item', `tree-item-${item.type}`)}
      style={{ paddingLeft: `${depth * 20}px` }}
      onContextMenu={handleContextMenu}
    >
      <div 
        className="tree-item-content"
        onClick={() => onItemClick(item)}
        onDoubleClick={() => onItemDoubleClick && onItemDoubleClick(item)}
      >
        {hasChildren && (
          <span 
            className="tree-item-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(item.id);
            }}
          >
            {isExpanded ? '−' : '+'}
          </span>
        )}
        <span className="tree-item-icon">{icon}</span>
        <span className="tree-item-name">{item.name}</span>
      </div>
      
      {isExpanded && item.children && (
        <div className="tree-item-children">
          {item.children.map(child => (
            <TreeItem 
              key={child.id}
              item={child}
              depth={depth + 1}
              onItemClick={onItemClick}
              onItemDoubleClick={onItemDoubleClick}
              expandedItems={expandedItems}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TreeItem;