import { beforeEach, describe, expect, it } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { EdgeAccountPort, EdgeUserRead } from '../../../middleware/shared/ports/edge-account-port'

const fetchEdgeUser = jest.fn<Promise<EdgeUserRead>, []>()
const signOutOfEdge = jest.fn<Promise<void>, []>()
const fetchEdgePlanCaption = jest.fn<Promise<string | null>, []>()
const isEdgeSessionExpired = jest.fn(() => false)
const isEdgeSessionAbsent = jest.fn(() => false)
const markRestored = jest.fn<void, []>()
let expiryListener: (() => void) | null = null
let restoredListener: (() => void) | null = null

// Passed in rather than imported: this surface is mirrored into a build with no web adapter.
const account: EdgeAccountPort = {
  frontendBaseUrl: 'https://edge.example.com',
  oauthProviders: [],
  oauthUrl: () => '',
  fetchUser: () => fetchEdgeUser(),
  fetchPlanCaption: () => fetchEdgePlanCaption(),
  signIn: () => Promise.resolve({ status: 'failed' }),
  signOut: () => signOutOfEdge(),
  session: {
    isExpired: () => isEdgeSessionExpired(),
    isAbsent: () => isEdgeSessionAbsent(),
    onExpired: (listener: () => void) => {
      expiryListener = listener
      return () => {
        expiryListener = null
      }
    },
    onRestored: (listener: () => void) => {
      restoredListener = listener
      return () => {
        restoredListener = null
      }
    },
    markRestored: () => markRestored(),
  },
}

import { useEdgeAccount } from '../use-edge-account'

