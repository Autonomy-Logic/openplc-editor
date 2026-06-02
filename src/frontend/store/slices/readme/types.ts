/**
 * README slice state.
 *
 * `savedContent` mirrors what the backend most recently confirmed:
 *   - `null`         → project has no README (file absent, column empty)
 *   - `string`       → the resolved README from `/details`
 *   - `undefined`    → not loaded yet (the slice hasn't been hydrated for
 *                      this project; the editor opens with the README
 *                      panel disabled until hydration completes)
 *
 * `draftContent` is the in-flight buffer used while the user is editing.
 * It only diverges from `savedContent` between opening the editor and
 * saving/discarding; `isDirty` is derived from the comparison.
 */
export type ReadmeStatus = 'idle' | 'loading' | 'saving' | 'deleting'

export type ReadmeSlice = {
  readme: {
    savedContent: string | null | undefined
    draftContent: string
    commitMessage: string
    status: ReadmeStatus
    error: string | null
  }
  readmeActions: ReadmeActions
}

export type ReadmeActions = {
  /** Replace the snapshot held in the slice. Called after project
   *  hydration and after every save. Pass `null` for "no README". */
  hydrate: (content: string | null | undefined) => void
  /** Enter edit mode — copies savedContent into the draft buffer and
   *  pre-fills the commit message. */
  beginEdit: (defaultContent?: string) => void
  /** Discard any in-flight changes. */
  cancelEdit: () => void
  /** Update the draft buffer as the user types. */
  setDraft: (content: string) => void
  /** Update the commit message override. */
  setCommitMessage: (message: string) => void
  /** Mark the slice as in-flight; called by the save action. */
  setStatus: (status: ReadmeStatus, error?: string | null) => void
  /** Update both `savedContent` and `draftContent` to the same value
   *  (typically after a successful save). Pass `null` after a delete. */
  commitSaved: (content: string | null) => void
  /** Wipe the slice (e.g. when the active project changes). */
  reset: () => void
}
