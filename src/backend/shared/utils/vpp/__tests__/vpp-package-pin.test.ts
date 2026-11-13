import { describe, expect, it } from '@jest/globals'

import { describeMissingVppPackage } from '../vpp-package-pin'

const PIN = {
  packageId: 'com.synergy-logic.slm-rp4',
  version: '0.3.1',
  contentHash: 'sha256:aaaa',
}

describe('describeMissingVppPackage', () => {
  it('says nothing when the installed package is the pinned one', () => {
    expect(describeMissingVppPackage(PIN, { ...PIN })).toBeNull()
  })

  it('says nothing for a project that predates pinning', () => {
    expect(describeMissingVppPackage(undefined, { ...PIN })).toBeNull()
    expect(describeMissingVppPackage(undefined, null)).toBeNull()
  })

  it('names the package when it is pinned but not installed', () => {
    expect(describeMissingVppPackage(PIN, null)).toContain('com.synergy-logic.slm-rp4 0.3.1')
  })

  it('says nothing for a version change', () => {
    expect(describeMissingVppPackage(PIN, { ...PIN, version: '0.4.0', contentHash: 'sha256:bbbb' })).toBeNull()
  })

  it('says nothing for a republish under the same version', () => {
    expect(describeMissingVppPackage(PIN, { ...PIN, contentHash: 'sha256:cccc' })).toBeNull()
  })

  it('says nothing for a different package', () => {
    const other = { packageId: 'com.other.vendor', version: '1.0.0', contentHash: 'sha256:dddd' }
    expect(describeMissingVppPackage(PIN, other)).toBeNull()
  })
})
