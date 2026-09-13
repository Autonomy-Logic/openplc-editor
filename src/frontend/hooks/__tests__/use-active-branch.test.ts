/**
 * The remembered active branch.
 *
 * It is client state in `localStorage`, one entry per project, and it is the name the
 * history section passes into `listCommits({ branch })`. So a name that no longer exists is
 * not merely cosmetic: it queries a branch the server does not have.
 *
 * These tests pin the storage contract the reconciliation in `BranchStatusBar` depends on —
 * that a stored name is returned as-is, and that the default is used when nothing is stored.
 * The reconciliation itself lives in the component, which needs the branch list to judge.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

import { getActiveBranch } from '../use-active-branch'

const KEY = 'openplc:active-branches'

beforeEach(() => {
  localStorage.clear()
})

describe('getActiveBranch', () => {
  it('returns the default when nothing was ever stored', () => {
    expect(getActiveBranch('p1')).toBe('main')
  })

  it('honours the caller default over the built-in one', () => {
    // A repository whose default branch is not called `main` is the reason this parameter
    // exists; hard-coding `main` here would name a branch that may not exist.
    expect(getActiveBranch('p1', 'trunk')).toBe('trunk')
  })

  it('returns what was stored for that project, not another', () => {
    localStorage.setItem(KEY, JSON.stringify({ p1: 'feature-a', p2: 'feature-b' }))

    expect(getActiveBranch('p1')).toBe('feature-a')
    expect(getActiveBranch('p2')).toBe('feature-b')
    expect(getActiveBranch('p3')).toBe('main')
  })

  it('falls back rather than throwing when the entry is corrupt', () => {
    localStorage.setItem(KEY, 'not json')

    // Reading this must never be the thing that breaks the workspace.
    expect(getActiveBranch('p1')).toBe('main')
  })

  it('keeps returning a name that no longer exists — which is why the bar reconciles', () => {
    localStorage.setItem(KEY, JSON.stringify({ p1: 'deleted-elsewhere' }))

    // Documented deliberately: this layer cannot know what exists, so it answers honestly
    // from storage. Validating against the real branch list is the status bar's job.
    expect(getActiveBranch('p1')).toBe('deleted-elsewhere')
  })
})
