import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

/**
 * Import all slices to create the store.
 */
import {
  createEditorSlice,
  createSharedSlice,
  createTabsSlice,
  createWorkspaceSlice,
  type IEditorSlice,
  type ISharedSlice,
  type ITabsSlice,
  type IWorkspaceSlice,
} from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<IWorkspaceSlice & IEditorSlice & ITabsSlice & ISharedSlice>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSharedSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
