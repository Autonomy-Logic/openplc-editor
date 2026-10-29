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
    // A repository whose default branch is not `main` is why this parameter exists.
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

    // This layer cannot know what exists; validating against the branch list is the status bar's job.
    expect(getActiveBranch('p1')).toBe('deleted-elsewhere')
  })
})
