import { createStore } from 'zustand/vanilla'

import { createReadmeSlice } from '../slices/readme/slice'
import type { ReadmeSlice } from '../slices/readme/types'

function makeStore() {
  return createStore<ReadmeSlice>()(createReadmeSlice)
}

describe('createReadmeSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('starts in idle with no content', () => {
    const { readme } = store.getState()
    expect(readme).toEqual({
      savedContent: undefined,
      draftContent: '',
      commitMessage: '',
      status: 'idle',
      error: null,
    })
  })

  // -------------------------------------------------------------------------
  // hydrate
  // -------------------------------------------------------------------------
  it('hydrate populates savedContent and seeds draftContent', () => {
    store.getState().readmeActions.hydrate('# Hello')
    expect(store.getState().readme.savedContent).toBe('# Hello')
    expect(store.getState().readme.draftContent).toBe('# Hello')
  })

  it('hydrate(null) marks the project as having no README and clears the draft', () => {
    // Pre-seed something so we can confirm the draft is reset on a null hydrate.
    store.getState().readmeActions.beginEdit('# stale')
    store.getState().readmeActions.hydrate(null)
    expect(store.getState().readme.savedContent).toBeNull()
    expect(store.getState().readme.draftContent).toBe('')
  })

  it('hydrate(undefined) clears the slot (treated as not-loaded)', () => {
    store.getState().readmeActions.hydrate('# Loaded')
    store.getState().readmeActions.hydrate(undefined)
    expect(store.getState().readme.savedContent).toBeUndefined()
    // draftContent collapses to '' because the function uses content ?? ''.
    expect(store.getState().readme.draftContent).toBe('')
  })

  it('hydrate while saving does NOT clobber the draft (preserves in-progress edits)', () => {
    // Simulate the panel being mid-save: status is 'saving' and the
    // draftContent is the user's unsaved buffer.
    store.getState().readmeActions.beginEdit('# baseline')
    store.getState().readmeActions.setDraft('# user typed this')
    store.getState().readmeActions.setStatus('saving')

    // A refetch comes in with a different on-disk value — we must not
    // overwrite the user's draft just because the API responded.
    store.getState().readmeActions.hydrate('# server says something else')

    expect(store.getState().readme.savedContent).toBe('# server says something else')
    expect(store.getState().readme.draftContent).toBe('# user typed this')
  })

  it('hydrate while deleting also preserves the draft', () => {
    store.getState().readmeActions.setStatus('deleting')
    store.getState().readmeActions.setDraft('# keep me')
    store.getState().readmeActions.hydrate('# overwritten?')
    expect(store.getState().readme.draftContent).toBe('# keep me')
  })

  // -------------------------------------------------------------------------
  // beginEdit
  // -------------------------------------------------------------------------
  it('beginEdit with no arg seeds from savedContent', () => {
    store.getState().readmeActions.hydrate('# Saved')
    store.getState().readmeActions.setDraft('something else')
    store.getState().readmeActions.beginEdit()
    expect(store.getState().readme.draftContent).toBe('# Saved')
  })

  it('beginEdit falls back to empty string when savedContent is null', () => {
    store.getState().readmeActions.hydrate(null)
    store.getState().readmeActions.beginEdit()
    expect(store.getState().readme.draftContent).toBe('')
  })

  it('beginEdit accepts an explicit default (used for the "Create README" template)', () => {
    store.getState().readmeActions.hydrate(null)
    store.getState().readmeActions.beginEdit('# Project\n\nDescribe me.\n')
    expect(store.getState().readme.draftContent).toBe('# Project\n\nDescribe me.\n')
  })

  it('beginEdit accepts an explicit empty string default (distinct from undefined)', () => {
    store.getState().readmeActions.hydrate('# saved')
    store.getState().readmeActions.beginEdit('')
    // Explicit '' is honored even when there is savedContent — this is
    // what lets the user blank out the editor without confusing the
    // begin/cancel semantics.
    expect(store.getState().readme.draftContent).toBe('')
  })

  it('beginEdit pre-fills the commit message based on whether the README exists', () => {
    store.getState().readmeActions.hydrate(null)
    store.getState().readmeActions.beginEdit()
    expect(store.getState().readme.commitMessage).toBe('docs: create README')

    store.getState().readmeActions.hydrate('# existing')
    store.getState().readmeActions.beginEdit()
    expect(store.getState().readme.commitMessage).toBe('docs: update README')
  })

  it('beginEdit clears any prior error', () => {
    store.getState().readmeActions.setStatus('idle', 'previous failure')
    store.getState().readmeActions.beginEdit()
    expect(store.getState().readme.error).toBeNull()
  })

  // -------------------------------------------------------------------------
  // cancelEdit
  // -------------------------------------------------------------------------
  it('cancelEdit restores the draft to savedContent and resets transient fields', () => {
    store.getState().readmeActions.hydrate('# saved')
    store.getState().readmeActions.setDraft('# unsaved scratch')
    store.getState().readmeActions.setCommitMessage('docs: wip')
    store.getState().readmeActions.setStatus('idle', 'something failed')

    store.getState().readmeActions.cancelEdit()
    expect(store.getState().readme.draftContent).toBe('# saved')
    expect(store.getState().readme.commitMessage).toBe('')
    expect(store.getState().readme.error).toBeNull()
    expect(store.getState().readme.status).toBe('idle')
  })

  it('cancelEdit collapses to empty string when there was no README', () => {
    store.getState().readmeActions.hydrate(null)
    store.getState().readmeActions.setDraft('# half-written')
    store.getState().readmeActions.cancelEdit()
    expect(store.getState().readme.draftContent).toBe('')
  })

  // -------------------------------------------------------------------------
  // setDraft / setCommitMessage
  // -------------------------------------------------------------------------
  it('setDraft updates only the draft buffer', () => {
    store.getState().readmeActions.hydrate('# saved')
    store.getState().readmeActions.setDraft('# typed')
    expect(store.getState().readme.draftContent).toBe('# typed')
    expect(store.getState().readme.savedContent).toBe('# saved')
  })

  it('setCommitMessage updates only the message field', () => {
    store.getState().readmeActions.setCommitMessage('docs: clarify wiring')
    expect(store.getState().readme.commitMessage).toBe('docs: clarify wiring')
  })

  // -------------------------------------------------------------------------
  // setStatus
  // -------------------------------------------------------------------------
  it('setStatus updates the status field', () => {
    store.getState().readmeActions.setStatus('saving')
    expect(store.getState().readme.status).toBe('saving')
    store.getState().readmeActions.setStatus('idle')
    expect(store.getState().readme.status).toBe('idle')
  })

  it('setStatus does NOT clear the error when called without an error arg', () => {
    store.getState().readmeActions.setStatus('idle', 'first failure')
    store.getState().readmeActions.setStatus('saving') // retry
    expect(store.getState().readme.error).toBe('first failure')
  })

  it('setStatus(null) explicitly clears the error', () => {
    store.getState().readmeActions.setStatus('idle', 'first failure')
    store.getState().readmeActions.setStatus('saving', null)
    expect(store.getState().readme.error).toBeNull()
  })

  it('setStatus sets a new error string when passed one', () => {
    store.getState().readmeActions.setStatus('idle', 'quota exceeded')
    expect(store.getState().readme.error).toBe('quota exceeded')
  })

  // -------------------------------------------------------------------------
  // commitSaved
  // -------------------------------------------------------------------------
  it('commitSaved synchronizes savedContent and draftContent and clears transient state', () => {
    store.getState().readmeActions.beginEdit('# initial')
    store.getState().readmeActions.setDraft('# new')
    store.getState().readmeActions.setCommitMessage('docs: clarify')
    store.getState().readmeActions.setStatus('saving')

    store.getState().readmeActions.commitSaved('# new')
    expect(store.getState().readme.savedContent).toBe('# new')
    expect(store.getState().readme.draftContent).toBe('# new')
    expect(store.getState().readme.commitMessage).toBe('')
    expect(store.getState().readme.status).toBe('idle')
    expect(store.getState().readme.error).toBeNull()
  })

  it('commitSaved(null) reflects a successful delete', () => {
    store.getState().readmeActions.hydrate('# existing')
    store.getState().readmeActions.commitSaved(null)
    expect(store.getState().readme.savedContent).toBeNull()
    expect(store.getState().readme.draftContent).toBe('')
  })

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------
  it('reset returns the slice to its initial state', () => {
    store.getState().readmeActions.hydrate('# loaded')
    store.getState().readmeActions.setDraft('# scratch')
    store.getState().readmeActions.setCommitMessage('docs: …')
    store.getState().readmeActions.setStatus('saving', 'oops')

    store.getState().readmeActions.reset()
    const { readme } = store.getState()
    expect(readme).toEqual({
      savedContent: undefined,
      draftContent: '',
      commitMessage: '',
      status: 'idle',
      error: null,
    })
  })
})
