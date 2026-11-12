import { describe, expect, it } from '@jest/globals'

import { describeVppPinDrift, resolveVppPinDrift } from '../vpp-package-pin'

const PIN = {
  packageId: 'com.synergy-logic.slm-rp4',
  version: '0.3.1',
  contentHash: 'sha256:aaaa',
}

describe('resolveVppPinDrift', () => {
  it('reports nothing when the installed package is the pinned one', () => {
    expect(resolveVppPinDrift(PIN, { ...PIN })).toEqual({ kind: 'none' })
    expect(describeVppPinDrift(PIN, { ...PIN })).toBeNull()
  })

  it('says nothing for a project that predates pinning', () => {
    // An older project has no pin. Warning there would put a banner on every
    // project that has never been through a pinning editor.
    expect(resolveVppPinDrift(undefined, { ...PIN })).toEqual({ kind: 'unpinned' })
    expect(describeVppPinDrift(undefined, { ...PIN })).toBeNull()
  })

  it('names the package when it is pinned but not installed', () => {
    const drift = resolveVppPinDrift(PIN, null)

    expect(drift.kind).toBe('package-missing')
    expect(describeVppPinDrift(PIN, null)).toContain('com.synergy-logic.slm-rp4 0.3.1')
  })

  it('reports a version change as moved, with no warning', () => {
    const newer = { ...PIN, version: '0.4.0', contentHash: 'sha256:bbbb' }

    expect(resolveVppPinDrift(PIN, newer)).toEqual({ kind: 'moved' })
    expect(describeVppPinDrift(PIN, newer)).toBeNull()
  })

  it('reports a republish under the same version as moved, with no warning', () => {
    const republished = { ...PIN, contentHash: 'sha256:cccc' }

    expect(resolveVppPinDrift(PIN, republished)).toEqual({ kind: 'moved' })
    expect(describeVppPinDrift(PIN, republished)).toBeNull()
  })

  it('reports a different package as moved, with no warning', () => {
    const other = { packageId: 'com.other.vendor', version: '1.0.0', contentHash: 'sha256:dddd' }

    expect(resolveVppPinDrift(PIN, other)).toEqual({ kind: 'moved' })
    expect(describeVppPinDrift(PIN, other)).toBeNull()
  })
})
