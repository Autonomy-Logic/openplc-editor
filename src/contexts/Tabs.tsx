import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { createRoot, Root } from 'react-dom/client'

import { useProject } from '@/hooks'

import { TitlebarTabs } from '../components'

type TabsProps = {
  id: number | string
  title: string
  onClick?: () => void
  onClickCloseButton?: () => void
  current?: boolean
}

export type TabsContextData = {
  tabs: TabsProps[]
  addTab: (tab: TabsProps) => void
  removeTab: (id: number | string) => void
  currentTab: (id: number | string) => void
}

export const TabsContext = createContext<TabsContextData>({} as TabsContextData)

const TabsProvider: FC<PropsWithChildren> = ({ children }) => {
  const { project } = useProject()
  const [rootTitlebarTabs, setRootTitlebarTabs] = useState<Root>()

  const [tabs, setTabs] = useState<TabsProps[]>([])

  const addTab = useCallback(
    (tab: TabsProps) =>
      setTabs((state) => {
        let tabExists = false
        state = state.map((item) => {
          if (item.id === tab.id) {
            tabExists = true
            return { ...item, current: true }
          }
          return { ...item, current: false }
        })
        if (!tabExists) {
          state = [...state, { ...tab, current: true }]
        }
        return state
      }),
    [],
  )

  const removeTab = useCallback(
    (id: number | string) =>
      setTabs((state) => [...state.filter((tab) => tab.id !== id)]),
    [],
  )

  const currentTab = useCallback(
    (id: number | string) =>
      setTabs((state) =>
        state.map((tab) =>
          tab.id === id
            ? { ...tab, current: true }
            : { ...tab, current: false },
        ),
      ),
    [],
  )

  useEffect(() => {
    const [menubar] = document.getElementsByClassName('cet-menubar')
    const titlebarTabs = document.createElement('div')

    titlebarTabs.className = 'flex flex-1 items-center overflow-hidden'
    titlebarTabs.id = 'titlebar-windows'

    if (menubar) {
      menubar.after(titlebarTabs)
      const root = createRoot(titlebarTabs as HTMLElement)
      root.render(<TitlebarTabs tabs={[]} />)
      setRootTitlebarTabs(root)
    }
  }, [])

  useEffect(() => {
    if (rootTitlebarTabs) {
      rootTitlebarTabs.render(<TitlebarTabs tabs={tabs} />)
    }
  }, [removeTab, rootTitlebarTabs, tabs])

  useEffect(() => {
    if (project?.xmlSerialized?.project) {
      const pouName = project.xmlSerialized.project?.types?.pous.pou?.['@name']
      addTab({
        id: pouName,
        title: pouName,
        onClick: () => currentTab(pouName),
        onClickCloseButton: () => removeTab(pouName),
      })
    }
  }, [addTab, currentTab, project?.xmlSerialized?.project, removeTab])

  return (
    <TabsContext.Provider value={{ tabs, addTab, removeTab, currentTab }}>
      {children}
    </TabsContext.Provider>
  )
}

export default TabsProvider
