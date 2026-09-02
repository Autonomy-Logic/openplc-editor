/**
 * The behaviour worth protecting is the session state machine, not the IPC
 * forwarding. Three distinctions in it are load-bearing:
 *
 *  - `unknown` (the question could not be asked) must NOT read as signed out, or a
 *    two-second network drop prompts over a live session holding unsaved work.
 *  - "never signed in" must not be worded as "your session expired", which is a claim
 *    about a session the user never had.
 *  - expiry must announce on the TRANSITION only. Firing on every failed read replays
 *    the handler on each poll.
 */

import type { EdgeUserRead } from '../../../shared/ports/edge-account-port'
import { __resetEdgeSessionForTests, editorEdgeAccountPort, isSessionPersistent } from '../edge-account-adapter'

const bridge = {
  edgeAccountFetchUser: jest.fn<Promise<EdgeUserRead>, []>(),
  edgeAccountFetchPlanCaption: jest.fn<Promise<string | null>, []>(),
  edgeAccountSignIn: jest.fn(),
  edgeAccountSignOut: jest.fn<Promise<void>, []>(),
  edgeAccountIsSessionPersistent: jest.fn<Promise<boolean>, []>(),
}

const USER = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', username: 'ada' }

beforeEach(() => {
  jest.clearAllMocks()
  __resetEdgeSessionForTests()

  bridge.edgeAccountFetchUser.mockResolvedValue({ status: 'no-session' })
  bridge.edgeAccountFetchPlanCaption.mockResolvedValue(null)
  bridge.edgeAccountSignIn.mockResolvedValue({ status: 'signed-in', user: USER })
  bridge.edgeAccountSignOut.mockResolvedValue(undefined)
  bridge.edgeAccountIsSessionPersistent.mockResolvedValue(true)

  window.bridge = bridge as unknown as typeof window.bridge
})

describe('static surface', () => {
  it('exposes the Edge web origin through a getter', () => {
    // A getter, not a captured value, so a build-time override is not frozen at import.
    expect(editorEdgeAccountPort.frontendBaseUrl).toMatch(/^https?:\/\//)
  })

  it('lists the three providers Edge offers, in its own order', () => {
    expect(editorEdgeAccountPort.oauthProviders.map((provider) => provider.id)).toEqual([
      'google',
      'microsoft',
      'apple',
    ])
  })

  it('builds the provider address the Edge SPA would use', () => {
    const url = new URL(editorEdgeAccountPort.oauthUrl('google', 'http://localhost:1313'))

    expect(url.pathname).toBe('/auth/google')
    expect(url.searchParams.get('state')).toBe('http://localhost:1313')
  })
})

describe('fetchUser', () => {
  it('returns the user and revives a previously dead session', async () => {
    await editorEdgeAccountPort.fetchUser()
    expect(editorEdgeAccountPort.session.isExpired()).toBe(true)

    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })

    await expect(editorEdgeAccountPort.fetchUser()).resolves.toEqual({ status: 'signed-in', user: USER })
    expect(editorEdgeAccountPort.session.isExpired()).toBe(false)
  })

  it('reports a first no-session as absent, not as an expiry', async () => {
    await editorEdgeAccountPort.fetchUser()

    expect(editorEdgeAccountPort.session.isExpired()).toBe(true)
    expect(editorEdgeAccountPort.session.isAbsent()).toBe(true)
  })

  it('reports a no-session AFTER a live session as an expiry', async () => {
    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })
    await editorEdgeAccountPort.fetchUser()

    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'no-session' })
    await editorEdgeAccountPort.fetchUser()

    expect(editorEdgeAccountPort.session.isExpired()).toBe(true)
    expect(editorEdgeAccountPort.session.isAbsent()).toBe(false)
  })

  it('leaves the session untouched on an unknown read', async () => {
    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })
    await editorEdgeAccountPort.fetchUser()

    const expiry = jest.fn()
    editorEdgeAccountPort.session.onExpired(expiry)

    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'unknown' })

    await expect(editorEdgeAccountPort.fetchUser()).resolves.toEqual({ status: 'unknown' })
    expect(editorEdgeAccountPort.session.isExpired()).toBe(false)
    expect(expiry).not.toHaveBeenCalled()
  })

  it('treats a throwing bridge call as unknown, not as signed out', async () => {
    bridge.edgeAccountFetchUser.mockRejectedValueOnce(new Error('ipc gone'))

    await expect(editorEdgeAccountPort.fetchUser()).resolves.toEqual({ status: 'unknown' })
    expect(editorEdgeAccountPort.session.isExpired()).toBe(false)
  })

  it('announces expiry once, on the transition only', async () => {
    const expiry = jest.fn()
    editorEdgeAccountPort.session.onExpired(expiry)

    await editorEdgeAccountPort.fetchUser()
    await editorEdgeAccountPort.fetchUser()
    await editorEdgeAccountPort.fetchUser()

    expect(expiry).toHaveBeenCalledTimes(1)
  })
})

