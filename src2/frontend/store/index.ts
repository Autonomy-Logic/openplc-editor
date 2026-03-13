import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// Enable Immer's MapSet plugin for Map/Set support in store state
enableMapSet()

import type { AIFeatureConfig } from '../../backend/shared/ai'

import type { AISlice } from './slices/ai'
import type { ConsoleSlice } from './slices/console'
import type { DeviceSlice } from './slices/device'
import type { EditorSlice } from './slices/editor'
import type { FBDFlowSlice } from './slices/fbd'
import type { FileSlice } from './slices/file'
import type { HistorySlice } from './slices/history'
import type { LadderFlowSlice } from './slices/ladder'
import type { LibrarySlice } from './slices/library'
import type { ModalSlice } from './slices/modal'
import type { ProjectSlice } from './slices/project'
import type { SearchSlice } from './slices/search'
import type { SharedSlice } from './slices/shared'
import type { TabsSlice } from './slices/tabs'
import type { WebRTCSlice } from './slices/webrtc'
import type { WorkspaceSlice } from './slices/workspace'
import { createAISliceFactory } from './slices/ai'
import { createConsoleSlice } from './slices/console'
import { createDeviceSlice } from './slices/device'
import { createEditorSlice } from './slices/editor'
import { createFBDFlowSlice } from './slices/fbd'
import { createFileSlice } from './slices/file'
import { createHistorySlice } from './slices/history'
import { createLadderFlowSlice } from './slices/ladder'
import { createLibrarySlice } from './slices/library'
import { createModalSlice } from './slices/modal'
import { createProjectSlice } from './slices/project'
import { createSearchSlice } from './slices/search'
import { createSharedSlice } from './slices/shared'
import { createTabsSlice } from './slices/tabs'
import { createWebRTCSlice } from './slices/webrtc'
import { createWorkspaceSlice } from './slices/workspace'

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

/**
 * Configuration for store initialization.
 * Allows the composition root to inject platform-specific initial state.
 */
export interface StoreConfig {
  /** AI feature configuration from platform environment */
  ai?: AIFeatureConfig
}

export function createOpenPLCStore(config: StoreConfig = {}) {
  return create(
    subscribeWithSelector<RootState>((...a) => ({
      ...createAISliceFactory(config.ai)(...a),
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
}

export const openPLCStoreBase = createOpenPLCStore()
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
