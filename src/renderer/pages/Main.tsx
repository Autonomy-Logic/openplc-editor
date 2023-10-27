/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable react/function-component-definition */
/* eslint-disable import/no-cycle */
import { FC, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Event } from 'electron/renderer';
import { CONSTANTS } from '../../constants';

import { SidebarProvider, TabsProvider } from '../contexts';
import { useTabs, useTheme, useSidebar } from '../hooks';
import { Layout } from '../templates';
import { convertToPath } from '../../utils';

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
   * Access project-related functions and values from the custom hook
   * @useProject
   */
  const project = null;
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
  useEffect(() => {
    function getProjectData() {
      window.bridge.createProject((_event: Event, value: any) => {
        console.log('In renderer ->', value);
      });
    }
    getProjectData();
  }, []);
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
