import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

import type {
  EditorSlice,
  FlowSlice,
  LibrarySlice,
  ProjectSlice,
  SearchSlice,
  SharedSlice,
  TabsSlice,
  WorkspaceSlice,
} from './slices'
/**
 * Import all slices to create the store.
 */
import {
  createEditorSlice,
  createFlowSlice,
  createLibrarySlice,
  createProjectSlice,
  createSearchSlice,
  createSharedSlice,
  createTabsSlice,
  createWorkspaceSlice,
} from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<
  WorkspaceSlice & EditorSlice & TabsSlice & FlowSlice & SearchSlice & SharedSlice & LibrarySlice & ProjectSlice
>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSearchSlice(...a),
  ...createSharedSlice(...a),
  ...createFlowSlice(...a),
  ...createLibrarySlice(...a),
  ...createProjectSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
