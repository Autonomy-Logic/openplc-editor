export type SidePanel = 'explorer' | 'source-control'

export type VersionControlState = {
  versionControl: {
    activePanel: SidePanel
    activeBranch: string | null
    selectedCommitHash: string | null
    pendingChangesCount: number
  }
}

export type VersionControlActions = {
  setActivePanel: (panel: SidePanel) => void
  setActiveBranch: (branchName: string | null) => void
  setSelectedCommitHash: (hash: string | null) => void
  setPendingChangesCount: (count: number) => void
  clearVersionControlState: () => void
}

export type VersionControlSlice = VersionControlState & {
  versionControlActions: VersionControlActions
}
