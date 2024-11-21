import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

import type {
  ConsoleSlice,
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
  createConsoleSlice,
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
  WorkspaceSlice &
    EditorSlice &
    TabsSlice &
    FlowSlice &
    SearchSlice &
    SharedSlice &
    LibrarySlice &
    ProjectSlice &
    ConsoleSlice
>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSearchSlice(...a),
  ...createSharedSlice(...a),
  ...createFlowSlice(...a),
  ...createLibrarySlice(...a),
  ...createProjectSlice(...a),
  ...createConsoleSlice(...a),
}))

/**
 * Create the store as a hook and generate the selectors using the createSelectorHooks function.
 */
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
