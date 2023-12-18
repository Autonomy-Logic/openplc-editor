/* eslint-disable no-console */
import { ReactNode, useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useOpenPLCStore } from 'renderer/store';

import { TXmlProject } from '@/shared/contracts/types';

export default function StartLayout(): ReactNode {
  const navigate = useNavigate();
  const setWorkspaceData = useOpenPLCStore.useSetWorkspace();
  const setDataForWorkspace = useCallback(() => {
    window.bridge.createProject((_event, value) => {
      const { path, xmlAsObject } = value;
      const projectPath = path as unknown as string;
      const projectData = xmlAsObject as unknown as TXmlProject;
      setWorkspaceData({ projectPath, projectData });
      navigate('editor');
    });
  }, [navigate, setWorkspaceData]);

  useEffect(() => {
    setDataForWorkspace();
  }, [setDataForWorkspace]);

  return (
    <>
      <h1>Start Layout</h1>
      <Outlet />
    </>
  );
}
