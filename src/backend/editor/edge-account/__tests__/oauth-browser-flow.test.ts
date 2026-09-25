/**
 * The provider sign-in flow through the system browser, with Electron's `shell` stubbed
 * and the browser played by a plain HTTP client against the real loopback listener.
 */

// `oauth-browser-flow` imports `electron` at module scope, and CI installs with
// `--ignore-scripts`, so `require('electron')` would throw before a test can start.
// Only identifiers prefixed `mock` may be referenced from a hoisted factory.
jest.mock('electron', () => {
  const mockOpenExternal = jest.fn(() => Promise.resolve())

  return { shell: { openExternal: mockOpenExternal } }
})

import { request as httpRequest } from 'http'

import {
  CALLBACK_PATH,
  DONE_PATH,
  edgeOAuthProviderFromUrl,
  loopbackReturnUrl,
  providerStartUrl,
  readCallback,
  renderDonePage,
  runOAuthFlow,
} from '../oauth-browser-flow'

interface ElectronStub {
  shell: { openExternal: jest.Mock<Promise<void>, [string]> }
}

const electron = jest.requireMock<ElectronStub>('electron')

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** The browser's part: one GET, no redirect following, so each hop can be asserted. */
function browserGet(url: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })

    req.on('error', reject)
    req.end()
  })
}

/**
 * Waits for the flow to hand the browser its start URL, and returns the return address
 * inside it. `index` picks which browser opening of the test, in order.
 */
async function startedFlow(index = 0): Promise<{ startUrl: URL; returnUrl: URL }> {
  for (let attempt = 0; attempt < 50 && electron.shell.openExternal.mock.calls.length <= index; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  const [startUrl] = electron.shell.openExternal.mock.calls[index] ?? []

  if (!startUrl) {
    throw new Error('the browser was never opened')
  }

  const parsed = new URL(startUrl)
  const state = parsed.searchParams.get('state')

  if (!state) {
    throw new Error('the start URL carries no return address')
  }

  return { startUrl: parsed, returnUrl: new URL(state) }
}

function withParams(url: URL, params: Record<string, string>): string {
  const next = new URL(url.toString())

  for (const [key, value] of Object.entries(params)) {
    next.searchParams.set(key, value)
  }

  return next.toString()
}

const originalApiUrl = process.env.OPENPLC_EDGE_API_URL

beforeEach(() => {
  jest.clearAllMocks()
  electron.shell.openExternal.mockImplementation(() => Promise.resolve())
  delete process.env.OPENPLC_EDGE_API_URL
})

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.OPENPLC_EDGE_API_URL
  else process.env.OPENPLC_EDGE_API_URL = originalApiUrl
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
    // The renderer only knows the Edge WEB origin; the real endpoint is on the API origin.
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
    // These are plain external links.
    'https://autonomylogic.com/docs',
    'https://edge.autonomylogic.com/buy',
    // A provider Edge does not offer must not be intercepted on the strength of the
    // prefix.
    'https://api.autonomylogic.com/auth/facebook',
    // Casing is not normalised: the value would go into a route path verbatim.
    'https://api.autonomylogic.com/auth/Google',
    'not a url',
    '',
  ])('leaves %s alone', (url) => {
    expect(edgeOAuthProviderFromUrl(url)).toBeNull()
  })
})

describe('providerStartUrl', () => {
  it('points at the provider route on the API origin with the return address as state', () => {
    const url = new URL(providerStartUrl('google', 'http://127.0.0.1:4242/callback?attempt=abc'))

    expect(url.origin).toBe('https://api.autonomylogic.com')
    expect(url.pathname).toBe('/auth/google')
    expect(url.searchParams.get('state')).toBe('http://127.0.0.1:4242/callback?attempt=abc')
  })

  it('follows the configured API, including a local backend over http', () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://localhost:3333/'

    expect(providerStartUrl('apple', 'http://127.0.0.1:1/callback?attempt=a')).toMatch(
      /^http:\/\/localhost:3333\/auth\/apple\?state=/,
    )
  })

  it('refuses a cleartext API on a remote host', () => {
    // The same guard the HTTP client applies: the callback issues session tokens on this
    // origin, and over http to a remote host they would be readable on the path.
    process.env.OPENPLC_EDGE_API_URL = 'http://api.example.com'

    expect(() => providerStartUrl('google', 'http://127.0.0.1:1/callback?attempt=a')).toThrow(/https/)
  })
})

