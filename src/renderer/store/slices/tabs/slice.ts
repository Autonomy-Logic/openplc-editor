import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { TabsProps, TabsSlice } from './types'

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (setState, getState) => ({
  tabs: [],
  selectedTab: null,

  tabsActions: {
    updateTabs: (tab) => {
      console.log('[TABS] updateTabs', { name: tab.name, type: tab.elementType.type })
      let updatedTabs: TabsProps[] = []
      setState(
        produce((slice: TabsSlice) => {
          const tabExists = slice.tabs.find((t) => t.name === tab.name)
          if (tabExists) return
          updatedTabs = [...slice.tabs, tab]
          slice.tabs = updatedTabs
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
    updateTabName: (oldName: string, newName: string) => {
      setState(
        produce((state: TabsSlice) => {
          const tabExists = state.tabs.find((tab) => tab.name === oldName)
          if (!tabExists) {
            return
          }

          state.tabs = state.tabs.map((tab) => (tab.name === oldName ? { ...tab, name: newName } : tab))

          if (state.selectedTab === oldName) {
            state.selectedTab = newName
          }
        }),
      )
    },
    clearTabs: () => {
      setState(
        produce((slice: TabsSlice) => {
          slice.tabs = []
          slice.selectedTab = null
        }),
      )
    },
    setSelectedTab: (tabName) => {
      console.log('[TABS] setSelectedTab', { name: tabName })
      setState(
        produce((slice: TabsSlice) => {
          slice.selectedTab = tabName
        }),
      )
    },
    getSelectedTab: () => {
      return getState().selectedTab
    },
  },
})
