/**
 * The session logic, with HTTP and disk stubbed out.
 *
 * What is worth protecting is not the request shapes — one line each — but four
 * decisions that are easy to regress and expensive when they break:
 *
 *  - an unverified email arrives as a 200 with a null access token. Read as a failure,
 *    it sends someone with the right password hunting for a wrong one.
 *  - a transport failure must surface as `unknown`, never as `no-session`.
 *  - rotation is single-use, so concurrent renewals must collapse onto ONE request.
 *  - a refused renewal must drop the stored token, or every launch afterwards begins
 *    with a request that can only fail.
 */

import {
  __resetInMemorySessionForTests,
  adoptProviderTokens,
  fetchPlanCaption,
  fetchUser,
  signIn,
  signOut,
} from '../edge-account-service'
import { edgeRequest } from '../edge-http'
import { clearRefreshToken, readRefreshToken, saveRefreshToken } from '../session-store'

jest.mock('../edge-http', () => ({
  edgeRequest: jest.fn(),
  parseJsonBody: (body: string) => {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  },
}))

jest.mock('../session-store', () => ({
  saveRefreshToken: jest.fn(() => ({ persisted: true })),
  readRefreshToken: jest.fn(),
  clearRefreshToken: jest.fn(),
  isEncryptionAvailable: jest.fn(() => true),
}))

const request = edgeRequest as jest.MockedFunction<typeof edgeRequest>
const readStored = readRefreshToken as jest.MockedFunction<typeof readRefreshToken>
const saveStored = saveRefreshToken as jest.MockedFunction<typeof saveRefreshToken>
const clearStored = clearRefreshToken as jest.MockedFunction<typeof clearRefreshToken>

const USER = { id: 'u1', name: 'Ada', email: 'ada@example.com', username: 'ada' }

/** A JWT whose only meaningful claim is an `exp` the given distance from now. */
function tokenExpiringIn(ms: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + ms) / 1000) })).toString('base64url')

  return `header.${payload}.signature`
}

const LIVE_TOKEN = tokenExpiringIn(7 * 24 * 60 * 60 * 1000)

function ok(data: unknown) {
  return { status: 200, body: JSON.stringify({ data }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetInMemorySessionForTests()
  readStored.mockReturnValue(null)
})

describe('signIn', () => {
  it('maps a 401 to invalid credentials', async () => {
    request.mockResolvedValueOnce({ status: 401, body: '{}' })

    await expect(signIn('ada@example.com', 'wrong')).resolves.toEqual({ status: 'invalid-credentials' })
    expect(saveStored).not.toHaveBeenCalled()
  })

  it('reads a 200 with a null access token as an unverified address', async () => {
    // Edge answers exactly this for a correct password on an unverified account.
    request.mockResolvedValueOnce(ok({ accessToken: null, refreshToken: null, user: USER }))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({
      status: 'email-unverified',
      email: 'ada@example.com',
    })
  })

  it('adopts the pair and persists only the refresh token', async () => {
    request.mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r1', user: USER }))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'signed-in', user: USER })

    // The access token is deliberately never written down — it lives 7 days.
    expect(saveStored).toHaveBeenCalledTimes(1)
    expect(saveStored).toHaveBeenCalledWith('r1')
  })

  it('names the user with a follow-up read when the response omits one', async () => {
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r1' }))
      .mockResolvedValueOnce(ok({ user: USER }))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'signed-in', user: USER })
  })

  it('fails, holding no half session, when the user cannot be named', async () => {
    request.mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r1' })).mockResolvedValueOnce(ok({}))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'failed' })
    expect(clearStored).toHaveBeenCalled()
  })

  it('fails on an access token with no refresh token', async () => {
    // Not `email-unverified` — that case is a NULL access token. Here there is a usable
    // access token and nothing to renew it with, which is a session that dies in 7 days
    // with no way back.
    request.mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: null, user: USER }))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'failed' })
  })

  it('reports a transport failure as a failed sign-in', async () => {
    request.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'failed' })
  })

  it('maps a 500 to a failed sign-in', async () => {
    request.mockResolvedValueOnce({ status: 500, body: 'upstream exploded' })

    await expect(signIn('ada@example.com', 'right')).resolves.toEqual({ status: 'failed' })
  })
})

describe('adoptProviderTokens', () => {
  it('adopts a harvested pair and names the user', async () => {
    request.mockResolvedValueOnce(ok({ user: USER }))

    await expect(adoptProviderTokens({ accessToken: LIVE_TOKEN, refreshToken: 'r1' })).resolves.toEqual({
      status: 'signed-in',
      user: USER,
    })
    expect(saveStored).toHaveBeenCalledWith('r1')
  })

  it('fails on an incomplete pair without touching storage', async () => {
    await expect(adoptProviderTokens({ accessToken: LIVE_TOKEN })).resolves.toEqual({ status: 'failed' })
    expect(saveStored).not.toHaveBeenCalled()
  })
})

