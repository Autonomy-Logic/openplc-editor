import { produce } from 'immer'
import { StateCreator } from 'zustand'

type ITabProps = {
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  type: 'program' | 'function' | 'function-block'
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

export type ITabsSlice = ITabsState & {
  tabsActions: ITabsActions
}

const createTabsSlice: StateCreator<ITabsSlice, [], [], ITabsSlice> = (setState) => ({
  tabs: [],

  tabsActions: {
    setTabs: (tabs: ITabProps[]) => {
      setState(
        produce((slice: ITabsSlice) => {
          slice.tabs = tabs
        }),
      )
    },
    updateTabs: (tab: ITabProps) => {
      setState(
        produce((slice: ITabsSlice) => {
          const tabExists = slice.tabs.find((t: ITabProps) => t.name === tab.name)
          if (tabExists) return
          slice.tabs = [...slice.tabs, tab]
        }),
      )
    },
    sortTabs: (tabs: ITabProps[]) => {
      setState(
        produce((slice: ITabsSlice) => {
          slice.tabs = tabs
        }),
      )
    },
    removeTab: (tabToRemove: string) => {
      setState(
        produce((slice: ITabsSlice) => {
          slice.tabs = slice.tabs.filter((t: ITabProps) => t.name !== tabToRemove)
        }),
      )
    },
    clearTabs: () => {
      setState(
        produce((slice: ITabsSlice) => {
          slice.tabs = []
        }),
      )
    },
  },
})

export { createTabsSlice, type ITabProps }
