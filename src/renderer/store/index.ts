import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

import type {
  EditorSlice,
  FlowSlice,
  LibrarySlice,
  ProjectSlice,
  SharedSlice,
  TabsSlice,
  WorkspaceSlice,
  SearchSlice,
} from './slices'
/**
 * Import all slices to create the store.
 */
import {
  createEditorSlice,
  createFlowSlice,
  createLibrarySlice,
  createProjectSlice,
  createSharedSlice,
  createTabsSlice,
  createSearchSlice,
  createWorkspaceSlice} from './slices'

/**
 * Create the base store to be exported as a hook.
 */
export const openPLCStoreBase = create<
  WorkspaceSlice & EditorSlice & TabsSlice & FlowSlice & SharedSlice & LibrarySlice & ProjectSlice & SearchSlice
>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSharedSlice(...a),
  ...createFlowSlice(...a),
  ...createLibrarySlice(...a),
  ...createProjectSlice(...a),
  ...createSearchSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
