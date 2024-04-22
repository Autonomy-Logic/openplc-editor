import { IFunction, IFunctionBlock, IProgram } from '@root/types/PLC'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

type ITabProps =
  | IProgram
  | IFunction
  | (IFunctionBlock & {
      currentTab?: boolean
    })

type ITabsState = {
  tabsState: {
    tabs: ITabProps[] | []
  }
}

type ITabsActions = {
  setTabs: (tabs: ITabProps[]) => void
  updateTabs: (tab: ITabProps) => void
  sortTabs: (tabs: ITabProps[]) => void
  removeTab: (tabToRemove: string) => void
  clearTabs: () => void
}

export type ITabsSlice = ITabsState & ITabsActions

const createTabsSlice: StateCreator<ITabsSlice, [], [], ITabsSlice> = (setState) => ({
  tabsState: {
    tabs: [],
  },
  setTabs: (tabs: ITabProps[]) => {
    setState(
      produce((state) => {
        state.tabsState.tabs = tabs
      }),
    )
  },
  updateTabs: (tab: ITabProps) => {
    setState(
      produce((state) => {
        const tabExists = state.tabsState.tabs.find((t: ITabProps) => t.name === tab.name)
        if (tabExists) return
        state.tabsState.tabs = [...state.tabsState.tabs, tab]
      }),
    )
  },
  sortTabs: (tabs: ITabProps[]) => {
    setState(
      produce((state) => {
        state.tabsState.tabs = tabs
      }),
    )
  },
  removeTab: (tabToRemove: string) => {
    setState(
      produce((state) => {
        state.tabsState.tabs = state.tabsState.tabs.filter((t: ITabProps) => t.name !== tabToRemove)
      }),
    )
  },
  clearTabs: () => {
    setState(
      produce((state) => {
        state.tabsState.tabs = []
      }),
    )
  },
})

export { createTabsSlice, type ITabProps }
