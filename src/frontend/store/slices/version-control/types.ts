export type SidePanel = 'explorer' | 'source-control'

export type PendingChangeStatus = 'added' | 'modified' | 'deleted'

export type InitialPendingEntry = { path: string; status: PendingChangeStatus }

export type VersionControlState = {
  versionControl: {
    activePanel: SidePanel
    selectedCommitHash: string | null
    /**
     * Files flagged by /changes at the last sync point, paired with the
     * status the backend reported ('added' | 'modified' | 'deleted'). Status
     * is needed so a delete event can correctly clear an "added" entry but
     * keep a "modified" entry (the deletion is still pending vs HEAD, just
     * with a different status).
     *
     * Sticky — only commit/restore/discard or a fresh /changes response
     * fully replaces this list; targeted updates happen via recordSavedFiles
     * when a deletion takes a path out of initialPending entirely.
     */
    initialPending: InitialPendingEntry[]
    /**
     * Per-path serialized snapshot taken at the last sync point. Used by
     * `recordSavedFiles` to detect "user reverted to baseline" and remove
     * the path from `changedPaths`, plus to distinguish "delete of a
     * session-added file" from "delete of a HEAD-tracked file".
     * Refreshed on commit/restore/discard.
     */
    baselineContent: Record<string, string>
    /**
     * Raw file text as returned by the backend at load time (or the content
     * uploaded at the last sync point — load/commit). Used by the save flow
     * to echo back byte-identical content for unedited files, preventing
     * parse-serialize formatting drift from showing every POU as "modified"
     * vs HEAD on the first save after open.
     */
    rawLoadedContent: Record<string, string>
    /**
     * Pure-serialized snapshot of project state at the last sync point
     * (load or commit). Lets the save flow detect "state hasn't changed
     * since sync" without depending on file-slice tracking — necessary for
     * special files like `project.json` and `devices/*.json` that don't
     * have file-slice entries but still benefit from the raw fallback.
     */
    loadedSerialized: Record<string, string>
    /**
     * Paths whose latest save produced content that differs from baseline.
     * Toggled by save events: added when content differs, removed when it
     * matches baseline (the modify-then-save-then-revert-then-save case).
     */
    changedPaths: string[]
    /** Derived: |unique(initialPending paths ∪ changedPaths)|. */
    pendingChangesCount: number
    /**
     * Per-path HEAD (committed) content of the currently-changed files — the
     * "original" side of source-control diffs. Populated from the backend's
     * `/changes?includeContent=true` `before` field (authoritative against the
     * real HEAD). `null` until lazily fetched by the diff view; reset to `null`
     * on project load / commit / in-place reload so it refetches against the
     * current HEAD, and pruned per-path by `recordSavedFiles` so a re-edited
     * file never diffs against a stale snapshot. Unlike `baselineContent`
     * (which reflects the loaded working tree and so already includes
     * pre-existing pending changes), this is the committed content, so it can
     * show a diff for changes made before the current session.
     */
    headContent: Record<string, string> | null
  }
}

export type SavedFileRecord = { path: string; content: string }

export type VersionControlActions = {
  setActivePanel: (panel: SidePanel) => void
  setSelectedCommitHash: (hash: string | null) => void
  /** Set (or clear, with `null`) the lazily-fetched HEAD snapshot used as the
   *  "original" side of source-control diffs. */
  setHeadContent: (content: Record<string, string> | null) => void
  /** Merge entries into the HEAD snapshot without dropping the rest of the map (creates it when `null`). */
  mergeHeadContent: (entries: Record<string, string>) => void
  /**
   * Snapshot baseline + initial pending at the last "in-sync" point
   * (project load, after restore, after discard).
   *
   * `baselineContent` is what the upload should produce when state matches
   * the sync point (used for badge tracking).
   * `rawLoadedContent` is the actual S3/HEAD content per path (used by the
   * save flow to upload byte-identical content for unchanged files).
   * `loadedSerialized` is `serialize(state)` at the sync point — used to
   * detect "state == sync state?" via comparison at save time.
   */
  initBaseline: (args: {
    initialPending: InitialPendingEntry[]
    baselineContent: Record<string, string>
    rawLoadedContent?: Record<string, string>
    loadedSerialized?: Record<string, string>
  }) => void
  /**
   * Update `changedPaths` based on what the save just sent. Files matching
   * baseline are removed; files differing are added; deletions are folded
   * back into initialPending or changedPaths depending on their original
   * status (see slice implementation for the case-by-case logic). Also prunes
   * the saved/deleted paths from the cached `headContent` snapshot so the
   * diff view refetches their HEAD side instead of trusting a possibly-stale
   * entry.
   */
  recordSavedFiles: (args: { saved: SavedFileRecord[]; deleted: string[] }) => void
  /**
   * Reset initialPending to the authoritative answer from /changes. Used
   * when the source-control panel re-fetches and after a commit.
   */
  syncFromChanges: (pendingChanges: InitialPendingEntry[]) => void
  /**
   * After a successful commit: refresh baseline to what was actually written
   * to S3 (mixed of raw + serialized) and `loadedSerialized` to the pure
   * serialize of current state (used by save flow for state-equality
   * detection). Clear initialPending and changedPaths.
   */
  commitBaseline: (args: { newBaseline: Record<string, string>; loadedSerialized: Record<string, string> }) => void
  clearVersionControlState: () => void
}

export type VersionControlSlice = VersionControlState & {
  versionControlActions: VersionControlActions
}