describe('fetchUser', () => {
  it('says no-session when there is nothing to renew with', async () => {
    await expect(fetchUser()).resolves.toEqual({ status: 'no-session' })
    expect(request).not.toHaveBeenCalled()
  })

  it('renews from the stored token, then answers', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      .mockResolvedValueOnce(ok({ user: USER }))

    await expect(fetchUser()).resolves.toEqual({ status: 'signed-in', user: USER })

    // Restoring a session across restarts needs no separate step: the first read
    // renews from disk on its own.
    expect(request).toHaveBeenNthCalledWith(1, '/auth/refresh', { method: 'POST', json: { refreshToken: 'stored-r' } })
    expect(saveStored).toHaveBeenCalledWith('r2')
  })

  it('renews once and retries when a live-looking token is refused', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      // Refused despite a future `exp`: revoked from another device, or the account's
      // tokens invalidated by a password change.
      .mockResolvedValueOnce({ status: 401, body: '{}' })
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r3' }))
      .mockResolvedValueOnce(ok({ user: USER }))

    await expect(fetchUser()).resolves.toEqual({ status: 'signed-in', user: USER })
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('gives up after one forced renewal that fails', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      .mockResolvedValueOnce({ status: 401, body: '{}' })
      .mockResolvedValueOnce({ status: 401, body: '{}' })

    await expect(fetchUser()).resolves.toEqual({ status: 'no-session' })
  })

  it('surfaces a transport failure as unknown, never as no-session', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockRejectedValueOnce(new Error('offline'))

    await expect(fetchUser()).resolves.toEqual({ status: 'unknown' })
  })

  it('says no-session when the renewal is refused, and drops the dead token', async () => {
    readStored.mockReturnValue('revoked-r')
    request.mockResolvedValueOnce({ status: 401, body: '{}' })

    await expect(fetchUser()).resolves.toEqual({ status: 'no-session' })
    expect(clearStored).toHaveBeenCalledTimes(1)
  })

  it('keeps the token when the renewal fails with a 5xx', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockResolvedValueOnce({ status: 503, body: '' })

    await expect(fetchUser()).resolves.toEqual({ status: 'no-session' })
    // A 5xx says nothing about whether the token is valid.
    expect(clearStored).not.toHaveBeenCalled()
  })

  it('says no-session when the profile payload carries no user', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' })).mockResolvedValueOnce(ok({}))

    await expect(fetchUser()).resolves.toEqual({ status: 'no-session' })
  })

  it('collapses concurrent renewals onto one request', async () => {
    readStored.mockReturnValue('stored-r')

    let release: (value: { status: number; body: string }) => void = () => undefined
    const pending = new Promise<{ status: number; body: string }>((resolve) => {
      release = resolve
    })

    request.mockReturnValueOnce(pending).mockResolvedValue(ok({ user: USER }))

    const both = Promise.all([fetchUser(), fetchUser()])
    release(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))

    await expect(both).resolves.toEqual([
      { status: 'signed-in', user: USER },
      { status: 'signed-in', user: USER },
    ])

    // Refresh tokens are single-use: a second renewal would present a superseded token
    // and lean on the server's replay window to recover.
    expect(request.mock.calls.filter(([path]) => path === '/auth/refresh')).toHaveLength(1)
  })

  it('renews a token that is inside the expiry margin', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: tokenExpiringIn(5_000), refreshToken: 'r1', user: USER }))
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      .mockResolvedValueOnce(ok({ user: USER }))

    await signIn('ada@example.com', 'right')

    await expect(fetchUser()).resolves.toEqual({ status: 'signed-in', user: USER })
    expect(request.mock.calls.filter(([path]) => path === '/auth/refresh')).toHaveLength(1)
  })

  it('treats an unreadable token as needing renewal rather than trusting it', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: 'not-a-jwt', refreshToken: 'r1', user: USER }))
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      .mockResolvedValueOnce(ok({ user: USER }))

    await signIn('ada@example.com', 'right')

    await expect(fetchUser()).resolves.toEqual({ status: 'signed-in', user: USER })
  })
})

describe('fetchPlanCaption', () => {
  it('renders the plan name the way Edge does', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      .mockResolvedValueOnce(ok({ plan: { displayName: 'Pro' } }))

    await expect(fetchPlanCaption()).resolves.toBe('Pro Plan')
  })

  it('returns null for an account with no plan', async () => {
    readStored.mockReturnValue('stored-r')
    request
      .mockResolvedValueOnce(ok({ accessToken: LIVE_TOKEN, refreshToken: 'r2' }))
      // Edge answers 404 for Community, expired or cancelled — a valid state, not an
      // error.
      .mockResolvedValueOnce({ status: 404, body: '{}' })

    await expect(fetchPlanCaption()).resolves.toBeNull()
  })

  it('returns null rather than propagating a transport failure', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockRejectedValueOnce(new Error('offline'))

    await expect(fetchPlanCaption()).resolves.toBeNull()
  })

  it('returns null when there is no session at all', async () => {
    await expect(fetchPlanCaption()).resolves.toBeNull()
  })
})

describe('signOut', () => {
  it('revokes server-side and clears locally', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockResolvedValueOnce({ status: 200, body: '{}' })

    await signOut()

    expect(clearStored).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/auth/logout', { method: 'POST', json: { refreshToken: 'stored-r' } })
  })

  it('clears locally even when the request fails', async () => {
    readStored.mockReturnValue('stored-r')
    request.mockRejectedValueOnce(new Error('offline'))

    await expect(signOut()).resolves.toBeUndefined()

    // Someone who asked to leave must end up signed out; the server-side token expires
    // on its own.
    expect(clearStored).toHaveBeenCalledTimes(1)
  })

  it('skips the request when there is nothing to revoke', async () => {
    await signOut()

    expect(request).not.toHaveBeenCalled()
  })
})
