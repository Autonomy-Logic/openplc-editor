import React, { useState, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ContextMenu, MenuItem, ContextMenuTrigger } from 'react-contextmenu';
import { TreeView, TreeItem } from '@mui/lab';
import { Typography, IconButton } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { addProjectItem, removeProjectItem, duplicateProjectItem } from '../../../store/projectSlice';
import { ProjectItem, ProjectItemType } from '../../../types/project';
import { generateId } from '../../../utils/idGenerator';

interface ProjectExplorerProps {
  projectId: string;
}

const ProjectExplorer: React.FC<ProjectExplorerProps> = ({ projectId }) => {
  const dispatch = useDispatch();
  const projectItems = useSelector((state: any) => state.project.items);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const handleExpandClick = useCallback((itemId: string) => {
    setExpandedItems(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId) 
        : [...prev, itemId]
    );
  }, []);

  const handleAddItem = useCallback((type: ProjectItemType, parentId?: string) => {
    const newItem: ProjectItem = {
      id: generateId(),
      name: `New ${type}`,
      type,
      parentId,
      children: [],
    };
    dispatch(addProjectItem(newItem));
  }, [dispatch]);

  const handleDeleteItem = useCallback((itemId: string) => {
    dispatch(removeProjectItem(itemId));
  }, [dispatch]);

  const handleDuplicateItem = useCallback((item: ProjectItem) => {
    const duplicatedItem: ProjectItem = {
      ...item,
      id: generateId(),
      name: `${item.name} (Copy)`,
      children: item.children ? item.children.map(child => ({
        ...child,
        id: generateId()
      })) : []
    };
    
    dispatch(duplicateProjectItem({
      item: duplicatedItem,
      parentId: item.parentId
    }));
  }, [dispatch]);

  const renderTreeItem = useCallback((item: ProjectItem) => {
    const hasChildren = item.children && item.children.length > 0;
    
    return (
      <TreeItem 
        key={item.id} 
        nodeId={item.id}
        label={
          <ContextMenuTrigger id={`context-menu-${item.id}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Typography variant="body2">{item.name}</Typography>
              <div>
                <IconButton 
                  size="small" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddItem('ladder', item.id);
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
                <IconButton 
                  size="small" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteItem(item.id);
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </div>
            </div>
          </ContextMenuTrigger>
        }
      >
        {hasChildren && item.children!.map(renderTreeItem)}
      </TreeItem>
    );
  }, [handleAddItem, handleDeleteItem]);

  const treeItems = useMemo(() => 
    projectItems
      .filter(item => !item.parentId)
      .map(renderTreeItem), 
    [projectItems, renderTreeItem]
  );

  return (
    <div>
      <TreeView
        expanded={expandedItems}
        onNodeToggle={(event, nodeIds) => setExpandedItems(nodeIds)}
      >
        {treeItems}
      </TreeView>
      
      {projectItems.map(item => (
        <ContextMenu 
          key={item.id} 
          id={`context-menu-${item.id}`}
        >
          <MenuItem 
            onClick={() => handleAddItem('ladder', item.id)}
          >
            <AddIcon fontSize="small" style={{ marginRight: 8 }} />
            Add Ladder Program
          </MenuItem>
          <MenuItem 
            onClick={() => handleDuplicateItem(item)}
          >
            <EditIcon fontSize="small" style={{ marginRight: 8 }} />
            Duplicate
          </MenuItem>
          <MenuItem 
            onClick={() => handleDeleteItem(item.id)}
          >
            <DeleteIcon fontSize="small" style={{ marginRight: 8 }} />
            Delete
          </MenuItem>
        </ContextMenu>
      ))}
    </div>
  );
};

export default ProjectExplorer;