/**
 * The provider sign-in window, with Electron stubbed.
 *
 * The URL matcher decides between two very different fates for a link: intercepted
 * into a window this process owns, or handed to the system browser. Wrong in one
 * direction and provider tokens land in a jar we cannot read; wrong in the other and
 * ordinary links get swallowed into a login window.
 *
 * The window itself renders a third party's pages on a session we then read cookies
 * from, so what it may load, what it may open and whose cookies count are the other
 * half of what is worth protecting here.
 */

/**
 * `oauth-window` imports `electron` at module scope, and CI installs with
 * `--ignore-scripts` — so Electron's postinstall never runs and `require('electron')`
 * throws before a single test can start. The stub records every window it is asked to
 * create so the tests can drive its events. Only identifiers prefixed `mock` may be
 * referenced from a hoisted factory.
 */
jest.mock('electron', () => {
  const mockWindows: unknown[] = []
  const mockCookies: { get: jest.Mock } = { get: jest.fn(async () => []) }

  class MockBrowserWindow {
    static created = mockWindows
    handlers: Record<string, (...args: unknown[]) => void> = {}
    windowHandlers: Record<string, (...args: unknown[]) => void> = {}
    openHandler: (() => { action: string }) | null = null
    destroyed = false
    loadedUrl: string | null = null
    webContents = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        this.handlers[event] = handler
      },
      setWindowOpenHandler: (handler: () => { action: string }) => {
        this.openHandler = handler
      },
    }

    constructor() {
      mockWindows.push(this)
    }

    setMenuBarVisibility(): void {}
    on(event: string, handler: (...args: unknown[]) => void): void {
      this.windowHandlers[event] = handler
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    destroy(): void {
      this.destroyed = true
    }
    loadURL(url: string): Promise<void> {
      this.loadedUrl = url

      return Promise.resolve()
    }
  }

  return {
    BrowserWindow: MockBrowserWindow,
    session: {
      fromPartition: () => ({
        setUserAgent: () => undefined,
        cookies: mockCookies,
        clearStorageData: () => Promise.resolve(),
      }),
    },
    __cookies: mockCookies,
  }
})

import { cookieBelongsToEdge, edgeOAuthProviderFromUrl, isAllowedOAuthNavigation, runOAuthFlow } from '../oauth-window'

/** The stubbed window, as the tests see it. */
interface FakeWindow {
  handlers: Record<string, (...args: unknown[]) => void>
  windowHandlers: Record<string, (...args: unknown[]) => void>
  openHandler: (() => { action: string }) | null
  destroyed: boolean
  loadedUrl: string | null
}

interface ElectronStub {
  BrowserWindow: { created: FakeWindow[] }
  __cookies: { get: jest.Mock }
}

const electron = jest.requireMock<ElectronStub>('electron')

function lastWindow(): FakeWindow {
  const created = electron.BrowserWindow.created
  const win = created[created.length - 1]

  if (!win) {
    throw new Error('no window was created')
  }

  return win
}

/** A `will-navigate` event whose `preventDefault` can be observed. */
function navigation(): { preventDefault: jest.Mock } {
  return { preventDefault: jest.fn() }
}

const originalApiUrl = process.env.OPENPLC_EDGE_API_URL
const originalWebUrl = process.env.OPENPLC_EDGE_WEB_URL

beforeEach(() => {
  jest.clearAllMocks()
  electron.BrowserWindow.created.length = 0
  electron.__cookies.get.mockResolvedValue([])
  delete process.env.OPENPLC_EDGE_API_URL
  delete process.env.OPENPLC_EDGE_WEB_URL
})

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.OPENPLC_EDGE_API_URL
  else process.env.OPENPLC_EDGE_API_URL = originalApiUrl
  if (originalWebUrl === undefined) delete process.env.OPENPLC_EDGE_WEB_URL
  else process.env.OPENPLC_EDGE_WEB_URL = originalWebUrl
})

