/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable react/function-component-definition */
import { FC, useCallback, useEffect, useMemo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarProvider, TabsProvider } from 'renderer/contexts';
import { useSidebar, useTabs, useTheme } from 'renderer/hooks';
import useOpenPLCStore from 'renderer/store';
import { Layout } from 'renderer/templates';
import { CONSTANTS } from 'srcRoot/shared/data';
import { convertToPath } from 'srcRoot/utils';

/**
 * Destructure necessary values from the CONSTANTS module
 */
const { paths } = CONSTANTS;
/**
 * Main functional component for the application
 * @component
 */
const MainComponent: FC = () => {
  /**
   * Access the navigate function from 'react-router-dom'
   * @useNavigate
   */
  const navigate = useNavigate();
  /**
   * Access the navigate function from the useSidebar custom hook
   * @useSidebar
   */
  const { navigate: sidebarNavigate } = useSidebar();
  /**
   * Access project-related functions and values from the custom store hook
   * @useOpenPLCStore
   */
  const setWorkspaceData = useOpenPLCStore.useSetWorkspace();
  const project = useOpenPLCStore.useProjectData();
  /**
   * Access tab-related functions from the custom hook
   * @useTabs
   */
  const { addTab } = useTabs();
  /**
   * Access theme-related functions and values from the custom hook
   * @useTheme
   */
  const { theme } = useTheme();

  /**
   * Asynchronous function to fetch project data and update the workspace.
   *
   * This function uses the bridge to create a new project and open an existing project.
   * It then updates the workspace data with the obtained projectPath and projectAsObj.
   *
   * @remarks
   * This function is designed to be used as a callback with the `useCallback` hook.
   *
   * @example
   * const getProjectData = useCallback(() => {
   *   getProjectData();
   * }, [setWorkspaceData]);
   */
  const getProjectData = useCallback(() => {
    window.bridge.createProject((_event, value) => {
      const { projectPath, projectAsObj } = value;
      setWorkspaceData({ projectPath, projectData: projectAsObj });
    });
    window.bridge.openProject((_event, value) => {
      const { projectPath, projectAsObj } = value;
      setWorkspaceData({ projectPath, projectData: projectAsObj });
    });
  }, [setWorkspaceData]);

  const getPousToEdit = useCallback(() => {
    if (project) {
      const pous = project.project.types.pous.pou;
      if (!pous) return;
      if (pous.length > 0) {
        sidebarNavigate('projectTree');
        pous.map((pou) => {
          addTab({
            id: pou['@name'],
            title: pou['@name'],
            onClick: () => navigate(convertToPath([paths.EDITOR, pou['@name']])),
            onClickCloseButton: () => navigate(paths.MAIN),
          });
          return true;
        });
        navigate(convertToPath([paths.EDITOR, pous[0]['@name']]));
      }
    }
  }, [addTab, navigate, project, sidebarNavigate]);

  /**
   * Get project data on mount
   * Handle navigation and tab addition based on POU data
   */
  useEffect(() => {
    getProjectData();
    getPousToEdit();
  }, [getProjectData, getPousToEdit]);

  console.table(project?.project.types.pous.pou);
  /**
   * Navigate to the main path if the project data is not available
   */
  useEffect(() => {
    if (!project) navigate(paths.MAIN);
  }, [navigate, project]);

  if (!theme) return <></>;

  return <Layout main={<Outlet />} />;
};
/**
 * Wrapper component providing context providers for tabs and sidebar
 * @component
 */
const Main: FC = () => (
  <TabsProvider>
    <SidebarProvider>
      <MainComponent />
    </SidebarProvider>
  </TabsProvider>
);

export default Main;
