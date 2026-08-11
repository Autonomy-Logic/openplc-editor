import http from 'http'
import https from 'https'

import { defaultPortFor, httpModuleFor } from '../http-module'

describe('httpModuleFor', () => {
  it('returns the http module for an http: URL', () => {
    expect(httpModuleFor('http://localhost:3333/vpp-licenses/activate')).toBe(http)
  })

  it('returns the https module for an https: URL', () => {
    expect(httpModuleFor('https://api.autonomylogic.com/vpp-licenses/activate')).toBe(https)
  })

  it('accepts an already-parsed URL', () => {
    expect(httpModuleFor(new URL('http://127.0.0.1:3333/x'))).toBe(http)
  })

  // An unparseable or exotic URL must never silently downgrade to plaintext.
  it('falls back to https for an unparseable URL', () => {
    expect(httpModuleFor('not a url')).toBe(https)
  })

  it('falls back to https for a non-http(s) scheme', () => {
    expect(httpModuleFor('ftp://example.com/x')).toBe(https)
  })
})

describe('defaultPortFor', () => {
  it('is 80 for http and 443 for https', () => {
    expect(defaultPortFor('http://localhost/x')).toBe(80)
    expect(defaultPortFor('https://localhost/x')).toBe(443)
  })

  it('falls back to 443 when the URL cannot be parsed', () => {
    expect(defaultPortFor('not a url')).toBe(443)
  })
})
