import { useCallback, useEffect, useState } from 'react'

import type { EdgeAccountPort, EdgeUser } from '../../middleware/shared/ports/edge-account-port'

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

  const refresh = useCallback(async () => {
    if (!active || !account) {
      return
    }

    const nextUser = await account.fetchUser()

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
    // `isEdgeSessionExpired` is the renewal layer's own verdict, so a refresh that
    // finds nobody signed in still knows whether a session died to get here — the
    // case where /auth/me 401s and the renewal behind it gave up.
    setSignedOutReason(!nextUser && account.session.isExpired() ? 'expired' : 'signed-out')

    // Only worth asking once we know someone is signed in, and it must not gate
    // the menu appearing: the caption is decoration next to the name.
    setPlanCaption(nextUser ? await account.fetchPlanCaption() : null)
  }, [active, account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // The renewal layer already knows when a session is beyond saving; reusing its
  // signal keeps the menu from showing a user who can no longer save anything.
  useEffect(() => {
    if (!active || !account) {
      return
    }

    return account.session.onExpired(() => {
      setUser(null)
      setPlanCaption(null)
      setStatus('signed-out')
      setSignedOutReason('expired')
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
