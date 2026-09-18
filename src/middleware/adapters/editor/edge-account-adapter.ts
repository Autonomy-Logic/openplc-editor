/**
 * The main process owns the tokens, renewal and storage, and the renderer never observes a renewal:
 * the session state machine below is derived entirely from the fetch outcomes these calls return.
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

/** In the order Edge's own sign-in screen lists them. */
const EDGE_OAUTH_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'apple', label: 'Apple' },
] as const

let expired = false

// Kept apart from `expired`: telling someone who never signed in that "your session expired" is a
// false claim.
let absent = true

const expiryListeners = new Set<() => void>()
const restoredListeners = new Set<() => void>()

// Snapshotted before iterating: a listener may resubscribe while being notified, and a `Set` that
// grows during `for..of` would turn that into an unbounded loop.
function notify(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) {
    listener()
  }
}

function markGone(neverHadOne: boolean): void {
  const wasAlive = !expired

  expired = true
  absent = neverHadOne

  // Only announce the transition: firing on every failed read replays the expiry handler each poll.
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

  // `absent` clears unconditionally, else a later expiry reads as "never signed in"; only the
  // announcement is conditional on the dead-to-alive transition.
  markRestored() {
    const wasDead = expired

    expired = false
    absent = false

    if (wasDead) {
      notify(restoredListeners)
    }
  },
}

export const editorEdgeAccountPort: EdgeAccountPort = {
  get frontendBaseUrl() {
    // A getter, not a captured value: the build-time override resolves after module load.
    return getEdgeWebUrl()
  },

  oauthProviders: EDGE_OAUTH_PROVIDERS,

  // The desktop never follows this URL: the dialog opens it as a target='_blank' link the main
  // process intercepts and reopens in its own window, matching on path only.
  oauthUrl(provider: EdgeOAuthProviderId, returnTo: string): string {
    return `${getEdgeWebUrl()}/auth/${provider}?${new URLSearchParams({ state: returnTo }).toString()}`
  },

  async fetchUser(): Promise<EdgeUserRead> {
    let read: EdgeUserRead

    try {
      // Validated at runtime: the bridge's declared type checks nothing, and a drifted build would
      // otherwise drive the session state machine off garbage.
      const parsed = EdgeUserReadSchema.safeParse(await window.bridge.edgeAccountFetchUser())

      if (!parsed.success) {
        return { status: 'unknown' }
      }

      read = parsed.data
    } catch {
      // A thrown IPC call says nothing about the session — same standing as a network failure.
      return { status: 'unknown' }
    }

    if (read.status === 'signed-in') {
      session.markRestored()

      return read
    }

    if (read.status === 'no-session') {
      markGone(absent)
    }

    // `unknown` changes nothing: a request that never reached the server is not evidence of an end.
    return read
  },

  fetchPlanCaption(): Promise<string | null> {
    // Decoration beside the account name: a failure must not take the menu down with it.
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
      // Announced here rather than at the next read, so a save that died with the old session can
      // replay itself immediately.
      session.markRestored()
    }

    return outcome
  },

  async signOut(): Promise<void> {
    try {
      await window.bridge.edgeAccountSignOut()
    } catch {
      // The local session ends regardless: an asked-for sign-out must hold even if it never landed.
    }

    // Absent, not expired: a deliberate departure worded as an expiry tells the user something untrue.
    expired = true
    absent = true
    notify(expiryListeners)
  },

  session,
}

// Whether a session survives a restart. False on a Linux box with no keyring, where the refresh
// token is deliberately not written to disk.
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
