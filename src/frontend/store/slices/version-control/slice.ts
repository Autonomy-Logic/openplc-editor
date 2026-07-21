import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { InitialPendingEntry, SavedFileRecord, SidePanel, VersionControlSlice } from './types'

const initialState: VersionControlSlice['versionControl'] = {
  activePanel: 'explorer',
  selectedCommitHash: null,
  initialPending: [],
  baselineContent: {},
  rawLoadedContent: {},
  loadedSerialized: {},
  changedPaths: [],
  pendingChangesCount: 0,
  headContent: null,
}

function dedupeByPath(entries: InitialPendingEntry[]): InitialPendingEntry[] {
  const seen = new Set<string>()
  const out: InitialPendingEntry[] = []
  for (const e of entries) {
    if (seen.has(e.path)) continue
    seen.add(e.path)
    out.push(e)
  }
  return out
}

function recomputeCount(draft: VersionControlSlice): void {
  const paths = new Set<string>()
  for (const entry of draft.versionControl.initialPending) paths.add(entry.path)
  for (const path of draft.versionControl.changedPaths) paths.add(path)
  draft.versionControl.pendingChangesCount = paths.size
}

const createVersionControlSlice: StateCreator<VersionControlSlice, [], [], VersionControlSlice> = (setState) => ({
  versionControl: { ...initialState, baselineContent: {}, rawLoadedContent: {}, loadedSerialized: {} },

  versionControlActions: {
    setActivePanel: (panel: SidePanel) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.activePanel = panel
        }),
      ),

    setSelectedCommitHash: (hash: string | null) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.selectedCommitHash = hash
        }),
      ),

    setHeadContent: (content: Record<string, string> | null) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.headContent = content ? { ...content } : null
        }),
      ),

    mergeHeadContent: (entries: Record<string, string>) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.headContent = { ...(draft.versionControl.headContent ?? {}), ...entries }
        }),
      ),

    initBaseline: ({ initialPending, baselineContent, rawLoadedContent, loadedSerialized }) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.initialPending = dedupeByPath(initialPending)
          // Prefer raw text as baseline for paths where it's available — this
          // way "saving without editing" produces byte-identical content to
          // what S3 already has, instead of a re-serialized form that would
          // diff against HEAD because of formatting drift.
          const merged: Record<string, string> = { ...baselineContent }
          if (rawLoadedContent) {
            for (const [path, raw] of Object.entries(rawLoadedContent)) {
              merged[path] = raw
            }
          }
          draft.versionControl.baselineContent = merged
          draft.versionControl.rawLoadedContent = rawLoadedContent ? { ...rawLoadedContent } : {}
          // `loadedSerialized` is what was passed as `baselineContent` BEFORE
          // the merge — pure serialize at sync point. Used by the save flow
          // for "is state == sync state?" comparison without relying on
          // file-slice tracking. Falls back to baselineContent if the caller
          // didn't provide it (initBaseline was invoked from a path that
          // doesn't compute it separately).
          draft.versionControl.loadedSerialized = loadedSerialized ? { ...loadedSerialized } : { ...baselineContent }
          draft.versionControl.changedPaths = []
          // New project load → drop the cached HEAD snapshot so diffs refetch
          // against this project's HEAD.
          draft.versionControl.headContent = null
          recomputeCount(draft)
        }),
      ),

    recordSavedFiles: ({ saved, deleted }: { saved: SavedFileRecord[]; deleted: string[] }) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          const baseline = draft.versionControl.baselineContent
          const initialMap = new Map(draft.versionControl.initialPending.map((e) => [e.path, e.status]))
          const changedSet = new Set(draft.versionControl.changedPaths)

          // Drop the cached HEAD snapshot for every path this save touched.
          // A save doesn't move HEAD, but the cached entry may predate it
          // wrongly (e.g. a fetch that raced a commit), and the diff view
          // can't tell a stale entry from a fresh one — pruning forces it to
          // refetch authoritative content the next time the path is viewed.
          if (draft.versionControl.headContent) {
            for (const { path } of saved) delete draft.versionControl.headContent[path]
            for (const path of deleted) delete draft.versionControl.headContent[path]
          }

          for (const { path, content } of saved) {
            // Track S3's current state for this path so future "clean"
            // saves echo back what's now in S3 (instead of the original
            // load-time raw, which would revert the just-saved edit).
            draft.versionControl.rawLoadedContent[path] = content

            // Files in initialPending cannot be cleared by user reverts:
            // we only have S3 content as baseline, not HEAD content, so we
            // can't tell if the user reverted to HEAD. Leave them sticky.
            if (initialMap.has(path)) continue

            if (baseline[path] !== undefined && baseline[path] === content) {
              changedSet.delete(path)
            } else {
              changedSet.add(path)
            }
          }

          for (const path of deleted) {
            const initialStatus = initialMap.get(path)
            if (initialStatus !== undefined) {
              // Path was already pending at last sync. Status decides the outcome:
              //   - 'added':    file was in S3 but not HEAD. Deleting it brings S3
              //                 back to "no file there", same as HEAD → not pending.
              //   - 'modified': file was in S3 with different content from HEAD.
              //                 Deleting still leaves S3 ≠ HEAD (now as a deletion).
              //                 Stays pending.
              //   - 'deleted':  weird case (already gone from S3). Stays pending.
              if (initialStatus === 'added') {
                initialMap.delete(path)
                changedSet.delete(path)
              }
              // 'modified' / 'deleted' → no-op: keep in initialPending.
            } else {
              // Not in initialPending. Whether this deletion is a new pending
              // change depends on whether the path was in the baseline:
              //   - baseline has it → file was in HEAD → deletion is pending.
              //   - baseline doesn't → file was added in this session, never
              //     committed, now being deleted → cancels out, not pending.
              if (baseline[path] !== undefined) {
                changedSet.add(path)
              } else {
                changedSet.delete(path)
              }
            }
            // The baseline entry and raw mirror are no longer relevant —
            // drop both so a future re-creation of the same path starts
            // from a clean slate.
            delete draft.versionControl.baselineContent[path]
            delete draft.versionControl.rawLoadedContent[path]
          }

          draft.versionControl.initialPending = Array.from(initialMap, ([path, status]) => ({ path, status }))
          draft.versionControl.changedPaths = Array.from(changedSet)
          recomputeCount(draft)
        }),
      ),

    syncFromChanges: (pendingChanges: InitialPendingEntry[]) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl.initialPending = dedupeByPath(pendingChanges)
          draft.versionControl.changedPaths = []
          recomputeCount(draft)
        }),
      ),

    commitBaseline: ({ newBaseline, loadedSerialized }) =>
      setState(
        produce<VersionControlSlice>((draft) => {
          // After commit, S3 == HEAD == newBaseline. Baseline and the raw
          // mirror reflect actual S3 content (mixed: raw for files that
          // stayed clean across commit, serialized for files that were
          // edited and uploaded). `loadedSerialized` is the pure serialize
          // of current state — needed so the save flow can later detect
          // "state hasn't changed since this commit" via byte-equality.
          draft.versionControl.baselineContent = { ...newBaseline }
          draft.versionControl.rawLoadedContent = { ...newBaseline }
          draft.versionControl.loadedSerialized = { ...loadedSerialized }
          draft.versionControl.initialPending = []
          draft.versionControl.changedPaths = []
          draft.versionControl.pendingChangesCount = 0
          // HEAD moved to the just-created commit → invalidate the cached
          // snapshot so subsequent diffs compare against the new HEAD.
          draft.versionControl.headContent = null
        }),
      ),

    clearVersionControlState: () =>
      setState(
        produce<VersionControlSlice>((draft) => {
          draft.versionControl = {
            ...initialState,
            baselineContent: {},
            rawLoadedContent: {},
            loadedSerialized: {},
          }
        }),
      ),
  },
})

export { createVersionControlSlice }
