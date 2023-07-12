import { CONSTANTS } from '@shared/constants'
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { createRoot, Root } from 'react-dom/client'
import { useNavigate } from 'react-router-dom'

import { TitlebarTabs } from '../components'

const { paths } = CONSTANTS

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
}

export const TabsContext = createContext<TabsContextData>({} as TabsContextData)

const TabsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [rootTitlebarTabs, setRootTitlebarTabs] = useState<Root>()
  const [tabs, setTabs] = useState<TabsProps[]>([])
  const navigate = useNavigate()

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
  )

  const getCurrentTab = useCallback(
    () => tabs.find(({ current }) => current),
    [tabs],
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
      rootTitlebarTabs.render(
        <TitlebarTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            onClick: () => {
              tab.onClick && tab.onClick()
              setCurrentTab(tab.id)
            },
            onClickCloseButton: () => {
              tab.onClickCloseButton && tab.onClickCloseButton()
              removeTab(tab.id)
              getCurrentTab()?.id === tab.id && navigate(paths.MAIN)
            },
          }))}
        />,
      )
    }
  }, [
    getCurrentTab,
    navigate,
    removeTab,
    rootTitlebarTabs,
    setCurrentTab,
    tabs,
  ])

  return (
    <TabsContext.Provider value={{ tabs, addTab, removeTab }}>
      {children}
    </TabsContext.Provider>
  )
}

export default TabsProvider
