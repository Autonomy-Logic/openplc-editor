import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useState,
} from 'react'
/**
 * Type representing the possible values for the current sidebar.
 */
export type CurrentProps =
  | 'tools'
  | 'projectTree'
  | 'settings'
  | 'editorTools'
  | 'variables'
/**
 * Represents the context data for the sidebar.
 */
export type SidebarContextData = {
  /**
   * Current active sidebar.
   */
  current?: CurrentProps
  /**
   * Function to navigate to a different sidebar.
   * @param sidebar - The sidebar prop to navigate.
   */
  navigate: (sidebar: CurrentProps) => void
}
/**
 * Represents the context data for the sidebar.
 */
export const SidebarContext = createContext<SidebarContextData>(
  {} as SidebarContextData,
)
/**
 * A provider component for the sidebar context.
 * @returns A JSX Component with the sidebar context provider
 */
const SidebarProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * State to keep track of the current active sidebar.
   */
  const [current, setCurrent] = useState<CurrentProps>('tools')
  /**
   * Function to navigate to a different sidebar.
   */
  const navigate = useCallback((key: CurrentProps) => setCurrent(key), [])
  /**
   * Provide the context with current sidebar data.
   */
  return (
    <SidebarContext.Provider value={{ current, navigate }}>
      {children}
    </SidebarContext.Provider>
  )
}

export default SidebarProvider
