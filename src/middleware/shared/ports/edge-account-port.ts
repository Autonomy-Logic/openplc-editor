/**
 * The Autonomy Edge account, as the frontend is allowed to see it.
 *
 * The account UI — the avatar, the menu, the sign-in dialog — needs to ask who is
 * signed in, sign someone in or out, and know where Edge's own pages live. All of
 * that is adapter knowledge: it speaks to a specific API over cookies on a shared
 * parent domain, and only the web build has it at all.
 *
 * This port is what keeps that knowledge out of `frontend/`. The components used to
 * import `adapters/web/services/edge-account` directly, which the architecture
 * validator forbids for good reason: `frontend/` is a surface mirrored into the
 * desktop editor, and a direct adapter import compiles that app against an API it
 * does not talk to.
 *
 * OPTIONAL on `PlatformPorts`, like `ai` and `esi`: a platform may have no Edge
 * account at all (the autonomy-node build talks to its own API). Gate on
 * `capabilities.hasEdgeAccount`, not on the port being present.
 *
 * Both editors implement it, over different transports: the web build authenticates by
 * the cookie Edge leaves on a shared parent domain, while the desktop holds its own
 * tokens because its renderer is not on that domain.
 */

/** Mirrors Edge's `UserProfile`, narrowed to what the account UI renders. */
export interface EdgeUser {
  id: string
  name: string
  email: string
  username: string
  profileImage?: string | null
  customInitials?: string | null
  initialsColor?: string | null
  emailVerifiedAt?: string | null
}

/**
 * What asking "who is signed in?" actually established.
 *
 * `unknown` is the whole reason this is not just `EdgeUser | null`. A request that
 * never reached the server says NOTHING about whether a session exists, and
 * collapsing it into "nobody is signed in" put a blocking sign-in dialog over a
 * perfectly valid session every time the network blipped for a second — over an
 * editor holding unsaved work, with no way out until the window happened to be
 * refocused. The caller has to be able to tell the two apart and hold its ground.
 */
export type EdgeUserRead =
  | { status: 'signed-in'; user: EdgeUser }
  /** The server answered, and there is no usable session. */
  | { status: 'no-session' }
  /** The question could not be asked — offline, DNS, CORS, a dropped connection. */
  | { status: 'unknown' }

export type EdgeSignInOutcome =
  | { status: 'signed-in'; user: EdgeUser }
  /**
   * Credentials were right but the address is unverified. Edge answers 200 with
   * null tokens for this — NOT an error — so reporting it as a failed sign-in
   * would send the user hunting for a wrong password.
   */
  | { status: 'email-unverified'; email: string }
  | { status: 'invalid-credentials' }
  | { status: 'failed' }

/** The providers Edge itself offers. */
export type EdgeOAuthProviderId = 'google' | 'microsoft' | 'apple'

export interface EdgeOAuthProvider {
  id: EdgeOAuthProviderId
  label: string
}

/**
 * Why a renewal failed, when one did.
 *
 * `expired` and `no-session` are both 401s from the same endpoint, and telling
 * them apart is what stops a stranger who followed a shared project link being
 * told that *their* session ended.
 */
export interface EdgeSessionState {
  /** True once a renewal has definitively failed. */
  isExpired(): boolean
  /** True when the last failure found no session to renew, rather than a dead one. */
  isAbsent(): boolean
  /** Fires when the session is gone for good. Returns an unsubscribe function. */
  onExpired(listener: () => void): () => void
  /** Fires when a session that HAD died works again. Returns an unsubscribe function. */
  onRestored(listener: () => void): () => void
  /**
   * Announce that the session works again. A no-op unless something was
   * previously announced dead, so it is safe to call on any healthy read — which
   * is the point: a provider flow completes in another tab, and the only way this
   * one finds out is by observing a request succeed.
   */
  markRestored(): void
}

export interface EdgeAccountPort {
  /** Origin of the Edge SPA, for the pages the editor links out to. */
  frontendBaseUrl: string
  oauthProviders: readonly EdgeOAuthProvider[]
  /**
   * Where to send the browser to start a provider flow.
   *
   * `returnTo` is carried through the provider and back, so the round trip lands
   * on the app that started it rather than on Edge.
   */
  oauthUrl(provider: EdgeOAuthProviderId, returnTo: string): string
  /**
   * Who is signed in — and, when that could not be established, the fact that it
   * could not be. See `EdgeUserRead`: a network failure is not a signed-out user.
   */
  fetchUser(): Promise<EdgeUserRead>
  /** e.g. `Pro Plan`; null when the account has no active subscription. */
  fetchPlanCaption(): Promise<string | null>
  signIn(email: string, password: string): Promise<EdgeSignInOutcome>
  signOut(): Promise<void>
  session: EdgeSessionState
}