describe('fetchPlanCaption', () => {
  it('passes the caption through', async () => {
    bridge.edgeAccountFetchPlanCaption.mockResolvedValueOnce('Pro Plan')

    await expect(editorEdgeAccountPort.fetchPlanCaption()).resolves.toBe('Pro Plan')
  })

  it('degrades to null rather than taking the menu down', async () => {
    bridge.edgeAccountFetchPlanCaption.mockRejectedValueOnce(new Error('nope'))

    await expect(editorEdgeAccountPort.fetchPlanCaption()).resolves.toBeNull()
  })
})

describe('signIn', () => {
  it('announces restoration so a queued save can replay immediately', async () => {
    await editorEdgeAccountPort.fetchUser()

    const restored = jest.fn()
    editorEdgeAccountPort.session.onRestored(restored)

    await expect(editorEdgeAccountPort.signIn('ada@example.com', 'pw')).resolves.toEqual({
      status: 'signed-in',
      user: USER,
    })
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it('passes a non-success outcome through untouched', async () => {
    bridge.edgeAccountSignIn.mockResolvedValueOnce({ status: 'email-unverified', email: 'ada@example.com' })

    await expect(editorEdgeAccountPort.signIn('ada@example.com', 'pw')).resolves.toEqual({
      status: 'email-unverified',
      email: 'ada@example.com',
    })
  })

  it('reports a throwing bridge call as a failed sign-in', async () => {
    bridge.edgeAccountSignIn.mockRejectedValueOnce(new Error('ipc gone'))

    await expect(editorEdgeAccountPort.signIn('ada@example.com', 'pw')).resolves.toEqual({ status: 'failed' })
  })
})

describe('signOut', () => {
  it('ends the session and words it as a departure, not an expiry', async () => {
    bridge.edgeAccountFetchUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })
    await editorEdgeAccountPort.fetchUser()

    const expiry = jest.fn()
    editorEdgeAccountPort.session.onExpired(expiry)

    await editorEdgeAccountPort.signOut()

    expect(bridge.edgeAccountSignOut).toHaveBeenCalledTimes(1)
    expect(editorEdgeAccountPort.session.isExpired()).toBe(true)
    expect(editorEdgeAccountPort.session.isAbsent()).toBe(true)
    expect(expiry).toHaveBeenCalledTimes(1)
  })

  it('still ends the local session when the request fails', async () => {
    bridge.edgeAccountSignOut.mockRejectedValueOnce(new Error('offline'))

    await editorEdgeAccountPort.signOut()

    expect(editorEdgeAccountPort.session.isExpired()).toBe(true)
    expect(editorEdgeAccountPort.session.isAbsent()).toBe(true)
  })
})

describe('isSessionPersistent', () => {
  it('reports what the main process says', async () => {
    bridge.edgeAccountIsSessionPersistent.mockResolvedValueOnce(false)

    await expect(isSessionPersistent()).resolves.toBe(false)
  })

  it('assumes not persistent when the probe fails', async () => {
    bridge.edgeAccountIsSessionPersistent.mockRejectedValueOnce(new Error('nope'))

    // The safe direction: promising persistence we cannot confirm would surprise the
    // user at the next launch.
    await expect(isSessionPersistent()).resolves.toBe(false)
  })
})

describe('listener bookkeeping', () => {
  it('unsubscribes both kinds of listener', async () => {
    const expiry = jest.fn()
    const restored = jest.fn()

    editorEdgeAccountPort.session.onExpired(expiry)()
    editorEdgeAccountPort.session.onRestored(restored)()

    await editorEdgeAccountPort.fetchUser()
    await editorEdgeAccountPort.signIn('ada@example.com', 'pw')

    expect(expiry).not.toHaveBeenCalled()
    expect(restored).not.toHaveBeenCalled()
  })

  it('survives a listener that re-subscribes while being notified', async () => {
    // The interrupted-save queue does exactly this when its replay fails a second
    // time. Iterating a live Set turns re-registration into an unbounded loop, which
    // is why the fan-out snapshots first.
    let calls = 0

    const resubscribe = () => {
      calls += 1

      if (calls < 5) {
        editorEdgeAccountPort.session.onExpired(resubscribe)
      }
    }

    editorEdgeAccountPort.session.onExpired(resubscribe)

    await editorEdgeAccountPort.fetchUser()

    expect(calls).toBe(1)
  })

  it('markRestored announces nothing when nothing was announced dead', () => {
    const restored = jest.fn()
    editorEdgeAccountPort.session.onRestored(restored)

    editorEdgeAccountPort.session.markRestored()

    expect(restored).not.toHaveBeenCalled()
    // It still retires `absent`, which is what stops the next expiry being worded as
    // "you were never signed in".
    expect(editorEdgeAccountPort.session.isAbsent()).toBe(false)
  })
})
