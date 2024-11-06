// store/index.ts
import { createSelectorHooks } from 'auto-zustand-selectors-hook';
import { create } from 'zustand';

import type {
  EditorSlice,
  FlowSlice,
  LibrarySlice,
  ProjectSlice,
  SearchSlice,
  SharedSlice,
  TabsSlice,
  WorkspaceSlice,
} from './slices';
import {
  createEditorSlice,
  createFlowSlice,
  createLibrarySlice,
  createProjectSlice,
  createSearchSlice,
  createSharedSlice,
  createTabsSlice,
  createWorkspaceSlice,
} from './slices';

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
}));

export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase);