describe('loopbackReturnUrl', () => {
  it('names the loopback IP literal, never localhost', () => {
    // A hosts-file entry can point `localhost` anywhere; the literal cannot be redirected.
    expect(loopbackReturnUrl(5050, 'abc')).toBe('http://127.0.0.1:5050/callback?attempt=abc')
  })
})

describe('readCallback', () => {
  const attempt = 'a1b2'

  it('reads a token pair addressed to this attempt', () => {
    expect(readCallback(`${CALLBACK_PATH}?attempt=${attempt}&access_token=A&refresh_token=R`, attempt)).toEqual({
      kind: 'tokens',
      accessToken: 'A',
      refreshToken: 'R',
    })
  })

  it('reads the API reporting a failed provider flow as declined', () => {
    expect(readCallback(`${CALLBACK_PATH}?attempt=${attempt}&error=oauth_failed`, attempt)).toEqual({
      kind: 'declined',
    })
  })

  it.each([
    // Half a session is no session.
    `${CALLBACK_PATH}?attempt=${attempt}&access_token=A`,
    `${CALLBACK_PATH}?attempt=${attempt}&refresh_token=R`,
    `${CALLBACK_PATH}?attempt=${attempt}`,
    `${CALLBACK_PATH}?attempt=${attempt}&access_token=&refresh_token=R`,
  ])('treats %s as malformed rather than adopting it', (url) => {
    expect(readCallback(url, attempt)).toEqual({ kind: 'malformed' })
  })

  it.each([
    // Another attempt's secret: a token pair planted by something else on this machine.
    `${CALLBACK_PATH}?attempt=other&access_token=A&refresh_token=R`,
    `${CALLBACK_PATH}?access_token=A&refresh_token=R`,
    `/elsewhere?attempt=${attempt}&access_token=A&refresh_token=R`,
    '/',
    '/favicon.ico',
  ])('ignores %s as not this flow’s callback', (url) => {
    expect(readCallback(url, attempt)).toEqual({ kind: 'foreign' })
  })
})

