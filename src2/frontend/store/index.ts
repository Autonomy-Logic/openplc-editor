import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// Enable Immer's MapSet plugin for Map/Set support in store state
enableMapSet()

import type {
  AISlice,
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
  WebRTCSlice,
  WorkspaceSlice,
} from './slices'
import {
  createAISlice,
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
  createWebRTCSlice,
  createWorkspaceSlice,
} from './slices'

export type RootState = AISlice &
  ConsoleSlice &
  DeviceSlice &
  EditorSlice &
  FBDFlowSlice &
  FileSlice &
  HistorySlice &
  LadderFlowSlice &
  LibrarySlice &
  ModalSlice &
  ProjectSlice &
  SearchSlice &
  SharedSlice &
  TabsSlice &
  WebRTCSlice &
  WorkspaceSlice

export const openPLCStoreBase = create(
  subscribeWithSelector<RootState>((...a) => ({
    ...createAISlice(...a),
    ...createConsoleSlice(...a),
    ...createDeviceSlice(...a),
    ...createEditorSlice(...a),
    ...createFBDFlowSlice(...a),
    ...createFileSlice(...a),
    ...createHistorySlice(...a),
    ...createLadderFlowSlice(...a),
    ...createLibrarySlice(...a),
    ...createModalSlice(...a),
    ...createProjectSlice(...a),
    ...createSearchSlice(...a),
    ...createSharedSlice(...a),
    ...createTabsSlice(...a),
    ...createWebRTCSlice(...a),
    ...createWorkspaceSlice(...a),
  })),
)

export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
