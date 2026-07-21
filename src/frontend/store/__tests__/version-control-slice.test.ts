import { createStore } from 'zustand/vanilla'

import { createVersionControlSlice } from '../slices/version-control/slice'
import type { VersionControlSlice } from '../slices/version-control/types'

function makeStore() {
  return createStore<VersionControlSlice>()(createVersionControlSlice)
}

describe('createVersionControlSlice', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  const vc = () => store.getState().versionControl
  const actions = () => store.getState().versionControlActions

  it('starts with sane defaults', () => {
    expect(vc().activePanel).toBe('explorer')
    expect(vc().selectedCommitHash).toBeNull()
    expect(vc().headContent).toBeNull()
    expect(vc().pendingChangesCount).toBe(0)
  })

  it('setActivePanel switches the panel', () => {
    actions().setActivePanel('source-control')
    expect(vc().activePanel).toBe('source-control')
  })

  it('setSelectedCommitHash sets and clears the hash', () => {
    actions().setSelectedCommitHash('abc123')
    expect(vc().selectedCommitHash).toBe('abc123')
    actions().setSelectedCommitHash(null)
    expect(vc().selectedCommitHash).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // headContent (source-control diff HEAD snapshot)
  // ---------------------------------------------------------------------------
  describe('setHeadContent', () => {
    it('stores a copy of the provided snapshot', () => {
      const snapshot = { 'pous/programs/Main.st': 'PROGRAM Main\nEND_PROGRAM' }
      actions().setHeadContent(snapshot)
      expect(vc().headContent).toEqual(snapshot)
      // Stored value is a copy, not the same reference.
      expect(vc().headContent).not.toBe(snapshot)
    })

    it('clears the snapshot when passed null', () => {
      actions().setHeadContent({ 'a.st': 'x' })
      actions().setHeadContent(null)
      expect(vc().headContent).toBeNull()
    })
  })

  describe('mergeHeadContent', () => {
    it('creates the snapshot from null', () => {
      actions().mergeHeadContent({ 'a.st': 'head-a' })
      expect(vc().headContent).toEqual({ 'a.st': 'head-a' })
    })

    it('merges entries without dropping the rest of the map', () => {
      actions().setHeadContent({ 'a.st': 'head-a', 'b.st': 'head-b' })
      actions().mergeHeadContent({ 'b.st': 'updated', 'c.st': 'head-c' })
      expect(vc().headContent).toEqual({ 'a.st': 'head-a', 'b.st': 'updated', 'c.st': 'head-c' })
    })
  })

  it('initBaseline resets the cached HEAD snapshot to null', () => {
    actions().setHeadContent({ 'a.st': 'x' })
    actions().initBaseline({
      initialPending: [{ path: 'a.st', status: 'modified' }],
      baselineContent: { 'a.st': 'serialized' },
      rawLoadedContent: { 'a.st': 'raw' },
      loadedSerialized: { 'a.st': 'serialized' },
    })
    expect(vc().headContent).toBeNull()
    // Raw text is preferred over serialized in the baseline.
    expect(vc().baselineContent['a.st']).toBe('raw')
    expect(vc().loadedSerialized['a.st']).toBe('serialized')
    expect(vc().pendingChangesCount).toBe(1)
  })

  it('initBaseline falls back to baselineContent when raw/serialized omitted', () => {
    actions().initBaseline({
      initialPending: [],
      baselineContent: { 'a.st': 'base' },
    })
    expect(vc().baselineContent['a.st']).toBe('base')
    expect(vc().loadedSerialized['a.st']).toBe('base')
    expect(vc().rawLoadedContent).toEqual({})
  })

  it('syncFromChanges replaces the pending set and clears changedPaths', () => {
    actions().initBaseline({ initialPending: [], baselineContent: {} })
    actions().syncFromChanges([
      { path: 'a.st', status: 'modified' },
      { path: 'a.st', status: 'modified' }, // duplicate is deduped
      { path: 'b.st', status: 'added' },
    ])
    expect(vc().pendingChangesCount).toBe(2)
  })

  describe('recordSavedFiles', () => {
    it('adds, clears, and skips paths per baseline / initialPending', () => {
      actions().initBaseline({
        initialPending: [{ path: 'pending.st', status: 'modified' }],
        baselineContent: { 'clean.st': 'same', 'pending.st': 'p' },
        rawLoadedContent: { 'clean.st': 'same', 'pending.st': 'p' },
        loadedSerialized: { 'clean.st': 'same', 'pending.st': 'p' },
      })

      actions().recordSavedFiles({
        saved: [
          { path: 'clean.st', content: 'same' }, // matches baseline → not changed
          { path: 'edited.st', content: 'new' }, // differs → changed
          { path: 'pending.st', content: 'p2' }, // in initialPending → skipped
        ],
        deleted: [],
      })

      expect(vc().changedPaths).toContain('edited.st')
      expect(vc().changedPaths).not.toContain('clean.st')
      // rawLoadedContent mirrors the just-saved content.
      expect(vc().rawLoadedContent['edited.st']).toBe('new')
    })

    it('handles deletions across initialPending and baseline cases', () => {
      actions().initBaseline({
        initialPending: [
          { path: 'added.st', status: 'added' },
          { path: 'mod.st', status: 'modified' },
        ],
        baselineContent: { 'mod.st': 'm', 'tracked.st': 't' },
      })

      actions().recordSavedFiles({
        saved: [],
        deleted: [
          'added.st', // initialPending 'added' → removed from pending
          'mod.st', // initialPending 'modified' → stays pending
          'tracked.st', // not pending, in baseline → becomes pending
          'session.st', // not pending, not in baseline → cancels out
        ],
      })

      const pendingPaths = vc().initialPending.map((e) => e.path)
      expect(pendingPaths).toContain('mod.st')
      expect(pendingPaths).not.toContain('added.st')
      expect(vc().changedPaths).toContain('tracked.st')
      expect(vc().changedPaths).not.toContain('session.st')
    })

    it('prunes saved and deleted paths from the cached HEAD snapshot', () => {
      actions().initBaseline({ initialPending: [], baselineContent: { 'gone.st': 'g' } })
      actions().setHeadContent({ 'saved.st': 'old-head', 'gone.st': 'old-head', 'untouched.st': 'head' })

      actions().recordSavedFiles({
        saved: [{ path: 'saved.st', content: 'new' }],
        deleted: ['gone.st'],
      })

      expect(vc().headContent).toEqual({ 'untouched.st': 'head' })
    })

    it('leaves the HEAD snapshot null when it was never fetched', () => {
      actions().initBaseline({ initialPending: [], baselineContent: {} })

      actions().recordSavedFiles({
        saved: [{ path: 'saved.st', content: 'new' }],
        deleted: [],
      })

      expect(vc().headContent).toBeNull()
    })
  })

  it('commitBaseline refreshes baseline, clears pending, and invalidates HEAD', () => {
    actions().initBaseline({
      initialPending: [{ path: 'a.st', status: 'modified' }],
      baselineContent: { 'a.st': 'old' },
    })
    actions().setHeadContent({ 'a.st': 'old' })

    actions().commitBaseline({
      newBaseline: { 'a.st': 'new' },
      loadedSerialized: { 'a.st': 'new' },
    })

    expect(vc().baselineContent['a.st']).toBe('new')
    expect(vc().rawLoadedContent['a.st']).toBe('new')
    expect(vc().initialPending).toEqual([])
    expect(vc().changedPaths).toEqual([])
    expect(vc().pendingChangesCount).toBe(0)
    expect(vc().headContent).toBeNull()
  })

  it('clearVersionControlState resets everything', () => {
    actions().setActivePanel('source-control')
    actions().setHeadContent({ 'a.st': 'x' })
    actions().clearVersionControlState()
    expect(vc().activePanel).toBe('explorer')
    expect(vc().headContent).toBeNull()
    expect(vc().pendingChangesCount).toBe(0)
  })
})