describe('edgeOAuthProviderFromUrl', () => {
  it.each([
    ['https://api.autonomylogic.com/auth/google?state=editor', 'google'],
    ['https://api.autonomylogic.com/auth/microsoft', 'microsoft'],
    ['https://api.autonomylogic.com/auth/apple', 'apple'],
  ])('recognises %s', (url, expected) => {
    expect(edgeOAuthProviderFromUrl(url)).toBe(expected)
  })

  it('matches on path regardless of origin', () => {
    // Load-bearing: the shared dialog builds its links from the Edge WEB origin, because
    // that is the only Edge URL a renderer bundle knows, while the real endpoint is on
    // the API origin that only the main process is configured with. Matching on origin
    // would force the two to agree about something only one of them can know.
    expect(edgeOAuthProviderFromUrl('https://edge.autonomylogic.com/auth/google?state=x')).toBe('google')
    expect(edgeOAuthProviderFromUrl('http://localhost:5173/auth/apple')).toBe('apple')
  })

  it('tolerates a trailing slash', () => {
    expect(edgeOAuthProviderFromUrl('https://api.autonomylogic.com/auth/google/')).toBe('google')
  })

  it.each([
    // Edge's own sign-in page, not a provider endpoint.
    'https://edge.autonomylogic.com/signin',
    // A provider name in the wrong position.
    'https://edge.autonomylogic.com/projects/auth/google/extra',
    // These must keep going to the system browser.
    'https://autonomylogic.com/docs',
    'https://edge.autonomylogic.com/buy',
    // A provider Edge does not offer must not be intercepted on the strength of the
    // prefix.
    'https://api.autonomylogic.com/auth/facebook',
    // Casing is not normalised: the value would go into a route path verbatim.
    'https://api.autonomylogic.com/auth/Google',
    'not a url',
    '',
  ])('leaves %s to the system browser', (url) => {
    expect(edgeOAuthProviderFromUrl(url)).toBeNull()
  })
})

describe('isAllowedOAuthNavigation', () => {
  it.each([
    'https://api.autonomylogic.com/auth/google/callback?code=x',
    'https://edge.autonomylogic.com/unauthorized',
    'https://accounts.google.com/o/oauth2/v2/auth',
    // A subdomain of a provider host is still the provider.
    'https://consent.accounts.google.com/x',
  ])('lets a google flow reach %s', (url) => {
    expect(isAllowedOAuthNavigation(url, 'google')).toBe(true)
  })

  it('lets each provider reach its own hosts and not the others', () => {
    expect(isAllowedOAuthNavigation('https://login.microsoftonline.com/common', 'microsoft')).toBe(true)
    expect(isAllowedOAuthNavigation('https://login.live.com/x', 'microsoft')).toBe(true)
    expect(isAllowedOAuthNavigation('https://appleid.apple.com/auth/authorize', 'apple')).toBe(true)

    expect(isAllowedOAuthNavigation('https://accounts.google.com/x', 'microsoft')).toBe(false)
    expect(isAllowedOAuthNavigation('https://appleid.apple.com/x', 'google')).toBe(false)
  })

  it.each([
    'https://evil.example/phish',
    // A lookalike that merely contains the host.
    'https://accounts.google.com.evil.example/',
    'https://api.autonomylogic.com.evil.example/',
    // A subdomain of Edge is not Edge.
    'https://static.api.autonomylogic.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedOAuthNavigation(url, 'google')).toBe(false)
  })

  it('follows the configured Edge hosts, including a local backend over http', () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://localhost:3333'
    process.env.OPENPLC_EDGE_WEB_URL = 'http://localhost:5173'

    expect(isAllowedOAuthNavigation('http://localhost:3333/auth/google/callback', 'google')).toBe(true)
    expect(isAllowedOAuthNavigation('http://localhost:5173/unauthorized', 'google')).toBe(true)
    // The production hosts are no longer the configured ones.
    expect(isAllowedOAuthNavigation('https://api.autonomylogic.com/x', 'google')).toBe(false)
  })
})

