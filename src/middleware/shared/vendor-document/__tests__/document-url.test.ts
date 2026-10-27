import { describe, expect, it } from '@jest/globals'

import { buildVendorDocumentUrl, encodeVendorDocumentPath } from '../document-url'

describe('buildVendorDocumentUrl', () => {
  it('builds a vpp-doc URL with the package id lowercased', () => {
    expect(buildVendorDocumentUrl('com.Weidmuller.uControl', 'configurator/index.html')).toBe(
      'vpp-doc://com.weidmuller.ucontrol/configurator/index.html',
    )
  })

  it('percent-encodes each path segment', () => {
    expect(buildVendorDocumentUrl('pkg', 'a b/c#d.js')).toBe('vpp-doc://pkg/a%20b/c%23d.js')
  })

  it.each(['', '.hidden', '../pkg', 'a/b', 'a b'])('returns null for package id %j', (id) => {
    expect(buildVendorDocumentUrl(id, 'index.html')).toBeNull()
  })

  it.each(['', '/', '../index.html', 'a/./b.js', 'a/../../b.js'])('returns null for path %j', (relPath) => {
    expect(buildVendorDocumentUrl('pkg', relPath)).toBeNull()
  })
})

describe('encodeVendorDocumentPath', () => {
  it('percent-encodes each segment and drops empty ones', () => {
    expect(encodeVendorDocumentPath('/configurator//a b/c#d.js')).toBe('configurator/a%20b/c%23d.js')
  })

  it.each(['', '/', '../index.html', 'a/./b.js', 'a/../../b.js'])('returns null for path %j', (relPath) => {
    expect(encodeVendorDocumentPath(relPath)).toBeNull()
  })
})
