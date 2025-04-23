import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { create } from 'zustand'

import type {
  ConsoleSlice,
  DeviceSlice,
  EditorSlice,
  FBDFlowSlice,
  LadderFlowSlice,
  LibrarySlice,
  ModalSlice,
  ProjectSlice,
  SearchSlice,
  SharedSlice,
  TabsSlice,
  WorkspaceSlice,
} from './slices'
import {
  createConsoleSlice,
  createDeviceSlice,
  createEditorSlice,
  createFBDFlowSlice,
  createLadderFlowSlice,
  createLibrarySlice,
  createModalSlice,
  createProjectSlice,
  createSearchSlice,
  createSharedSlice,
  createTabsSlice,
  createWorkspaceSlice,
} from './slices'

export const openPLCStoreBase = create<
  WorkspaceSlice &
    EditorSlice &
    TabsSlice &
    FBDFlowSlice &
    LadderFlowSlice &
    SearchSlice &
    SharedSlice &
    LibrarySlice &
    ProjectSlice &
    ConsoleSlice &
    ModalSlice &
    DeviceSlice
>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createEditorSlice(...a),
  ...createTabsSlice(...a),
  ...createSearchSlice(...a),
  ...createSharedSlice(...a),
  ...createFBDFlowSlice(...a),
  ...createLadderFlowSlice(...a),
  ...createLibrarySlice(...a),
  ...createProjectSlice(...a),
  ...createConsoleSlice(...a),
  ...createModalSlice(...a),
  ...createDeviceSlice(...a),
}))

export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
