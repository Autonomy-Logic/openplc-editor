/**
 * Re-run a save that died because the Edge session ended.
 *
 * The problem this solves is narrow and specific. A save that fails on an expired
 * session leaves the project dirty in memory and nothing on the server. The user
 * then signs in — the modal is right there — and the save is still not done. The
 * only signal was a toast that had already faded, so the normal outcome was
 * assuming the work was stored and closing the tab.
 *
 * So the save is held here and replayed the moment the session works again. The
 * user does not have to notice anything, which is the point: they never asked for
 * their session to expire, and remembering to save twice is not a reasonable thing
 * to ask of them.
 */

import type { EdgeSessionState } from '../../middleware/shared/ports/edge-account-port'

/**
 * The session signals, handed in at boot.
 *
 * Injected rather than imported: this file lives in `frontend/services`, which the
 * architecture rules forbid from importing an adapter — and rightly so, since the
 * desktop editor mirrors this surface and has no Edge session at all. The web
 * adapter cannot import us either (adapters may not depend on services), so the
 * wiring happens at the composition root (`App.tsx`).
 *
 * Undefined until wired, and on platforms that never wire it. Everything below
 * degrades to "nothing is queued", which is the correct behaviour there.
 */
let session: EdgeSessionState | undefined

export function configureSaveResume(state: EdgeSessionState): void {
  session = state
}

/**
 * Whether the Edge session is known to have failed.
 *
 * Re-exported through this module so `save-actions` can ask without importing the
 * adapter itself — same reasoning as above.
 */
export function isSaveBlockedByEndedSession(): boolean {
  return session?.isExpired() ?? false
}

/**
 * The save waiting for a working session, and how much of the project it covers.
 *
 * Exactly one entry, but "newest wins" is wrong on its own. A project save writes
 * every dirty file, so it supersedes a queued single-file save; a single-file save
 * does NOT supersede a queued project save — letting it would replay one file and
 * leave every other dirty file unwritten, while the toast said the save would
 * finish on its own. Widest scope wins; ties go to the newest.
 */
type SaveScope = 'file' | 'project'

let pending: { run: () => Promise<unknown>; scope: SaveScope } | null = null

/** Live only while something is actually waiting, so an idle editor holds no listener. */
let unsubscribe: (() => void) | null = null

export function resumeSaveAfterEdgeSignIn(run: () => Promise<unknown>, scope: SaveScope = 'project'): void {
  if (!session) {
    return
  }

  // A narrower save never displaces a broader one already waiting.
  if (pending?.scope === 'project' && scope === 'file') {
    return
  }

  // NOT guarded on `session.isExpired()`.
  //
  // There is a narrow window where the session recovers between a save failing
  // and this call, leaving the entry waiting for a restore that already happened.
  // Running immediately instead looks like the fix and is not: a replay that fails
  // again re-registers from inside the restore fan-out, at which point the session
  // is already marked healthy — so "run it now" recurses into the save it was
  // meant to defer. The window is a few microseconds (the caller checks expiry
  // immediately before calling), and losing a queued replay there is strictly
  // better than re-entering the save path.
  pending = { run, scope }

  unsubscribe ??= session.onRestored(() => {
    const queued = pending

    // Cleared BEFORE running: the replay can fail again (the session could die a
    // second time), and it has to be free to register itself afresh rather than
    // being cancelled by this teardown.
    pending = null
    unsubscribe?.()
    unsubscribe = null

    if (queued) {
      void queued.run()
    }
  })
}

/** True while a save is waiting for the session to come back. */
export function hasSaveWaitingForSignIn(): boolean {
  return pending !== null
}

/** Test seam: drop the queued save, the subscription and the wiring between cases. */
export function resetResumeSaveForTests(state?: EdgeSessionState): void {
  pending = null
  unsubscribe?.()
  unsubscribe = null
  session = state
}
