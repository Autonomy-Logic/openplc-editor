import { describe, expect, it } from '@jest/globals'

import { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from '../platform-capabilities'

describe('hasBranchMerge', () => {
  it('is on for the desktop editor, which now has the screen', () => {
    expect(EDITOR_CAPABILITIES.hasBranchMerge).toBe(true)
  })

  it('is on for the web, which has the routed page', () => {
    expect(WEB_CAPABILITIES.hasBranchMerge).toBe(true)
  })

  it('is a flag of its own, not an alias for version control', () => {
    // Separate keys: a build without a merge screen can say so without giving up branches.
    expect(Object.keys(EDITOR_CAPABILITIES)).toContain('hasBranchMerge')
    expect(Object.keys(EDITOR_CAPABILITIES)).toContain('hasVersionControl')
  })
})
