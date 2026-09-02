/**
 * `EdgeAccountPort` for the desktop editor.
 *
 * Every call crosses to the main process, because the desktop holds its own session:
 * the renderer is not on Edge's origin, so it can neither inherit the shared-domain
 * cookie the web editor authenticates with nor issue the request itself. The main
 * process owns the tokens, the renewal and the encrypted storage; this is the
 * renderer's view of it.
 *
 * WHY THE SESSION STATE MACHINE LIVES HERE. On the web it belongs to the
 * fetch-with-renewal layer, which is the thing that learns a session died. Here that
 * layer is in the main process, so the renderer never observes a renewal failing.
 * What it does observe is the ANSWER to "who is signed in", and that is enough to
 * drive the same state: a definitive `no-session` after a live one is an expiry, and
 * a `signed-in` read is a restoration. Deriving it from the outcomes this adapter
 * already returns keeps one source of truth, instead of a second channel for the main
 * process to push events over.
 *
 * SIGNING IN IS OPTIONAL. Nothing here runs unless the user asks. The editor opens,
 * loads local projects and works offline with this file never touched.
 */

import type {
  EdgeAccountPort,
  EdgeOAuthProviderId,
  EdgeSessionState,
  EdgeSignInOutcome,
  EdgeUserRead,
} from '../../shared/ports/edge-account-port'
import { getEdgeWebUrl } from './system-adapter'

/** The providers Edge offers, in the order its own sign-in screen lists them. */
const EDGE_OAUTH_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'apple', label: 'Apple' },
] as const

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** True once a session has been observed to be gone for good. */
let expired = false

/**
 * True while no session has been seen on this run.
 *
 * Kept apart from `expired` because the two are worded differently to the user and
 * conflating them is a real bug: telling someone who never signed in that "your
 * session has expired" is a claim about a session they never had. It is also what
 * separates a deliberate sign-out from an expiry.
 */
let absent = true

const expiryListeners = new Set<() => void>()
const restoredListeners = new Set<() => void>()

/**
 * Notify a listener set.
 *
 * Snapshotted before iterating. A listener may subscribe again while being notified —
 * the interrupted-save queue does exactly that when its replay fails a second time —
 * and a `Set` grown during `for..of` keeps handing out the newly added entries, which
 * turns re-registration into an unbounded loop.
 */
function notify(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

/** Record that the session is gone, and whether there was one to lose. */
function markGone(neverHadOne: boolean): void {
  const wasAlive = !expired

  expired = true
  absent = neverHadOne

  // Only announce a transition. Firing on every failed read would replay the expiry
  // handler on each poll.
  if (wasAlive) {
    notify(expiryListeners)
  }
}

const session: EdgeSessionState = {
  isExpired: () => expired,
  isAbsent: () => absent,

  onExpired(listener) {
    expiryListeners.add(listener)

    return () => expiryListeners.delete(listener)
  },

  onRestored(listener) {
    restoredListeners.add(listener)

    return () => restoredListeners.delete(listener)
  },

  /**
   * Record that the session demonstrably works. Safe to call on any healthy read.
   *
   * `absent` is cleared unconditionally, and that is load-bearing rather than
   * defensive: it means "no session has been seen", so observing a live one has to
   * retire it even when nothing was announced dead. Otherwise the initial `true`
   * survives a successful read and the NEXT expiry gets worded as "you were never
   * signed in" to someone who demonstrably was. Only the ANNOUNCEMENT is conditional,
   * because listeners care about the transition.
   */
  markRestored() {
    const wasDead = expired

    expired = false
    absent = false

    if (wasDead) {
      notify(restoredListeners)
    }
  },
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export const editorEdgeAccountPort: EdgeAccountPort = {
  get frontendBaseUrl() {
    // A getter, not a captured value: the URL comes from a build-time override, and
    // freezing it at module load would pin whatever was configured at import time.
    return getEdgeWebUrl()
  },

  oauthProviders: EDGE_OAUTH_PROVIDERS,

  /**
   * Where the shared sign-in dialog points its provider links.
   *
   * The desktop never actually follows this. The dialog renders each provider as a
   * `target='_blank'` link, and the main process intercepts that window-open: a browser
   * tab's cookie jar is not ours to read, so the flow runs in a window we own instead
   * (`main.ts` → `oauth-window.ts`). The URL is therefore a statement of intent, and
   * the interception matches on its PATH — which is why building it from the web origin
   * here is harmless, and why the renderer never needs to know the API origin.
   */
  oauthUrl(provider: EdgeOAuthProviderId, returnTo: string): string {
    return `${getEdgeWebUrl()}/auth/${provider}?${new URLSearchParams({ state: returnTo }).toString()}`
  },

  async fetchUser(): Promise<EdgeUserRead> {
    let read: EdgeUserRead

    try {
      read = await window.bridge.edgeAccountFetchUser()
    } catch {
      // An IPC call that threw tells us nothing about the session — the same standing
      // as a network failure, and the caller must be able to hold its ground.
      return { status: 'unknown' }
    }

    if (read.status === 'signed-in') {
      session.markRestored()

      return read
    }

    if (read.status === 'no-session') {
      markGone(absent)
    }

    // `unknown` deliberately changes nothing: a request that never reached the server
    // is not evidence that the session ended.
    return read
  },

  fetchPlanCaption(): Promise<string | null> {
    // A caption is decoration beside the account name; a failure must not take the
    // menu down with it.
    return window.bridge.edgeAccountFetchPlanCaption().catch(() => null)
  },

  async signIn(email: string, password: string): Promise<EdgeSignInOutcome> {
    let outcome: EdgeSignInOutcome

    try {
      outcome = await window.bridge.edgeAccountSignIn(email, password)
    } catch {
      return { status: 'failed' }
    }

    if (outcome.status === 'signed-in') {
      // Announced here rather than left for the next read to discover, so a save that
      // died with the old session can run itself again immediately.
      session.markRestored()
    }

    return outcome
  },

  async signOut(): Promise<void> {
    try {
      await window.bridge.edgeAccountSignOut()
    } catch {
      // The local session ends regardless: someone who asked to sign out must end up
      // signed out even if the request never landed.
    }

    // Absent, not expired: this was a deliberate departure, and wording it as an
    // expiry would tell the user something untrue about their session.
    expired = true
    absent = true
    notify(expiryListeners)
  },

  session,
}

/**
 * Whether a session on this machine survives a restart.
 *
 * False on a Linux box with no keyring, where the refresh token is deliberately not
 * written to disk. Worth telling the user, because "you will have to sign in again
 * next time" is surprising otherwise.
 */
export function isSessionPersistent(): Promise<boolean> {
  return window.bridge.edgeAccountIsSessionPersistent().catch(() => false)
}

/** Test seam: return the module to its just-loaded state. */
export function __resetEdgeSessionForTests(): void {
  expired = false
  absent = true
  expiryListeners.clear()
  restoredListeners.clear()
}
