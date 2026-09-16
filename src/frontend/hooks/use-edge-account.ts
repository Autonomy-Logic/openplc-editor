import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  EdgeAccountPort,
  EdgeSessionState,
  EdgeUser,
  EdgeUserRead,
} from '../../middleware/shared/ports/edge-account-port'

/** Holds no token: the shared cookie session is the truth. */
export type EdgeAccountStatus = 'loading' | 'signed-in' | 'signed-out'

export interface UseEdgeAccountResult {
  status: EdgeAccountStatus
  user: EdgeUser | null
  /** e.g. `Pro Plan`; null when the account has no active subscription. */
  planCaption: string | null
  /** `expired`: the session died under a working user; `signed-out`: never signed in, or left on purpose. */
  signedOutReason: 'expired' | 'signed-out'
  /** Re-read the session — call after a sign-in completes. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

// `isExpired()` is also true after Sign out and when there was never a session; `isAbsent()` tells them apart.
function reasonFromSession(session: EdgeSessionState): 'expired' | 'signed-out' {
  return session.isExpired() && !session.isAbsent() ? 'expired' : 'signed-out'
}

/** Widening gap before retrying a first read that never reached the server. */
function retryDelay(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** (attempt - 1))
}

/** `account` is passed in, not imported: this surface is mirrored into the editor, which has no web adapter. */
export function useEdgeAccount(enabled: boolean, account?: EdgeAccountPort): UseEdgeAccountResult {
  const active = enabled && account !== undefined
  const [status, setStatus] = useState<EdgeAccountStatus>(active ? 'loading' : 'signed-out')
  const [user, setUser] = useState<EdgeUser | null>(null)
  const [planCaption, setPlanCaption] = useState<string | null>(null)
  const [signedOutReason, setSignedOutReason] = useState<'expired' | 'signed-out'>('signed-out')
  /** Consecutive reads that never reached the server. Drives the retry effect below. */
  const [unreachable, setUnreachable] = useState(0)

  // Bumped by every refresh and by everything that clears the account, so an
  // in-flight read that resolves late cannot revive a session that already died.
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    if (!active || !account) {
      return
    }

    const readId = ++generation.current
    const isCurrent = () => generation.current === readId

    // A rejection must fold into `unknown`; otherwise `status` sticks on `loading` with no way back.
    const read = await account.fetchUser().catch((): EdgeUserRead => ({ status: 'unknown' }))

    if (!isCurrent()) {
      return
    }

    // Learned nothing, so change nothing: falling to `signed-out` here dropped a
    // blocking sign-in dialog over a live session on every network blip.
    if (read.status === 'unknown') {
      setUnreachable((attempts) => attempts + 1)
      return
    }

    setUnreachable(0)

    const nextUser = read.status === 'signed-in' ? read.user : null

    // Announce recovery here, not only after an in-app sign-in: an OAuth flow finishes
    // in another tab and this read is the only thing that learns about it.
    if (nextUser) {
      account.session.markRestored()
    }

    setUser(nextUser)
    setStatus(nextUser ? 'signed-in' : 'signed-out')
    // The renewal layer's verdict; see `reasonFromSession` for why it alone is not an expiry.
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

  // Retry only while `loading`: it is the one state with nothing to hold and no other way out.
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

  // Adopt a sign-in performed by another consumer of this hook. Not scoped to a
  // status: the account that signed in may not be the one this consumer shows.
  useEffect(() => {
    if (!active || !account) {
      return
    }

    return account.session.onRestored(() => {
      void refresh()
    })
  }, [active, account, refresh])

  // The OAuth flow finishes in another tab: regaining focus is the only signal, and the only way the sign-in
  // gate closes afterwards.
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
      // In `finally`: the user asked to leave, so the UI reaches signed-out even if the request throws.
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