const USER = { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', username: 'ada' }

// `fetchUser` resolves to a read (no-session/unknown/signed-in), never a bare user,
// so a network failure can't be conflated with "nobody is signed in".
// Mirrors the renewal layer's real order: sets sessionExpired/lastFailureKind before notifying listeners.
function fireExpiry({ absent = false }: { absent?: boolean } = {}) {
  isEdgeSessionExpired.mockReturnValue(true)
  isEdgeSessionAbsent.mockReturnValue(absent)
  expiryListener?.()
}

const signedIn = (user: typeof USER) => ({ status: 'signed-in' as const, user })
const noSession = () => ({ status: 'no-session' as const })
const unreachable = () => ({ status: 'unknown' as const })

describe('useEdgeAccount', () => {
  beforeEach(() => {
    fetchEdgeUser.mockReset()
    signOutOfEdge.mockReset()
    signOutOfEdge.mockResolvedValue(undefined)
    fetchEdgePlanCaption.mockReset()
    fetchEdgePlanCaption.mockResolvedValue('Pro Plan')
    isEdgeSessionExpired.mockReset()
    isEdgeSessionExpired.mockReturnValue(false)
    isEdgeSessionAbsent.mockReset()
    isEdgeSessionAbsent.mockReturnValue(false)
    markRestored.mockReset()
    expiryListener = null
  })

  it('reports the signed-in user', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))

    const { result } = renderHook(() => useEdgeAccount(true, account))

    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    expect(result.current.user).toEqual(USER)
  })

  it('reports signed-out when there is no session', async () => {
    fetchEdgeUser.mockResolvedValue(noSession())

    const { result } = renderHook(() => useEdgeAccount(true, account))

    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(result.current.user).toBeNull()
  })

  // Starting at `loading` is what keeps a slow /auth/me from flashing a sign-in
  // prompt at someone who is already signed in.
  it('starts in loading so the gate does not flash', () => {
    fetchEdgeUser.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useEdgeAccount(true, account))

    expect(result.current.status).toBe('loading')
  })

  // The node build shares this component tree but has no Edge API to ask.
  it('asks nothing when the build has no Edge account', () => {
    const { result } = renderHook(() => useEdgeAccount(false, account))

    expect(fetchEdgeUser).not.toHaveBeenCalled()
    expect(result.current.status).toBe('signed-out')
  })

  it('clears the account on sign-out', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    await act(async () => {
      await result.current.signOut()
    })

    expect(signOutOfEdge).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('signed-out')
    expect(result.current.user).toBeNull()
  })

  // The user asked to leave; a failed request must not leave them staring at an
  // account they thought they had left.
  it('clears the account even when the logout request fails', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))
    signOutOfEdge.mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    await act(async () => {
      await result.current.signOut().catch(() => {})
    })

    expect(result.current.status).toBe('signed-out')
  })

  // Reuses the renewal layer's own verdict rather than second-guessing it.
  it('drops the account when the session renewal gives up', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    act(() => {
      fireExpiry()
    })

    expect(result.current.status).toBe('signed-out')
    expect(result.current.user).toBeNull()
  })

  // Shown next to the name, the way Edge captions its own account card.
  it('reports the plan caption alongside the user', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))

    const { result } = renderHook(() => useEdgeAccount(true, account))

    await waitFor(() => expect(result.current.planCaption).toBe('Pro Plan'))
  })

  // A missing caption must not keep the menu from appearing.
  it('still reports the user when the plan cannot be read', async () => {
    fetchEdgeUser.mockResolvedValue(signedIn(USER))
    fetchEdgePlanCaption.mockResolvedValue(null)

    const { result } = renderHook(() => useEdgeAccount(true, account))

    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    expect(result.current.planCaption).toBeNull()
  })

  // The provider flow finishes in another tab; only regaining focus tells this hook a session now exists.
  describe('returning from a provider tab', () => {
    it('re-checks the session when the tab regains focus', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-out'))

      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => expect(result.current.status).toBe('signed-in'))
    })

    // A working session must not pay for this on every window switch.
    it('does not re-check while already signed in', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      const callsBefore = fetchEdgeUser.mock.calls.length

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expect(fetchEdgeUser.mock.calls.length).toBe(callsBefore)
    })

    // A successful focus re-check never runs the renewal layer, so it must announce the recovery itself.
    it('announces the recovery when it finds a session, with no 401 involved', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      markRestored.mockReset()

      // the provider tab signed the user in; this tab only ever sees a 200
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => expect(markRestored).toHaveBeenCalled())
    })

    // Nothing to resume when nobody is signed in, so nothing should be announced.
    it('announces nothing when the re-check still finds no session', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      markRestored.mockReset()

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => expect(fetchEdgeUser.mock.calls.length).toBeGreaterThan(1))
      expect(markRestored).not.toHaveBeenCalled()
    })

    it('does not re-check in a build without an Edge account', () => {
      renderHook(() => useEdgeAccount(false, account))

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      expect(fetchEdgeUser).not.toHaveBeenCalled()
    })
  })

  // The sign-in prompt reads differently depending on why, so the hook carries the reason.
  describe('why the account is signed out', () => {
    it('reports a plain signed-out state when nobody was signed in', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())

      const { result } = renderHook(() => useEdgeAccount(true, account))

      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(result.current.signedOutReason).toBe('signed-out')
    })

    it('reports an expiry when the session died under the user', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      act(() => {
        fireExpiry()
      })

      expect(result.current.signedOutReason).toBe('expired')
    })

    // A reload lands here with no session and the renewal layer already knowing
    // why — that verdict is what distinguishes it from never having signed in.
    it('trusts the renewal layer when a re-read finds nobody', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())
      isEdgeSessionExpired.mockReturnValue(true)

      const { result } = renderHook(() => useEdgeAccount(true, account))

      await waitFor(() => expect(result.current.signedOutReason).toBe('expired'))
    })

    // isExpired() alone can't distinguish "ran out" from "never existed"; isAbsent() carries that.
    it('does not claim an expiry when there was no session to expire', async () => {
      fetchEdgeUser.mockResolvedValue(noSession())
      isEdgeSessionExpired.mockReturnValue(true)
      isEdgeSessionAbsent.mockReturnValue(true)

      const { result } = renderHook(() => useEdgeAccount(true, account))

      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(result.current.signedOutReason).toBe('signed-out')
    })

    it('does not claim an expiry after the user signed out and came back', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      await act(async () => {
        await result.current.signOut()
      })

      fetchEdgeUser.mockResolvedValue(noSession())
      isEdgeSessionExpired.mockReturnValue(true)
      isEdgeSessionAbsent.mockReturnValue(true)

      act(() => {
        window.dispatchEvent(new Event('focus'))
      })

      await waitFor(() => expect(fetchEdgeUser.mock.calls.length).toBeGreaterThan(1))
      expect(result.current.signedOutReason).toBe('signed-out')
    })

    it('does not claim an expiry when the event says there was no session', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      act(() => {
        fireExpiry({ absent: true })
      })

      expect(result.current.status).toBe('signed-out')
      expect(result.current.signedOutReason).toBe('signed-out')
    })

    // Leaving on purpose is not an expiry, and saying so would be a lie the user
    // can immediately tell.
    it('does not call a deliberate sign-out an expiry', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      await act(async () => {
        await result.current.signOut()
      })

      expect(result.current.signedOutReason).toBe('signed-out')
    })

    it('clears the expiry once the user signs back in', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      act(() => {
        fireExpiry()
      })
      expect(result.current.signedOutReason).toBe('expired')

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.status).toBe('signed-in')
      expect(result.current.signedOutReason).toBe('signed-out')
    })
  })

  it('re-reads the session on refresh', async () => {
    fetchEdgeUser.mockResolvedValueOnce(noSession()).mockResolvedValueOnce(signedIn(USER))

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-out'))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status).toBe('signed-in')
    expect(result.current.user).toEqual(USER)
  })

  // A stale read must not resurrect a session that has since died.
  describe('a read that outlives what it was reading', () => {
    it('does not let a read from before the expiry undo it', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      markRestored.mockReset()

      // A read goes out, then the session dies before it comes back.
      let settle: (read: EdgeUserRead) => void = () => {}
      fetchEdgeUser.mockReturnValue(
        new Promise<EdgeUserRead>((resolve) => {
          settle = resolve
        }),
      )

      let inFlight: Promise<void> = Promise.resolve()
      act(() => {
        inFlight = result.current.refresh()
      })

      act(() => {
        fireExpiry()
      })
      expect(result.current.status).toBe('signed-out')

      // The reply lands now, still carrying the user it fetched before the expiry.
      await act(async () => {
        settle(signedIn(USER))
        await inFlight
      })

      expect(result.current.status).toBe('signed-out')
      expect(result.current.signedOutReason).toBe('expired')
      expect(result.current.user).toBeNull()
      // The one that actually mattered: a false recovery replays a dead save.
      expect(markRestored).not.toHaveBeenCalled()
    })

    // Same shape, deliberate this time: leaving must stick.
    it('does not let a read from before a sign-out undo it', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      let settle: (read: EdgeUserRead) => void = () => {}
      fetchEdgeUser.mockReturnValue(
        new Promise<EdgeUserRead>((resolve) => {
          settle = resolve
        }),
      )

      let inFlight: Promise<void> = Promise.resolve()
      act(() => {
        inFlight = result.current.refresh()
      })

      await act(async () => {
        await result.current.signOut()
      })
      expect(result.current.status).toBe('signed-out')

      await act(async () => {
        settle(signedIn(USER))
        await inFlight
      })

      expect(result.current.status).toBe('signed-out')
      expect(result.current.user).toBeNull()
    })
  })

  // A request that never reached the server must not be read as "nobody is signed in".
  describe('a read that never reached the server', () => {
    it('keeps a signed-in user signed in', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      fetchEdgeUser.mockResolvedValue(unreachable())

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.status).toBe('signed-in')
      expect(result.current.user).toEqual(USER)
    })

    // The corollary: it must not announce a recovery either, since it saw nothing.
    it('announces nothing, having learned nothing', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      markRestored.mockReset()

      fetchEdgeUser.mockResolvedValue(unreachable())

      await act(async () => {
        await result.current.refresh()
      })

      expect(markRestored).not.toHaveBeenCalled()
    })

    // A real signed-out answer still signs the user out — the point is the
    // distinction, not refusing to ever close the session.
    it('still signs out when the server actually says so', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))

      const { result } = renderHook(() => useEdgeAccount(true, account))
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      fetchEdgeUser.mockResolvedValue(noSession())

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.status).toBe('signed-out')
    })

    // A first read has no prior answer to hold onto, so it must retry rather than give up.
    it('retries a first read until it gets through', async () => {
      jest.useFakeTimers()

      try {
        fetchEdgeUser.mockResolvedValue(unreachable())

        const { result } = renderHook(() => useEdgeAccount(true, account))

        // Let the first read resolve: the retry is only scheduled once the hook has
        // recorded that the read got nowhere.
        await act(async () => {})
        expect(fetchEdgeUser).toHaveBeenCalledTimes(1)
        expect(result.current.status).toBe('loading')

        // The network comes back; the scheduled retry is what notices.
        fetchEdgeUser.mockResolvedValue(signedIn(USER))

        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_000)
        })

        expect(result.current.status).toBe('signed-in')
        expect(result.current.user).toEqual(USER)
      } finally {
        jest.useRealTimers()
      }
    })

    // Widening gap, so an outage does not turn into a request loop.
    it('backs off between retries rather than hammering', async () => {
      jest.useFakeTimers()

      try {
        fetchEdgeUser.mockResolvedValue(unreachable())

        renderHook(() => useEdgeAccount(true, account))

        await act(async () => {})
        expect(fetchEdgeUser).toHaveBeenCalledTimes(1)

        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_000)
        })
        expect(fetchEdgeUser).toHaveBeenCalledTimes(2)

        // The second gap is longer than the first, so this is not yet due.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_000)
        })
        expect(fetchEdgeUser).toHaveBeenCalledTimes(2)

        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_000)
        })
        expect(fetchEdgeUser).toHaveBeenCalledTimes(3)
      } finally {
        jest.useRealTimers()
      }
    })

    // Once there IS an answer, the retry stays out of the way: the focus re-check
    // owns that case and a timer would just re-ask behind the user's back.
    it('does not retry once it has an answer to hold', async () => {
      jest.useFakeTimers()

      try {
        fetchEdgeUser.mockResolvedValue(signedIn(USER))

        const { result } = renderHook(() => useEdgeAccount(true, account))
        await act(async () => {})
        expect(result.current.status).toBe('signed-in')

        fetchEdgeUser.mockResolvedValue(unreachable())
        await act(async () => {
          await result.current.refresh()
        })

        const callsAfterUnknown = fetchEdgeUser.mock.calls.length

        await act(async () => {
          await jest.advanceTimersByTimeAsync(60_000)
        })

        expect(fetchEdgeUser.mock.calls.length).toBe(callsAfterUnknown)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  // Nothing in the types stops a port from rejecting instead of resolving.
  describe('a port that rejects instead of resolving', () => {
    // Folded into the same "learned nothing" answer as a network failure: hold, and retry.
    it('does not report a signed-out user when the read throws', async () => {
      fetchEdgeUser.mockRejectedValue(new Error('offline'))

      const { result } = renderHook(() => useEdgeAccount(true, account))

      await waitFor(() => expect(fetchEdgeUser).toHaveBeenCalled())
      expect(result.current.status).toBe('loading')
      expect(result.current.user).toBeNull()
    })

    // The caption is decoration next to the name; it must not take the menu down.
    it('still reports the user when the caption read throws', async () => {
      fetchEdgeUser.mockResolvedValue(signedIn(USER))
      fetchEdgePlanCaption.mockRejectedValue(new Error('offline'))

      const { result } = renderHook(() => useEdgeAccount(true, account))

      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      expect(result.current.user).toEqual(USER)
      expect(result.current.planCaption).toBeNull()
    })
  })
})

// Every consumer of the hook keeps its own state, so a sign-in from another consumer's
// dialog must reach this one too, not just the one that performed it.
describe('a sign-in performed elsewhere', () => {
  function fireRestored() {
    act(() => {
      restoredListener?.()
    })
  }

  beforeEach(() => {
    isEdgeSessionExpired.mockReturnValue(false)
    isEdgeSessionAbsent.mockReturnValue(false)
  })

  it('subscribes to the session, rather than polling for it', async () => {
    fetchEdgeUser.mockResolvedValue({ status: 'no-session' })

    const { result } = renderHook(() => useEdgeAccount(true, account))

    expect(restoredListener).not.toBeNull()
    // Let the first read land, so it does not settle after this test is over.
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
  })

  it('picks the account up without being remounted', async () => {
    fetchEdgeUser.mockResolvedValueOnce({ status: 'no-session' })

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-out'))

    // The user signs in through a dialog owned by a different consumer.
    fetchEdgeUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })
    fetchEdgePlanCaption.mockResolvedValueOnce('Pro Plan')
    fireRestored()

    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    expect(result.current.user).toEqual(USER)
  })

  it('re-reads even when it already believed someone was signed in', async () => {
    fetchEdgeUser.mockResolvedValueOnce({ status: 'signed-in', user: USER })
    fetchEdgePlanCaption.mockResolvedValue(null)

    const { result } = renderHook(() => useEdgeAccount(true, account))
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    const other = { ...USER, id: 'u2', name: 'Grace Hopper' }
    fetchEdgeUser.mockResolvedValueOnce({ status: 'signed-in', user: other })
    fireRestored()

    // Not scoped to the signed-out state: the account that just signed in need not be
    // the one this consumer was already showing.
    await waitFor(() => expect(result.current.user).toEqual(other))
  })

  it('unsubscribes when it goes away', () => {
    fetchEdgeUser.mockResolvedValue({ status: 'no-session' })

    const { unmount } = renderHook(() => useEdgeAccount(true, account))
    expect(restoredListener).not.toBeNull()

    unmount()

    // Left subscribed, a listener would call `refresh` on an unmounted hook for the
    // rest of the session.
    expect(restoredListener).toBeNull()
  })

  it('does not subscribe on a build with no Edge account', () => {
    renderHook(() => useEdgeAccount(false, account))

    expect(restoredListener).toBeNull()
  })
})
