/**
 * `EdgeAccountPort` for the desktop editor — every call crosses to the main process, which owns
 * the tokens, renewal and encrypted storage; the renderer derives its session state machine from
 * the fetch outcomes this adapter returns, since it never observes a renewal directly.
 */

import type {
  EdgeAccountPort,
  EdgeOAuthProviderId,
  EdgeSessionState,
  EdgeSignInOutcome,
  EdgeUserRead,
} from '../../shared/ports/edge-account-port'
import { EdgeSignInOutcomeSchema, EdgeUserReadSchema } from '../../shared/ports/edge-account-port'
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

// True while no session has been seen on this run. Kept apart from `expired`: telling someone who
// never signed in that "your session expired" is a false claim, and it distinguishes sign-out from expiry.
let absent = true

const expiryListeners = new Set<() => void>()
const restoredListeners = new Set<() => void>()

// Snapshotted before iterating: a listener may resubscribe while being notified, and iterating a
// `Set` that grows during `for..of` would turn that re-registration into an unbounded loop.
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

  // `absent` clears unconditionally (else a later expiry would be misworded as "never signed
  // in"); only the listener announcement is conditional on the dead-to-alive transition.
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
    // A getter, not a captured value: the URL comes from a build-time override, resolved after module load.
    return getEdgeWebUrl()
  },

  oauthProviders: EDGE_OAUTH_PROVIDERS,

  // The desktop never follows this URL: the dialog opens it as a target='_blank' link that the
  // main process intercepts and reopens in its own window (main.ts -> oauth-window.ts), matching on path only.
  oauthUrl(provider: EdgeOAuthProviderId, returnTo: string): string {
    return `${getEdgeWebUrl()}/auth/${provider}?${new URLSearchParams({ state: returnTo }).toString()}`
  },

  async fetchUser(): Promise<EdgeUserRead> {
    let read: EdgeUserRead

    try {
      // Validated at runtime, not just typed: the bridge's declared type checks nothing, and a
      // drifted build's response would otherwise drive the session state machine off garbage.
      const parsed = EdgeUserReadSchema.safeParse(await window.bridge.edgeAccountFetchUser())

      if (!parsed.success) {
        return { status: 'unknown' }
      }

      read = parsed.data
    } catch {
      // A thrown IPC call tells us nothing about the session — same standing as a network failure.
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
      // Same reasoning as `fetchUser`: an unreadable answer must not be allowed to look like a sign-in.
      const parsed = EdgeSignInOutcomeSchema.safeParse(await window.bridge.edgeAccountSignIn(email, password))

      if (!parsed.success) {
        return { status: 'failed' }
      }

      outcome = parsed.data
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

// Whether a session on this machine survives a restart. False on a Linux box with no keyring
// (refresh token deliberately not written to disk) — worth surfacing since it's otherwise surprising.
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
