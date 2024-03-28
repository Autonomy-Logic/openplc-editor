import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

/**
 * Import all slices to create the store.
 */
import {
	createWorkspaceSlice,
	type IWorkspaceSlice,
	createPlatformSlice,
	type IPlatformSlice,
	createPousSlice,
	type IPousSlice,
	createEditorSlice,
	type IEditorSlice,
	createTabsSlice,
	type ITabsSlice,
} from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<
	IPlatformSlice & IWorkspaceSlice & IPousSlice & IEditorSlice & ITabsSlice
>()((...a) => ({
	...createPlatformSlice(...a),
	...createWorkspaceSlice(...a),
	...createPousSlice(...a),
	...createEditorSlice(...a),
	...createTabsSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
