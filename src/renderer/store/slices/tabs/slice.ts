import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { TabsSlice } from './types'

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (setState) => ({
  tabs: [],

  tabsActions: {
    setTabs: (tabs) => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = tabs
        }),
      )
    },
    updateTabs: (tab) => {
      setState(
        produce((slice: TabsSlice) => {
          const tabExists = slice.tabs.find((t) => t.name === tab.name)
          if (tabExists) return
          slice.tabs = [...slice.tabs, tab]
        }),
      )
    },
    sortTabs: (tabs) => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = tabs
        }),
      )
    },
    removeTab: (tabToRemove) => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = slice.tabs.filter((t) => t.name !== tabToRemove)
        }),
      )
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