describe('cookieBelongsToEdge', () => {
  it.each(['.autonomylogic.com', 'autonomylogic.com', 'api.autonomylogic.com', '.api.autonomylogic.com'])(
    'accepts a cookie scoped to %s for the API host',
    (domain) => {
      expect(cookieBelongsToEdge(domain, 'api.autonomylogic.com')).toBe(true)
    },
  )

  it.each(['evil.example', '.evil.example', 'autonomylogic.com.evil.example', 'accounts.google.com', undefined])(
    'rejects a cookie scoped to %s',
    (domain) => {
      expect(cookieBelongsToEdge(domain, 'api.autonomylogic.com')).toBe(false)
    },
  )

  it('matches a local backend on localhost', () => {
    expect(cookieBelongsToEdge('localhost', 'localhost')).toBe(true)
  })
})

describe('runOAuthFlow', () => {
  it('refuses a cleartext API URL before a window exists', async () => {
    // The same guard the HTTP client applies. The callback sets the session cookies on
    // this origin; over http to a remote host they would be readable on the path.
    process.env.OPENPLC_EDGE_API_URL = 'http://api.example.com'

    const result = await runOAuthFlow('google')

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toContain('https')
    expect(electron.BrowserWindow.created).toHaveLength(0)
  })

  it('starts at the provider route on the API origin, and denies every pop-up', async () => {
    const flow = runOAuthFlow('google')
    const win = lastWindow()

    expect(win.loadedUrl).toBe('https://api.autonomylogic.com/auth/google?state=editor')
    expect(win.openHandler?.()).toEqual({ action: 'deny' })

    win.windowHandlers.closed()
    await expect(flow).resolves.toEqual({ status: 'cancelled' })
  })

  it('blocks a navigation off the allowlist and lets the provider through', async () => {
    const flow = runOAuthFlow('google')
    const win = lastWindow()

    const blocked = navigation()
    win.handlers['will-navigate'](blocked, 'https://evil.example/phish')
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)

    const allowed = navigation()
    win.handlers['will-navigate'](allowed, 'https://accounts.google.com/signin')
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    win.windowHandlers.closed()
    await expect(flow).resolves.toEqual({ status: 'cancelled' })
  })

  it('reads the failed-flow redirect as declined', async () => {
    const flow = runOAuthFlow('microsoft')
    const win = lastWindow()

    win.handlers['will-navigate'](navigation(), 'https://edge.autonomylogic.com/unauthorized?reason=oauth_failed')

    await expect(flow).resolves.toEqual({ status: 'failed', reason: 'provider-declined' })
    expect(win.destroyed).toBe(true)
  })

  it('adopts the session only from cookies scoped to Edge', async () => {
    // A provider page, or anything on the way through, must not be able to plant a
    // pair of cookies named like Edge's and have this process adopt them.
    electron.__cookies.get.mockResolvedValueOnce([
      { name: 'accessToken', value: 'planted-a', domain: 'evil.example' },
      { name: 'refreshToken', value: 'planted-r', domain: '.evil.example' },
    ])

    const flow = runOAuthFlow('apple')
    const win = lastWindow()

    win.handlers['did-navigate']()
    await Promise.resolve()
    await Promise.resolve()
    expect(win.destroyed).toBe(false)

    electron.__cookies.get.mockResolvedValueOnce([
      { name: 'accessToken', value: 'a1', domain: '.autonomylogic.com' },
      { name: 'refreshToken', value: 'r1', domain: '.autonomylogic.com' },
    ])
    win.handlers['did-finish-load']()

    await expect(flow).resolves.toEqual({ status: 'tokens', accessToken: 'a1', refreshToken: 'r1' })
    // Scoped to the Edge origin on the way in, too.
    expect(electron.__cookies.get).toHaveBeenLastCalledWith({
      url: 'https://api.autonomylogic.com/auth/apple?state=editor',
    })
  })

  it('waits for both cookies rather than adopting half a session', async () => {
    electron.__cookies.get.mockResolvedValueOnce([{ name: 'accessToken', value: 'a1', domain: '.autonomylogic.com' }])

    const flow = runOAuthFlow('google')
    const win = lastWindow()

    win.handlers['did-redirect-navigation']()
    await Promise.resolve()
    await Promise.resolve()
    expect(win.destroyed).toBe(false)

    win.windowHandlers.closed()
    await expect(flow).resolves.toEqual({ status: 'cancelled' })
  })
})
