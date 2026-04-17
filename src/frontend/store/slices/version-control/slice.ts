import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { SidePanel, VersionControlSlice } from './types'

const initialState: VersionControlSlice['versionControl'] = {
  activePanel: 'explorer',
  activeBranch: null,
  selectedCommitHash: null,
  pendingChangesCount: 0,
}

const createVersionControlSlice: StateCreator<VersionControlSlice, [], [], VersionControlSlice> = (setState) => ({
  versionControl: { ...initialState },

  versionControlActions: {
    setActivePanel: (panel: SidePanel) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.activePanel = panel
        }),
      ),

    setActiveBranch: (branchName: string | null) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.activeBranch = branchName
        }),
      ),

    setSelectedCommitHash: (hash: string | null) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.selectedCommitHash = hash
        }),
      ),

    setPendingChangesCount: (count: number) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.pendingChangesCount = count
        }),
      ),

    clearVersionControlState: () =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl = { ...initialState }
        }),
      ),
  },
})

export { createVersionControlSlice }
