/* eslint-disable no-console */
import { useCallback, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useOpenPLCStore } from 'srcRoot/renderer/store';
import { TXmlProject } from 'srcRoot/shared/contracts/types';

export default function StartLayout() {
  const location = useLocation();
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
    console.log(location.pathname);
  }, [location.pathname, setDataForWorkspace]);

  return (
    <>
      <h1>Start Layout</h1>
      <Outlet />
    </>
  );
}
