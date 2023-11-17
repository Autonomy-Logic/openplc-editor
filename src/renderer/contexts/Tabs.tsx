/* eslint-disable no-unused-expressions */
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { CONSTANTS } from '@/shared/utils';

import { TitlebarTabs } from '../components';

/**
 * Extracted 'path' property from the imported CONSTANTS object.
 */
const { paths } = CONSTANTS;
/**
 * Type definition for individual tab properties.
 */
type TabsProps = {
  /**
   * The ID of the tab. Can be a number or a string.
   */
  id: number | string;
  /**
   * The title of the tab.
   */
  title: string;
  /**
   * Callback function triggered when the tab is clicked.
   */
  onClick?: () => void;
  /**
   * Callback function triggered when the close button on the tab is clicked.
   */
  onClickCloseButton?: () => void;
  /**
   * Indicates whether the tab is the currently active tab.
   */
  current?: boolean;
};
/**
 * Context data type for managing tabs.
 */
export type TabsContextData = {
  /**
   * List of tabs.
   */
  tabs: TabsProps[];
  /**
   * Function to add a new tab.
   * @param tab - The tab properties to add.
   */
  addTab: (tab: TabsProps) => void;
  /**
   * Function to remove a tab.
   * @param id - The ID of the tab to remove.
   */
  removeTab: (id: number | string) => void;
};
/**
 * Create a context for managing tabs.
 */
export const TabsContext = createContext<TabsContextData>(
  {} as TabsContextData,
);
/**
 * Provider component for managing tabs.
 * @returns A JSX Component with the tabs context provider
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const TabsProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * State to hold the root element for titlebar tabs.
   */
  const [rootTitlebarTabs, setRootTitlebarTabs] = useState<Root>();
  /**
   * State to store the list of tabs.
   */
  const [tabs, setTabs] = useState<TabsProps[]>([]);
  /**
   * Hook to navigate between routes.
   */
  const navigate = useNavigate();
  /**
   * Adds a new tab to the list of tabs.
   * @param tab - The tab properties to add.
   */
  const addTab = useCallback(
    (tab: TabsProps) =>
      setTabs((state) => {
        let tabsState = state;
        let tabExists = false;
        tabsState = state.map((item) => {
          if (item.id === tab.id) {
            tabExists = true;
            return { ...item, current: true };
          }
          return { ...item, current: false };
        });
        if (!tabExists) {
          tabsState = [...state, { ...tab, current: true }];
        }
        return tabsState;
      }),
    [],
  );
  /**
   * Removes a tab from the list of tabs.
   * @param id - The ID of the tab to remove.
   */
  const removeTab = useCallback(
    (id: number | string) =>
      setTabs((state) => [...state.filter((tab) => tab.id !== id)]),
    [],
  );
  /**
   * Sets the currently active tab.
   * @param id - The ID of the tab to set as active.
   */
  const setCurrentTab = useCallback(
    (id: number | string) =>
      setTabs((state) =>
        state.map((tab) =>
          tab.id === id
            ? { ...tab, current: true }
            : { ...tab, current: false },
        ),
      ),
    [],
  );
  /**
   * Gets the currently active tab.
   */
  const getCurrentTab = useCallback(
    () => tabs.find(({ current }) => current),
    [tabs],
  );
  /**
   * Use effect hook to create and render the titlebar tabs.
   */
  useEffect(() => {
    const [menubar] = document.getElementsByClassName('cet-menubar');
    const titlebarTabs = document.createElement('div');

    titlebarTabs.className = 'flex flex-1 items-center overflow-hidden';
    titlebarTabs.id = 'titlebar-windows';

    if (menubar) {
      menubar.after(titlebarTabs);
      const root = createRoot(titlebarTabs as HTMLElement);
      root.render(<TitlebarTabs tabs={[]} />);
      setRootTitlebarTabs(root);
    }
  }, []);
  /**
   * Use effect hook to update the titlebar tabs when tabs change.
   */
  useEffect(() => {
    if (rootTitlebarTabs) {
      rootTitlebarTabs.render(
        <TitlebarTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            onClick: () => {
              tab.onClick && tab.onClick();
              setCurrentTab(tab.id);
            },
            onClickCloseButton: () => {
              tab.onClickCloseButton && tab.onClickCloseButton();
              removeTab(tab.id);
              getCurrentTab()?.id === tab.id && navigate(paths.MAIN);
            },
          }))}
        />,
      );
    }
  }, [
    getCurrentTab,
    navigate,
    removeTab,
    rootTitlebarTabs,
    setCurrentTab,
    tabs,
  ]);
  /**
   * Memoize the tabs context data.
   */
  const defaultValue = useMemo(
    () => ({ tabs, addTab, removeTab }),
    [tabs, addTab, removeTab],
  );
  /**
   * Provide the context with tabs data.
   */
  return (
    <TabsContext.Provider value={defaultValue}>{children}</TabsContext.Provider>
  );
};

export default TabsProvider;
