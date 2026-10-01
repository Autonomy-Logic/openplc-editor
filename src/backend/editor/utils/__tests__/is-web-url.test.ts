import { describe, expect, it } from '@jest/globals'

import { isWebUrl } from '../is-web-url'

describe('isWebUrl', () => {
  it('accepts the two schemes the shell is allowed to open', () => {
    expect(isWebUrl('https://autonomylogic.com/buy')).toBe(true)
    expect(isWebUrl('http://localhost:3333/docs')).toBe(true)
  })

  it('refuses the schemes that turn an external link into code or a local file', () => {
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isWebUrl('vbscript:msgbox(1)')).toBe(false)
  })

  it('refuses what is not a URL at all', () => {
    expect(isWebUrl('')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})
