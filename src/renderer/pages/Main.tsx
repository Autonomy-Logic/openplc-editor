/* eslint-disable no-console */
/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable react/function-component-definition */
import { FC, useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarProvider, TabsProvider } from 'renderer/contexts';
import { useSidebar, useTabs, useTheme } from 'renderer/hooks';
import { useOpenPLCStore } from 'renderer/store';
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
    getPousToEdit();
  }, [getPousToEdit]);

  console.table(project?.project.types.pous.pou);
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
