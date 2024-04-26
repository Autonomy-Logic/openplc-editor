import { produce } from 'immer'
import { StateCreator } from 'zustand'

type ITabProps = {
  name: string
  language: 'IL' | 'ST' | 'LD' | 'SFC' | 'FBD'
  currentTab: boolean
}
type ITabsState = {
  tabs: ITabProps[] | []
}

type ITabsActions = {
  setTabs: (tabs: ITabProps[]) => void
  updateTabs: (tab: ITabProps) => void
  sortTabs: (tabs: ITabProps[]) => void
  removeTab: (tabToRemove: string) => void
  clearTabs: () => void
}

export type ITabsSlice = {
  tabsState: ITabsState
  tabsActions: ITabsActions
}

const createTabsSlice: StateCreator<ITabsSlice, [], [], ITabsSlice> = (setState) => ({
  tabsState: {
    tabs: [],
  },
  tabsActions: {
    setTabs: (tabs: ITabProps[]) => {
      setState(
        produce(({ tabsState }: ITabsSlice) => {
          tabsState.tabs = tabs
        }),
      )
    },
    updateTabs: (tab: ITabProps) => {
      setState(
        produce(({ tabsState }: ITabsSlice) => {
          const tabExists = tabsState.tabs.find((t: ITabProps) => t.name === tab.name)
          if (tabExists) return
          tabsState.tabs = [...tabsState.tabs, tab]
        }),
      )
    },
    sortTabs: (tabs: ITabProps[]) => {
      setState(
        produce(({ tabsState }: ITabsSlice) => {
          tabsState.tabs = tabs
        }),
      )
    },
    removeTab: (tabToRemove: string) => {
      setState(
        produce(({ tabsState }: ITabsSlice) => {
          tabsState.tabs = tabsState.tabs.filter((t: ITabProps) => t.name !== tabToRemove)
        }),
      )
    },
    clearTabs: () => {
      setState(
        produce(({ tabsState }: ITabsSlice) => {
          tabsState.tabs = []
        }),
      )
    },
  },
})

export { createTabsSlice, type ITabProps }
