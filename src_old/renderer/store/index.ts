import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// Enable Immer's MapSet plugin for Map/Set support in store state
enableMapSet()

import type {
  ConsoleSlice,
  DeviceSlice,
  EditorSlice,
  FBDFlowSlice,
  FileSlice,
  HistorySlice,
  LadderFlowSlice,
  LibrarySlice,
  ModalSlice,
  ProjectSlice,
  SearchSlice,
  SharedSlice,
  TabsSlice,
  WorkspaceSlice,
} from './slices'

export type RootState = WorkspaceSlice &
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
  FileSlice &
  DeviceSlice &
  HistorySlice
import {
  createConsoleSlice,
  createDeviceSlice,
  createEditorSlice,
  createFBDFlowSlice,
  createFileSlice,
  createHistorySlice,
  createLadderFlowSlice,
  createLibrarySlice,
  createModalSlice,
  createProjectSlice,
  createSearchSlice,
  createSharedSlice,
  createTabsSlice,
  createWorkspaceSlice,
} from './slices'

export const openPLCStoreBase = create(
  subscribeWithSelector<
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
      FileSlice &
      DeviceSlice &
      HistorySlice
  >((...a) => ({
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
    ...createFileSlice(...a),
    ...createHistorySlice(...a),
  })),
)

export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
