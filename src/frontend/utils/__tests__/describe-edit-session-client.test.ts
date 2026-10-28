import { describe, expect, it } from '@jest/globals'

import { describeEditSessionClient } from '../describe-edit-session-client'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ELECTRON_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenPLC-Editor/4.0.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36'

describe('describeEditSessionClient', () => {
  it('names browsers so two tabs can be told apart', () => {
    expect(describeEditSessionClient(false, CHROME_MAC)).toEqual({ kind: 'web', label: 'Chrome on macOS' })
    expect(describeEditSessionClient(false, EDGE_WIN)).toEqual({ kind: 'web', label: 'Edge on Windows' })
    expect(describeEditSessionClient(false, FIREFOX_LINUX)).toEqual({ kind: 'web', label: 'Firefox on Linux' })
    expect(describeEditSessionClient(false, SAFARI_MAC)).toEqual({ kind: 'web', label: 'Safari on macOS' })
  })

  it('names the desktop editor as the editor, not as the Chromium inside it', () => {
    expect(describeEditSessionClient(true, ELECTRON_WIN)).toEqual({
      kind: 'desktop',
      label: 'OpenPLC Editor on Windows',
    })
  })

  it('still gives a label when the user agent says nothing useful', () => {
    expect(describeEditSessionClient(false, '')).toEqual({ kind: 'web', label: 'Web browser' })
    expect(describeEditSessionClient(true, '')).toEqual({ kind: 'desktop', label: 'OpenPLC Editor' })
  })
})
