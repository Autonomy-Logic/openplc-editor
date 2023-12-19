/* eslint-disable no-unused-expressions */
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useMemo,
  useState,
} from 'react';


/**
 * Extracted 'path' property from the imported CONSTANTS object.
 */
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
export const TabsContext = createContext<TabsContextData>({} as TabsContextData);
/**
 * Provider component for managing tabs.
 * @returns A JSX Component with the tabs context provider
 */
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const TabsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [tabs, setTabs] = useState<TabsProps[]>([]);

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
    []
  );
  
  /**
   * Removes a tab from the list of tabs.
   * @param id - The ID of the tab to remove.
   */
  const removeTab = useCallback(
    (id: number | string) => setTabs((state) => [...state.filter((tab) => tab.id !== id)]),
    []
  );
  /**
   * Memoize the tabs context data.
   */
  const defaultValue = useMemo(() => ({ tabs, addTab, removeTab }), [tabs, addTab, removeTab]);
  /**
   * Provide the context with tabs data.
   */
  return <TabsContext.Provider value={defaultValue}>{children}</TabsContext.Provider>;
};

export default TabsProvider;
