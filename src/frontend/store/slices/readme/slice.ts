import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { ReadmeSlice, ReadmeStatus } from './types'

const initialState = {
  savedContent: undefined as string | null | undefined,
  draftContent: '',
  commitMessage: '',
  status: 'idle' as ReadmeStatus,
  error: null as string | null,
}

const createReadmeSlice: StateCreator<ReadmeSlice, [], [], ReadmeSlice> = (setState) => ({
  readme: { ...initialState },

  readmeActions: {
    hydrate: (content) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.savedContent = content
          // Don't clobber an in-progress edit when the API refetches —
          // the draft buffer stays whatever the user typed. Only seed
          // the draft if we haven't entered edit mode yet (the slice
          // owns the editing transition and resets the draft on save).
          if (draft.readme.status !== 'saving' && draft.readme.status !== 'deleting') {
            draft.readme.draftContent = content ?? ''
          }
        }),
      )
    },

    beginEdit: (defaultContent) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.draftContent = defaultContent !== undefined ? defaultContent : (draft.readme.savedContent ?? '')
          // Pre-fill the commit message with the default that matches
          // the action the user is about to perform. The backend
          // applies the same defaults when commitMessage is omitted,
          // so the user sees exactly what would be committed.
          const hasExisting = draft.readme.savedContent != null
          draft.readme.commitMessage = hasExisting ? 'docs: update README' : 'docs: create README'
          draft.readme.error = null
        }),
      )
    },

    cancelEdit: () => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.draftContent = draft.readme.savedContent ?? ''
          draft.readme.commitMessage = ''
          draft.readme.error = null
          draft.readme.status = 'idle'
        }),
      )
    },

    setDraft: (content) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.draftContent = content
        }),
      )
    },

    setCommitMessage: (message) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.commitMessage = message
        }),
      )
    },

    setStatus: (status, error) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.status = status
          // Only mutate error when explicitly passed — `setStatus('saving')`
          // shouldn't wipe a prior failure message until the new attempt
          // completes (or starts: the panel does pass `null` to clear).
          if (error !== undefined) draft.readme.error = error
        }),
      )
    },

    commitSaved: (content) => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme.savedContent = content
          draft.readme.draftContent = content ?? ''
          draft.readme.commitMessage = ''
          draft.readme.status = 'idle'
          draft.readme.error = null
        }),
      )
    },

    reset: () => {
      setState(
        produce((draft: ReadmeSlice) => {
          draft.readme = { ...initialState }
        }),
      )
    },
  },
})

export { createReadmeSlice }
