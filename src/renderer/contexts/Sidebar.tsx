import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useMemo,
  useState,
} from 'react';
/**
 * Type representing the possible values for the current sidebar.
 */
export type CurrentProps =
  | 'tools'
  | 'projectTree'
  | 'settings'
  | 'editorTools'
  | 'variables'
  | 'pou';
/**
 * Represents the context data for the sidebar.
 */
export type SidebarContextData = {
  /**
   * Current active sidebar.
   */
  current?: CurrentProps;
  /**
   * Function to navigate to a different sidebar.
   * @param sidebar - The sidebar prop to navigate.
   */
  navigate: (sidebar: CurrentProps) => void;
};
/**
 * Represents the context data for the sidebar.
 */
export const SidebarContext = createContext<SidebarContextData>(
  {} as SidebarContextData,
);
/**
 * A provider component for the sidebar context.
 * @returns A JSX Component with the sidebar context provider
 */
function SidebarProvider({ children }: PropsWithChildren<{}>): ReactNode {
  /**
   * State to keep track of the current active sidebar.
   */
  const [current, setCurrent] = useState<CurrentProps>('tools');
  /**
   * Function to navigate to a different sidebar.
   */
  const navigate = useCallback((key: CurrentProps) => setCurrent(key), []);
  /**
   * Memoize the current sidebar context data.
   */
  const defaultValue = useMemo(
    () => ({ current, navigate }),
    [current, navigate],
  );
  /**
   * Provide the context with current sidebar data.
   */
  return (
    <SidebarContext.Provider value={defaultValue}>
      {children}
    </SidebarContext.Provider>
  );
}

export default SidebarProvider;
