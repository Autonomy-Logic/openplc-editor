import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  EdgeAccountPort,
  EdgeSessionState,
  EdgeUser,
  EdgeUserRead,
} from '../../middleware/shared/ports/edge-account-port'

/**
 * Who is signed in, according to the Edge API.
 *
 * Deliberately holds no token and persists nothing. The session is the shared
 * cookie session — the editor has no account state of its own to keep in sync, so
 * the only thing cached here is the profile being displayed.
 */
export type EdgeAccountStatus = 'loading' | 'signed-in' | 'signed-out'

export interface UseEdgeAccountResult {
  status: EdgeAccountStatus
  user: EdgeUser | null
  /** e.g. `Pro Plan`; null when the account has no active subscription. */
  planCaption: string | null
  /**
   * Why the account is signed out, when it is.
   *
   * `expired` means the user WAS working and the session died under them;
   * `signed-out` means they simply are not signed in. The sign-in prompt reads
   * very differently in those two cases — greeting someone who was mid-edit with
   * "Welcome" tells them nothing about what just happened to their session.
   */
  signedOutReason: 'expired' | 'signed-out'
  /** Re-read the session — call after a sign-in completes. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Why the account is signed out — told apart properly.
 *
 * The renewal layer marks the session expired for BOTH kinds of 401: one that ran
 * out under a working user, and one where there was never a session to renew. So
 * `isExpired()` on its own is also true for someone who just pressed Sign out, and
 * for someone who never signed in at all — and both were then told "Your session
 * has expired", a claim about their session that is simply false. `isAbsent()` is
 * the discriminator the session layer already exposes for exactly this, and the
 * web router uses it the same way (`no_auth` vs `session_expired`).
 */
function reasonFromSession(session: EdgeSessionState): 'expired' | 'signed-out' {
  return session.isExpired() && !session.isAbsent() ? 'expired' : 'signed-out'
}

/** Widening gap before retrying a first read that never reached the server. */
function retryDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** (attempt - 1))
}

/**
 * `account` is the platform's Edge account port. Passed in rather than imported:
 * this file lives in `frontend/`, a surface mirrored into the desktop editor,
 * where reaching into the web adapter would compile the app against an API it
 * does not speak. Undefined on such a platform, which reads the same as disabled.
 */
