import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { TabsSlice } from './types'

export const createTabsSlice: StateCreator<TabsSlice, [], [], TabsSlice> = (setState, getState) => ({
  tabs: [],
  selectedTab: null,

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
          const idx = slice.tabs.findIndex((t) => t.name === tab.name)
          if (idx === -1) {
            slice.tabs = [...slice.tabs, tab]
            return
          }
          // Same display name already open: take the new elementType and path, keep the
          // stored tab's other fields.
          slice.tabs[idx] = { ...slice.tabs[idx], ...tab }
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

    updateTabName: (oldName, newName) => {
      setState(
        produce((state: TabsSlice) => {
          const tabExists = state.tabs.find((tab) => tab.name === oldName)
          if (!tabExists) return

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
