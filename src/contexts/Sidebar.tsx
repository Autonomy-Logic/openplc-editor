import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useState,
} from 'react'

export type CurrentProps =
  | 'tools'
  | 'projectTree'
  | 'settings'
  | 'editorTools'
  | 'variables'

export type SidebarContextData = {
  current?: CurrentProps
  navigate: (sidebar: CurrentProps) => void
}

export const SidebarContext = createContext<SidebarContextData>(
  {} as SidebarContextData,
)

const SidebarProvider: FC<PropsWithChildren> = ({ children }) => {
  const [current, setCurrent] = useState<CurrentProps>('tools')

  const navigate = useCallback((key: CurrentProps) => setCurrent(key), [])

  return (
    <SidebarContext.Provider value={{ current, navigate }}>
      {children}
    </SidebarContext.Provider>
  )
}

export default SidebarProvider
