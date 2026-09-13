/**
 * `hasBranchMerge`, and why it is still a separate flag.
 *
 * It began as the gate that hid the merge entry on the desktop, which had version control
 * and no merge screen — the entry there reloaded the renderer and closed the open project.
 * The screen now exists on both, so both are on. The flag stays because the fact it
 * describes is still its own: a platform can have version control and no merge screen, and
 * collapsing the two would take away the way to say so.
 */

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
    // Both true today. The point is that they are separate keys, so a build without a
    // merge screen can say so without giving up branches.
    expect(Object.keys(EDITOR_CAPABILITIES)).toContain('hasBranchMerge')
    expect(Object.keys(EDITOR_CAPABILITIES)).toContain('hasVersionControl')
  })
})
