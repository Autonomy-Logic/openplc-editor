/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable react/function-component-definition */
/* eslint-disable import/no-cycle */
import { FC, useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { CONSTANTS } from '../../constants';

import { SidebarProvider, TabsProvider } from '../contexts';
import { useTabs, useTheme, useSidebar } from '../hooks';
import { Layout } from '../templates';
import { convertToPath } from '../../utils';

import useOpenPLCStore from '../store';

/**
 * Destructure necessary values from the CONSTANTS module
 */
const { paths } = CONSTANTS;
/**
 * Main functional component for the application
 * @component
 */
const MainComponent: FC = () => {
  const setWorkspaceData = useOpenPLCStore.useSetWorkspace();
  const project = useOpenPLCStore.useProjectData();
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
   * Access project-related functions and values from the custom hook
   * @useProject
   */
  // const project = null
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
   * Access titlebar-related functions and values from the custom hook
   * @useTitlebar
   */
  // const { titlebar } = useTitlebar();
  /**
   * Access modal-related functions from the custom hook and open a modal for creating a POU
   * @useModal
   */
  // const { handleOpenModal } = useModal({
  //   content: <CreatePOU />,
  //   hideCloseButton: true,
  // });
  // /**
  //  * Listen for IPC render event to open the CreatePOU modal
  //  */
  // useIpcRender<undefined, void>({
  //   channel: get.CREATE_POU_WINDOW,
  //   callback: () => handleOpenModal(),
  // });

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
   *   // Usage of the function
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
  /**
   * Get project data on mount
   */
  useEffect(() => {
    getProjectData();
  }, [getProjectData]);
  /**
   * Handle navigation and tab addition based on POU data
   */
  useEffect(() => {
    const pouName = 'dummyPou';

    if (pouName) {
      sidebarNavigate('projectTree');
      addTab({
        id: pouName,
        title: pouName,
        onClick: () => navigate(convertToPath([paths.EDITOR, pouName])),
        onClickCloseButton: () => navigate(paths.MAIN),
      });
      navigate(convertToPath([paths.EDITOR, pouName]));
    }
  }, [addTab, navigate, sidebarNavigate]);
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
