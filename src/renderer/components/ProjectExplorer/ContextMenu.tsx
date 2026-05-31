import React, { useCallback } from 'react';
import { Menu, Item, Separator, Submenu } from 'react-contexify';
import 'react-contexify/dist/ReactContexify.css';
import { ProjectItem } from '../../../types/project';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';
import { exportElementAsXml } from '../../services/exportService';

interface ContextMenuProps {
  projectId: string;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ projectId }) => {
  const { project, refreshProject } = useProject();
  const { showNotification } = useNotification();

  const handleDelete = useCallback((item: ProjectItem) => {
    // Delete logic here
  }, []);

  const handleRename = useCallback((item: ProjectItem) => {
    // Rename logic here
  }, []);

  const handleExportAsXml = useCallback(async (item: ProjectItem) => {
    try {
      await exportElementAsXml(item, projectId);
      showNotification('Export successful', 'success');
    } catch (error) {
      showNotification('Export failed: ' + (error as Error).message, 'error');
    }
  }, [projectId, showNotification]);

  return (
    <Menu id="project-explorer-context-menu" animation="fade">
      <Item id="rename" onClick={({ props }) => handleRename(props.item)}>
        Rename
      </Item>
      <Item id="delete" onClick={({ props }) => handleDelete(props.item)}>
        Delete
      </Item>
      <Separator />
      <Submenu label="Export" id="export-submenu">
        <Item 
          id="export-xml" 
          onClick={({ props }) => handleExportAsXml(props.item)}
        >
          As XML
        </Item>
      </Submenu>
    </Menu>
  );
};

export default ContextMenu;