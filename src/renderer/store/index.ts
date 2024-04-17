import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

/**
 * Import all slices to create the store.
 */
import {
	createWorkspaceSlice,
	type IWorkspaceSlice,
	createEditorSlice,
	type IEditorSlice,
	createTabsSlice,
	type ITabsSlice,
} from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<
	IWorkspaceSlice & IEditorSlice & ITabsSlice
>()((...a) => ({
	...createWorkspaceSlice(...a),
	...createEditorSlice(...a),
	...createTabsSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
