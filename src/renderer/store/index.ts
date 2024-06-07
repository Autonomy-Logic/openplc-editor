import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

import type { EditorSlice, ISharedSlice, IWorkspaceSlice, TabsSlice } from './slices'
/**
 * Import all slices to create the store.
 */
import { createEditorSlice, createSharedSlice, createTabsSlice, createWorkspaceSlice } from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<IWorkspaceSlice & EditorSlice & TabsSlice & ISharedSlice>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSharedSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
