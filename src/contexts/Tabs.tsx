import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'

import { Tabs as TabsComponent } from '../components'

type TabsProps = {
  id: number | string
  name: string
  to: string
}

export type TabsContextData = {
  tabs: TabsProps[]
  addTab: (tab: TabsProps) => void
  removeTab: (id: number | string) => void
}

export const TabsContext = createContext<TabsContextData>({} as TabsContextData)

const TabsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [tabs, setTabs] = useState<TabsProps[]>([])

  const addTab = useCallback(
    (tab: TabsProps) => setTabs((state) => [...state, tab]),
    [],
  )

  const removeTab = useCallback(
    (id: number | string) =>
      setTabs((state) => [...state.filter((tab) => tab.id === id)]),
    [],
  )

  useEffect(() => {
    const [menubar] = document.getElementsByClassName('cet-menubar')
    const tabsContainer = document.createElement('div')
    tabsContainer.className = 'flex flex-1 items-center overflow-hidden'

    if (menubar) {
      menubar.after(tabsContainer)
      createRoot(tabsContainer as HTMLElement).render(
        <TabsComponent
          appearance="secondary"
          tabs={tabs.map((tab, index) => ({
            ...tab,
            onClick: () => console.log(tab.name),
            current: index % 2 === 0,
          }))}
        />,
      )
    }
  }, [tabs])

  return (
    <TabsContext.Provider value={{ tabs, addTab, removeTab }}>
      {children}
    </TabsContext.Provider>
  )
}

export default TabsProvider