export function useEdgeAccount(enabled: boolean, account?: EdgeAccountPort): UseEdgeAccountResult {
  const active = enabled && account !== undefined
  const [status, setStatus] = useState<EdgeAccountStatus>(active ? 'loading' : 'signed-out')
  const [user, setUser] = useState<EdgeUser | null>(null)
  const [planCaption, setPlanCaption] = useState<string | null>(null)
  const [signedOutReason, setSignedOutReason] = useState<'expired' | 'signed-out'>('signed-out')
  /** Consecutive reads that never reached the server. Drives the retry effect below. */
  const [unreachable, setUnreachable] = useState(0)

  /**
   * Which read of the session is the current one.
   *
   * Bumped by every new refresh AND by everything that clears the account, so a
   * read that resolves after one of those cannot apply what it found. Without it,
   * an expiry landing while `fetchUser` was in flight was undone by that in-flight
   * read: it came back with the user it had fetched BEFORE the session died, put
   * the status back to `signed-in`, and called `markRestored()` — announcing a
   * recovery that never happened, which replayed a queued save against a session
   * that was already gone.
   */
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    if (!active || !account) {
      return
    }

    const readId = ++generation.current
    const isCurrent = () => generation.current === readId

    // `.catch` folds a rejection into the same "learned nothing" answer the port
    // already has a name for. The web adapter contracts every failure into a read
    // rather than rejecting, but nothing in the types enforces that — and a
    // rejection here used to leave `status` on `loading` with no way back short of
    // a reload, rendering neither the account menu nor the way to sign in.
    const read = await account.fetchUser().catch((): EdgeUserRead => ({ status: 'unknown' }))

    if (!isCurrent()) {
      return
    }

    // Learned nothing, so change nothing.
    //
    // Falling to `signed-out` here is what dropped a blocking sign-in dialog over a
    // live session — and over unsaved work — every time the network blipped for a
    // second. Holding the current answer is the honest response to a question that
    // was never actually asked. The retry effect below is what gets a FIRST read
    // out of `loading`, since there is no answer to hold in that case.
    if (read.status === 'unknown') {
      setUnreachable((attempts) => attempts + 1)
      return
    }

    setUnreachable(0)

    const nextUser = read.status === 'signed-in' ? read.user : null

    // Announce the recovery from wherever a working session is OBSERVED, not only
    // from where this app performed a sign-in. A provider flow finishes in another
    // tab, so this read is the only thing that learns about it — and the request
    // succeeds, meaning the renewal layer never runs and never announces anything.
    // Without this, work queued while the session was dead (an interrupted save)
    // stayed queued forever after an OAuth sign-in, while the toast said it would
    // finish on its own. Safe to call unconditionally: it no-ops unless something
    // was previously announced dead.
    if (nextUser) {
      account.session.markRestored()
    }

    setUser(nextUser)
    setStatus(nextUser ? 'signed-in' : 'signed-out')
    // The renewal layer's own verdict, so a refresh that finds nobody signed in
    // still knows whether a session died to get here — the case where /auth/me
    // 401s and the renewal behind it gave up. See `reasonFromSession` for why that
    // verdict alone is not enough to call it an expiry.
    setSignedOutReason(nextUser ? 'signed-out' : reasonFromSession(account.session))

    // Only worth asking once we know someone is signed in, and it must not gate
    // the menu appearing: the caption is decoration next to the name.
    const caption = nextUser ? await account.fetchPlanCaption().catch(() => null) : null

    if (!isCurrent()) {
      return
    }

    setPlanCaption(caption)
  }, [active, account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Retry a first read that never reached the server.
   *
   * Scoped to `loading` because that is the one state with nothing to hold on to —
   * no account menu, no sign-in gate, nothing on screen at all — and no other way
   * out, since the focus re-check below only runs while `signed-out`. Once there IS
   * an answer, an unreachable read simply keeps it and this stays out of the way.
   */
  useEffect(() => {
    if (!active || status !== 'loading' || unreachable === 0) {
      return
    }

    const timer = setTimeout(() => {
      void refresh()
    }, retryDelay(unreachable))

    return () => {
      clearTimeout(timer)
    }
  }, [active, status, unreachable, refresh])

  // The renewal layer already knows when a session is beyond saving; reusing its
  // signal keeps the menu from showing a user who can no longer save anything.
  useEffect(() => {
    if (!active || !account) {
      return
    }

    return account.session.onExpired(() => {
      generation.current += 1
      setUser(null)
      setPlanCaption(null)
      setStatus('signed-out')
      setSignedOutReason(reasonFromSession(account.session))
    })
  }, [active, account])

  /**
   * Re-check when this tab regains focus while signed out.
   *
   * The provider flow finishes in a separate tab, so nothing in this one knows it
   * happened. Coming back here is the signal. Scoped to the signed-out state so a
   * working session never pays for it, and it is the only way the sign-in gate
   * closes after an OAuth round-trip.
   */
  useEffect(() => {
    if (!active || status !== 'signed-out') {
      return
    }

    const onFocus = () => {
      void refresh()
    }

    window.addEventListener('focus', onFocus)

    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [active, status, refresh])

  const signOut = useCallback(async () => {
    // Before the request, not after: the read to retire is the one already in
    // flight, and awaiting first would let it land while the request is out.
    generation.current += 1

    try {
      await account?.signOut()
    } finally {
      // In `finally`, not after the await: the user asked to leave, so the UI has
      // to reach the signed-out state even if the request throws. Leaving them
      // looking at an account they just left is the worse failure, and relying on
      // the callee never rejecting would put that guarantee in the wrong place.
      setUser(null)
      setPlanCaption(null)
      setStatus('signed-out')
      // Leaving on purpose is not an expiry: the prompt must not tell someone who
      // just signed out that their session expired.
      setSignedOutReason('signed-out')
    }
  }, [account])

  return { status, user, planCaption, signedOutReason, refresh, signOut }
}
