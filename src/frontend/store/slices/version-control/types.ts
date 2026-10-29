export type SidePanel = 'explorer' | 'source-control'

export type PendingChangeStatus = 'added' | 'modified' | 'deleted'

export type InitialPendingEntry = { path: string; status: PendingChangeStatus }

export type VersionControlState = {
  versionControl: {
    activePanel: SidePanel
    selectedCommitHash: string | null
    /** Sticky: only commit/restore/discard or a fresh /changes response replaces this list. */
    initialPending: InitialPendingEntry[]
    /** Per-path snapshot at the last sync point; `recordSavedFiles` diffs against it to detect a revert. */
    baselineContent: Record<string, string>
    /** Echoed back for unedited files, so parse-serialize formatting drift doesn't read as "modified". */
    rawLoadedContent: Record<string, string>
    /** Lets the save flow detect "unchanged since sync" for files with no file-slice entry. */
    loadedSerialized: Record<string, string>
    /** Paths whose latest save differs from baseline; toggled on save, so a revert clears it again. */
    changedPaths: string[]
    /** Derived: |unique(initialPending paths ∪ changedPaths)|. */
    pendingChangesCount: number
    /** `null` until lazily fetched. Unlike `baselineContent` (the loaded working tree), strictly committed content. */
    headContent: Record<string, string> | null
    /** Desktop only — the web opens `/history` in a new tab instead. */
    historyView: { commitHash: string; file?: string } | null
    /** Desktop only, same reason as `historyView`. */
    mergeView: { sourceBranch: string; targetBranch?: string } | null
  }
}

export type SavedFileRecord = { path: string; content: string }

export type VersionControlActions = {
  setActivePanel: (panel: SidePanel) => void
  setSelectedCommitHash: (hash: string | null) => void
  openHistoryView: (view: { commitHash: string; file?: string }) => void
  closeHistoryView: () => void
  openMergeView: (view: { sourceBranch: string; targetBranch?: string }) => void
  closeMergeView: () => void
  /** Set on every project load, reopens included, so a stale map is never left behind. */
  setRawLoadedContent: (content: Record<string, string>) => void
  /** Set (or clear, with `null`) the lazily-fetched HEAD snapshot used as the
   *  "original" side of source-control diffs. */
  setHeadContent: (content: Record<string, string> | null) => void
  /** Merge entries into the HEAD snapshot without dropping the rest of the map (creates it when `null`). */
  mergeHeadContent: (entries: Record<string, string>) => void
  initBaseline: (args: {
    initialPending: InitialPendingEntry[]
    baselineContent: Record<string, string>
    rawLoadedContent?: Record<string, string>
    loadedSerialized?: Record<string, string>
  }) => void
  /** Also prunes the saved/deleted paths from `headContent`, so the diff view refetches instead of trusting it. */
  recordSavedFiles: (args: { saved: SavedFileRecord[]; deleted: string[] }) => void
  syncFromChanges: (pendingChanges: InitialPendingEntry[]) => void
  /** After a commit: baseline becomes what was actually written, and the pending/changed lists clear. */
  commitBaseline: (args: { newBaseline: Record<string, string>; loadedSerialized: Record<string, string> }) => void
  clearVersionControlState: () => void
}

export type VersionControlSlice = VersionControlState & {
  versionControlActions: VersionControlActions
}
