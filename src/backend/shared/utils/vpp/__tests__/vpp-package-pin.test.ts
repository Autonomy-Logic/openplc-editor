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

  it('reports a version change', () => {
    const drift = resolveVppPinDrift(PIN, { ...PIN, version: '0.4.0', contentHash: 'sha256:bbbb' })

    expect(drift.kind).toBe('version-changed')
    expect(describeVppPinDrift(PIN, { ...PIN, version: '0.4.0', contentHash: 'sha256:bbbb' })).toContain('0.4.0')
  })

  it('catches a republish under the same version, which a version check would miss', () => {
    const republished = { ...PIN, contentHash: 'sha256:cccc' }

    const drift = resolveVppPinDrift(PIN, republished)

    expect(drift.kind).toBe('content-changed')
    expect(describeVppPinDrift(PIN, republished)).toContain('republished')
  })

  it('reports a different package entirely', () => {
    const other = { packageId: 'com.other.vendor', version: '1.0.0', contentHash: 'sha256:dddd' }

    const drift = resolveVppPinDrift(PIN, other)

    expect(drift.kind).toBe('package-replaced')
    expect(describeVppPinDrift(PIN, other)).toContain('com.other.vendor')
  })
})
