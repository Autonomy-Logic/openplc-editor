import { createSelectorHooks } from 'auto-zustand-selectors-hook'
import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// Enable Immer's MapSet plugin for Map/Set support in store state
enableMapSet()

import type { AIFeatureConfig } from '../../middleware/shared/ports/types'
import type { AISlice } from './slices/ai'
import { createAISliceFactory } from './slices/ai'
import type { ConsoleSlice } from './slices/console'
import { createConsoleSlice } from './slices/console'
import type { DeviceSlice } from './slices/device'
import { createDeviceSlice } from './slices/device'
import type { EditorSlice } from './slices/editor'
import { createEditorSlice } from './slices/editor'
import type { FBDFlowSlice } from './slices/fbd'
import { createFBDFlowSlice } from './slices/fbd'
import type { FileSlice } from './slices/file'
import { createFileSlice } from './slices/file'
import type { HistorySlice } from './slices/history'
import { createHistorySlice } from './slices/history'
import type { LadderFlowSlice } from './slices/ladder'
import { createLadderFlowSlice } from './slices/ladder'
import type { LibrarySlice } from './slices/library'
import { createLibrarySlice } from './slices/library'
import type { ModalSlice } from './slices/modal'
import { createModalSlice } from './slices/modal'
import type { ProjectSlice } from './slices/project'
import { createProjectSlice } from './slices/project'
import type { ReadmeSlice } from './slices/readme'
import { createReadmeSlice } from './slices/readme'
import type { SearchSlice } from './slices/search'
import { createSearchSlice } from './slices/search'
import type { SharedSlice } from './slices/shared'
import { createSharedSlice } from './slices/shared'
import type { TabsSlice } from './slices/tabs'
import { createTabsSlice } from './slices/tabs'
import type { VersionControlSlice } from './slices/version-control'
import { createVersionControlSlice } from './slices/version-control'
import type { WebRTCSlice } from './slices/webrtc'
import { createWebRTCSlice } from './slices/webrtc'
import type { WorkspaceSlice } from './slices/workspace'
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
  ReadmeSlice &
  SearchSlice &
  SharedSlice &
  TabsSlice &
  VersionControlSlice &
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
      ...createReadmeSlice(...a),
      ...createSearchSlice(...a),
      ...createSharedSlice(...a),
      ...createTabsSlice(...a),
      ...createVersionControlSlice(...a),
      ...createWebRTCSlice(...a),
      ...createWorkspaceSlice(...a),
    })),
  )
}

export const openPLCStoreBase = createOpenPLCStore()
export const useOpenPLCStore = createSelectorHooks(openPLCStoreBase)
