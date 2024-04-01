import { IPouTemplate } from '@root/types/transfer'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

type ITabsState = {
	tabsState: {
		tabs: IPouTemplate[] | []
	}
}

type ITabsActions = {
	setTabs: (tabs: IPouTemplate[]) => void
	updateTabs: (tabs: IPouTemplate[]) => void
	clearTabs: () => void
}

export type ITabsSlice = ITabsState & ITabsActions

const createTabsSlice: StateCreator<ITabsSlice, [], [], ITabsSlice> = (
	setState
) => ({
	tabsState: {
		tabs: [],
	},
	setTabs: (tabs: IPouTemplate[]) => {
		setState(
			produce((state) => {
				state.tabsState.tabs = tabs
			})
		)
	},
	updateTabs: (tabs: IPouTemplate[]) => {
		setState(
			produce((state) => {
				state.tabsState.tabs = tabs
			})
		)
	},
	clearTabs: () => {
		setState(
			produce((state) => {
				state.tabsState.tabs = []
			})
		)
	},
})

export { createTabsSlice }
