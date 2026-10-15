/**
 * @jest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createVendorDocumentHandler,
  leavesVendorDocument,
  type RegisteredPackage,
  VENDOR_DOCUMENT_CSP,
} from '../serve'

describe('createVendorDocumentHandler', () => {
  let root: string
  let packages: RegisteredPackage[]

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'vpp-doc-'))
    const pkgDir = path.join(root, 'packages', 'com.vendor.Pkg')
    mkdirSync(path.join(pkgDir, 'configurator', 'fonts'), { recursive: true })
    writeFileSync(path.join(pkgDir, 'configurator', 'index.html'), '<!doctype html>')
    writeFileSync(path.join(pkgDir, 'configurator', 'index.js'), 'void 0')
    writeFileSync(path.join(pkgDir, 'configurator', 'style.css'), 'a{}')
    writeFileSync(path.join(pkgDir, 'configurator', 'icon.svg'), '<svg/>')
    writeFileSync(path.join(pkgDir, 'configurator', 'data.json'), '{}')
    writeFileSync(path.join(pkgDir, 'configurator', 'image.png'), 'png')
    writeFileSync(path.join(pkgDir, 'configurator', 'fonts', 'a.woff'), 'woff')
    writeFileSync(path.join(pkgDir, 'configurator', 'fonts', 'a.woff2'), 'woff2')
    writeFileSync(path.join(pkgDir, 'configurator', 'blob.bin'), 'bin')
    writeFileSync(path.join(pkgDir, 'configurator', 'space name.js'), 'void 1')
    writeFileSync(path.join(root, 'packages', 'secret.txt'), 'secret')
    symlinkSync(path.join(root, 'packages', 'secret.txt'), path.join(pkgDir, 'configurator', 'escape.js'))

    const otherDir = path.join(root, 'packages', 'other')
    mkdirSync(otherDir)
    writeFileSync(path.join(otherDir, 'index.html'), 'other')

    packages = [
      { packageId: 'com.vendor.Pkg', path: pkgDir },
      { packageId: 'other', path: otherDir },
    ]
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const handler = () => createVendorDocumentHandler({ listPackages: () => packages })
  const get = (url: string, method = 'GET') => handler()(new Request(url, { method }))

  it('serves a package file with CSP, nosniff and its MIME type', async () => {
    const res = await get('vpp-doc://com.vendor.pkg/configurator/index.html')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<!doctype html>')
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Content-Security-Policy')).toBe(VENDOR_DOCUMENT_CSP)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it.each([
    ['index.js', 'text/javascript; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
    ['icon.svg', 'image/svg+xml'],
    ['data.json', 'application/json; charset=utf-8'],
    ['image.png', 'image/png'],
    ['fonts/a.woff', 'font/woff'],
    ['fonts/a.woff2', 'font/woff2'],
    ['blob.bin', 'application/octet-stream'],
  ])('maps %s to %s', async (file, mime) => {
    const res = await get(`vpp-doc://com.vendor.pkg/configurator/${file}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(mime)
  })

  it('matches the package id without case', async () => {
    expect((await get('vpp-doc://COM.VENDOR.PKG/configurator/index.js')).status).toBe(200)
  })

  it('decodes percent-encoded segments', async () => {
    const res = await get('vpp-doc://com.vendor.pkg/configurator/space%20name.js')
    expect(await res.text()).toBe('void 1')
  })

  it('answers /esbuild with 404', async () => {
    expect((await get('vpp-doc://com.vendor.pkg/esbuild')).status).toBe(404)
  })

  it('answers 404 for an unregistered package', async () => {
    expect((await get('vpp-doc://unknown/index.html')).status).toBe(404)
  })

  it('refuses a host matching two registered ids that differ only by case', async () => {
    const ambiguous = createVendorDocumentHandler({
      listPackages: () => [...packages, { packageId: 'OTHER', path: packages[1].path }],
    })
    expect((await ambiguous(new Request('vpp-doc://other/index.html'))).status).toBe(404)
  })

  it.each([
    'vpp-doc://com.vendor.pkg/configurator/%2e%2e/%2e%2e/secret.txt',
    'vpp-doc://com.vendor.pkg/configurator%2f..%2f..%2fsecret.txt',
    'vpp-doc://com.vendor.pkg/..%5c..%5csecret.txt',
    'vpp-doc://com.vendor.pkg/%E0%A4%A',
  ])('answers 404 for traversal attempt %s', async (url) => {
    expect((await get(url)).status).toBe(404)
  })

  it('does not serve a file reached through a symlink leaving the package', async () => {
    expect((await get('vpp-doc://com.vendor.pkg/configurator/escape.js')).status).toBe(404)
  })

  it('never lists a directory', async () => {
    expect((await get('vpp-doc://com.vendor.pkg/configurator')).status).toBe(404)
    expect((await get('vpp-doc://com.vendor.pkg/')).status).toBe(404)
  })

  it('answers 404 for a missing file', async () => {
    expect((await get('vpp-doc://com.vendor.pkg/configurator/missing.js')).status).toBe(404)
  })

  it('refuses methods other than GET, still under the CSP', async () => {
    const res = await get('vpp-doc://com.vendor.pkg/configurator/index.html', 'POST')
    expect(res.status).toBe(405)
    expect(res.headers.get('Content-Security-Policy')).toBe(VENDOR_DOCUMENT_CSP)
  })

  it('forbids form submissions anywhere', () => {
    expect(VENDOR_DOCUMENT_CSP).toContain("form-action 'none'")
  })
})

describe('leavesVendorDocument', () => {
  it.each([['https://example.com/?d=1'], ['vpp-doc://com.other.pkg/index.html'], ['file:///etc/hosts'], ['not a url']])(
    'blocks a package document navigating to %s',
    (to) => {
      expect(leavesVendorDocument('vpp-doc://com.vendor.pkg/configurator/index.html', to)).toBe(true)
    },
  )

  it('lets a package document navigate inside its own package', () => {
    expect(
      leavesVendorDocument('vpp-doc://com.vendor.pkg/configurator/index.html', 'vpp-doc://com.vendor.pkg/other.html'),
    ).toBe(false)
  })

  it.each([[undefined], ['file:///app/index.html'], ['https://example.com/']])(
    'leaves frames that do not show a package document alone (%s)',
    (from) => {
      expect(leavesVendorDocument(from, 'https://example.com/next')).toBe(false)
    },
  )
})
