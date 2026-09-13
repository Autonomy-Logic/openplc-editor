export type SidePanel = 'explorer' | 'source-control'

export type PendingChangeStatus = 'added' | 'modified' | 'deleted'

export type InitialPendingEntry = { path: string; status: PendingChangeStatus }

export type VersionControlState = {
  versionControl: {
    activePanel: SidePanel
    selectedCommitHash: string | null
    /** Files flagged by /changes at the last sync point, with the status the backend reported
     * (a delete can then correctly clear an "added" entry while keeping a "modified" one). Sticky —
     * only commit/restore/discard or a fresh /changes response fully replaces this list. */
    initialPending: InitialPendingEntry[]
    /** Per-path serialized snapshot at the last sync point; `recordSavedFiles` diffs against
     * this to detect a revert to baseline and to tell a session-added delete from a HEAD-tracked one. */
    baselineContent: Record<string, string>
    /** Raw file text from the backend at the last sync point; the save flow echoes this back
     * for unedited files to avoid parse-serialize formatting drift showing up as "modified". */
    rawLoadedContent: Record<string, string>
    /** Pure-serialized project snapshot at the last sync point; lets the save flow detect
     * "unchanged since sync" without file-slice tracking (needed for files with no file-slice entry). */
    loadedSerialized: Record<string, string>
    /** Paths whose latest save differs from baseline; toggled on save so a
     * modify-then-save-then-revert-then-save case clears it again. */
    changedPaths: string[]
    /** Derived: |unique(initialPending paths ∪ changedPaths)|. */
    pendingChangesCount: number
    /** Per-path HEAD (committed) content for the diff view's "original" side. `null` until
     * lazily fetched; reset on load/commit/reload and pruned per-path by `recordSavedFiles`.
     * Unlike `baselineContent` (the loaded working tree), this is strictly committed content. */
    headContent: Record<string, string> | null
    /** The commit whose full-file view is open, or `null`. Desktop only — the web opens
     * `/history` in a new tab instead; see `CommitHistoryView`. */
    historyView: { commitHash: string; file?: string } | null
    /** The branch merge screen that is open, or `null`. Desktop only, same reason as `historyView`. */
    mergeView: { sourceBranch: string; targetBranch?: string } | null
  }
}

export type SavedFileRecord = { path: string; content: string }

export type VersionControlActions = {
  setActivePanel: (panel: SidePanel) => void
  setSelectedCommitHash: (hash: string | null) => void
  /** Open the full-file view for a commit. Desktop only — see `historyView`. */
  openHistoryView: (view: { commitHash: string; file?: string }) => void
  /** Close it, returning to the workspace underneath. */
  closeHistoryView: () => void
  /** Open the merge screen for a branch. Desktop only — see `mergeView`. */
  openMergeView: (view: { sourceBranch: string; targetBranch?: string }) => void
  /** Close it, returning to the workspace underneath. */
  closeMergeView: () => void
  /** Keep the bytes a reader handed over so unedited files echo back unchanged; set on every
   * project load, including a reopen, so a stale map is never left behind. */
  setRawLoadedContent: (content: Record<string, string>) => void
  /** Set (or clear, with `null`) the lazily-fetched HEAD snapshot used as the
   *  "original" side of source-control diffs. */
  setHeadContent: (content: Record<string, string> | null) => void
  /** Merge entries into the HEAD snapshot without dropping the rest of the map (creates it when `null`). */
  mergeHeadContent: (entries: Record<string, string>) => void
  /** Snapshot baseline + initial pending at the last in-sync point (load/restore/discard):
   * `baselineContent` for badge tracking, `rawLoadedContent` for byte-identical echoes,
   * `loadedSerialized` for sync-state comparison at save time. */
  initBaseline: (args: {
    initialPending: InitialPendingEntry[]
    baselineContent: Record<string, string>
    rawLoadedContent?: Record<string, string>
    loadedSerialized?: Record<string, string>
  }) => void
  /** Update `changedPaths` from what the save just sent, folding deletions back into
   * `initialPending`/`changedPaths` per their original status; also prunes the saved/deleted
   * paths from `headContent` so the diff view refetches rather than trusting a stale entry. */
  recordSavedFiles: (args: { saved: SavedFileRecord[]; deleted: string[] }) => void
  /** Reset initialPending to the authoritative /changes answer (panel refetch, post-commit). */
  syncFromChanges: (pendingChanges: InitialPendingEntry[]) => void
  /** After a commit: refresh baseline to what was actually written to S3 and `loadedSerialized`
   * to the current state's pure serialize; clear initialPending and changedPaths. */
  commitBaseline: (args: { newBaseline: Record<string, string>; loadedSerialized: Record<string, string> }) => void
  clearVersionControlState: () => void
}

export type VersionControlSlice = VersionControlState & {
  versionControlActions: VersionControlActions
}