describe('renderDonePage', () => {
  it('says it worked, and says so without a single external resource', () => {
    const page = renderDonePage('ok')

    expect(page).toContain('You are signed in')
    expect(page).not.toMatch(/src=|href=|@import|url\(/)
  })

  it('says it did not, and points back at the editor', () => {
    expect(renderDonePage('failed')).toContain('That sign-in did not finish')
    expect(renderDonePage('failed')).toContain('OpenPLC Editor')
  })
})

describe('runOAuthFlow', () => {
  it('opens the system browser at the provider route, with a loopback return address of its own', async () => {
    const flow = runOAuthFlow('google')
    const { startUrl, returnUrl } = await startedFlow()

    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1)
    expect(startUrl.origin).toBe('https://api.autonomylogic.com')
    expect(startUrl.pathname).toBe('/auth/google')

    expect(returnUrl.hostname).toBe('127.0.0.1')
    expect(returnUrl.pathname).toBe(CALLBACK_PATH)
    expect(returnUrl.searchParams.get('attempt')).toMatch(/^[0-9a-f]{32}$/)

    // A second click starts over: the earlier flow is retired and its listener gone.
    const next = runOAuthFlow('microsoft')
    await expect(flow).resolves.toEqual({ status: 'cancelled' })
    await expect(browserGet(returnUrl.toString())).rejects.toMatchObject({ code: 'ECONNREFUSED' })

    const { returnUrl: nextReturnUrl } = await startedFlow(1)
    await browserGet(withParams(nextReturnUrl, { access_token: 'a1', refresh_token: 'r1' }))
    await expect(next).resolves.toMatchObject({ status: 'tokens' })
    await browserGet(new URL(`${DONE_PATH}?outcome=ok`, nextReturnUrl).toString())
  })

  it('adopts the token pair the browser brings back, and moves the browser off the token URL', async () => {
    const flow = runOAuthFlow('google')
    const { returnUrl } = await startedFlow()

    const callback = await browserGet(withParams(returnUrl, { access_token: 'a1', refresh_token: 'r1' }))

    // A redirect, so history and the address bar keep `/done` and not the tokens.
    expect(callback.status).toBe(303)
    expect(callback.headers.location).toBe(`${DONE_PATH}?outcome=ok`)
    expect(callback.headers['cache-control']).toBe('no-store')
    expect(callback.headers['referrer-policy']).toBe('no-referrer')

    await expect(flow).resolves.toEqual({ status: 'tokens', accessToken: 'a1', refreshToken: 'r1' })

    // The listener stays up for exactly that page.
    const done = await browserGet(new URL(`${DONE_PATH}?outcome=ok`, returnUrl).toString())
    expect(done.status).toBe(200)
    expect(done.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(done.headers['content-security-policy']).toContain("default-src 'none'")
    expect(done.body).toContain('You are signed in')

    // And not a moment longer.
    await expect(browserGet(new URL('/', returnUrl).toString())).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('reads the API reporting a failed provider flow as declined', async () => {
    const flow = runOAuthFlow('microsoft')
    const { returnUrl } = await startedFlow()

    const callback = await browserGet(withParams(returnUrl, { error: 'oauth_failed' }))

    expect(callback.status).toBe(303)
    expect(callback.headers.location).toBe(`${DONE_PATH}?outcome=failed`)
    await expect(flow).resolves.toEqual({ status: 'failed', reason: 'provider-declined' })

    const done = await browserGet(new URL(`${DONE_PATH}?outcome=failed`, returnUrl).toString())
    expect(done.body).toContain('That sign-in did not finish')
  })

  it('does not adopt half a session', async () => {
    const flow = runOAuthFlow('apple')
    const { returnUrl } = await startedFlow()

    await browserGet(withParams(returnUrl, { access_token: 'a1' }))

    await expect(flow).resolves.toEqual({ status: 'failed', reason: 'malformed-callback' })
    await browserGet(new URL(`${DONE_PATH}?outcome=failed`, returnUrl).toString())
  })

  it('ignores a callback that does not carry this attempt’s secret, and keeps waiting', async () => {
    const flow = runOAuthFlow('google')
    const { returnUrl } = await startedFlow()

    // Something else on this machine planting a token pair on the listener.
    const planted = new URL(returnUrl.toString())
    planted.searchParams.set('attempt', 'not-this-one')
    planted.searchParams.set('access_token', 'planted-a')
    planted.searchParams.set('refresh_token', 'planted-r')

    const reply = await browserGet(planted.toString())
    expect(reply.status).toBe(404)

    const stray = await browserGet(new URL('/favicon.ico', returnUrl).toString())
    expect(stray.status).toBe(404)

    // Still listening for the real one.
    await browserGet(withParams(returnUrl, { access_token: 'a1', refresh_token: 'r1' }))
    await expect(flow).resolves.toEqual({ status: 'tokens', accessToken: 'a1', refreshToken: 'r1' })
    await browserGet(new URL(`${DONE_PATH}?outcome=ok`, returnUrl).toString())
  })

  it('answers a second callback after the first with not-found, not a second adoption', async () => {
    const flow = runOAuthFlow('google')
    const { returnUrl } = await startedFlow()

    await browserGet(withParams(returnUrl, { access_token: 'a1', refresh_token: 'r1' }))
    await expect(flow).resolves.toMatchObject({ status: 'tokens' })

    const replay = await browserGet(withParams(returnUrl, { access_token: 'a2', refresh_token: 'r2' }))
    expect(replay.status).toBe(404)

    await browserGet(new URL(`${DONE_PATH}?outcome=ok`, returnUrl).toString())
  })

  it('gives up when the browser never comes back', async () => {
    const flow = runOAuthFlow('google', { timeoutMs: 30 })
    const { returnUrl } = await startedFlow()

    await expect(flow).resolves.toEqual({ status: 'failed', reason: 'timed-out' })
    // Nothing is left listening for a callback that will never arrive.
    await expect(browserGet(returnUrl.toString())).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('fails, and stops listening, when the browser cannot be opened', async () => {
    electron.shell.openExternal.mockImplementationOnce(() => Promise.reject(new Error('no handler for https')))

    const flow = runOAuthFlow('google')
    const { returnUrl } = await startedFlow()

    await expect(flow).resolves.toEqual({ status: 'failed', reason: 'could-not-open-browser' })
    await expect(browserGet(returnUrl.toString())).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('refuses a cleartext API URL before opening anything', async () => {
    process.env.OPENPLC_EDGE_API_URL = 'http://api.example.com'

    const result = await runOAuthFlow('google')

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.reason).toContain('https')
    expect(electron.shell.openExternal).not.toHaveBeenCalled()
  })
})
