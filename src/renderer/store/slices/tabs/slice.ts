import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { TabsProps, TabsSlice } from './types'

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (setState) => ({
  tabs: [],

  tabsActions: {
    updateTabs: (tab) => {
      let updatedTabs: TabsProps[] = []
      setState(
        produce((slice: TabsSlice) => {
          const tabExists = slice.tabs.find((t) => t.name === tab.name)
          if (tabExists) return
          updatedTabs = [...slice.tabs, tab]
          slice.tabs = updatedTabs
        }),
      )
      return { tabs: updatedTabs }
    },
    sortTabs: (tabs) => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = tabs
        }),
      )
    },
    removeTab: (tabToRemove) => {
      let returnTabs: TabsProps[] = []
      setState(
        produce((slice: TabsSlice) => {
          returnTabs = slice.tabs.filter((t) => t.name !== tabToRemove)
          slice.tabs = returnTabs
        }),
      )
      return { tabs: returnTabs }
    },
    updateTabName: (oldName: string, newName: string) => {
      setState((state) => {
        const updatedTabs = state.tabs.map((tab) => (tab.name === oldName ? { ...tab, name: newName } : tab))
        return { ...state, tabs: updatedTabs }
      })
    },
    clearTabs: () => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = []
        }),
      )
    },
  },
})
