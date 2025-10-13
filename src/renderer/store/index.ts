import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

enableMapSet()

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
import { createHistorySlice, HistorySlice } from './slices/history'

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
    ...createHistorySlice(...a),
  })),
)

export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
