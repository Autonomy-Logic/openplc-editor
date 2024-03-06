import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

/**
 * Import all slices to create the store.
 */
import createWorkspaceSlice, {
	WorkspaceSlice as WorkspaceSliceType,
} from './slices/workspace-slice'

import {
	createPlatformSlice,
	type IPlatformSlice,
} from './slices/platform-slice'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<WorkspaceSliceType & IPlatformSlice>()(
	(...a) => ({
		...createWorkspaceSlice(...a),
		...createPlatformSlice(...a),
	})
)

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
