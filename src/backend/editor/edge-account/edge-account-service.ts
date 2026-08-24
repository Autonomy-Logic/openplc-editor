/**
 * The desktop editor's Edge session.
 *
 * WHY THE DESKTOP NEEDS ITS OWN. The openplc-web editor authenticates purely by the
 * `httpOnly` cookie Edge leaves on a shared parent domain, and never handles a token
 * itself. The desktop renderer is not on that domain, so there is no cookie to
 * inherit: it has to hold the session. That single fact is why this flow is
 * token-based while the web one is cookie-based, against the same API.
 *
 * WHAT IS HELD WHERE. The refresh token is the durable half, persisted encrypted (see
 * `session-store`). The access token is in memory only.
 *
 * SIGNING IN IS OPTIONAL. Nothing here runs unless the user asks. A session that
 * cannot be restored is not an error: it is the ordinary condition of an editor being
 * used offline, on a local project, by someone who never wanted an account.
 */

import type { EdgeSignInOutcome, EdgeUser, EdgeUserRead } from '../../../middleware/shared/ports/edge-account-port'
import { edgeRequest, parseJsonBody } from './edge-http'
import { clearRefreshToken, readRefreshToken, saveRefreshToken } from './session-store'

/** In-memory access token and the moment it stops being usable. */
let accessToken: string | null = null
let accessTokenExpiresAtMs = 0

/**
 * The one renewal allowed to be in flight.
 *
 * Refresh tokens are single-use and rotate, so two concurrent renewals with the same
 * token race: one rotates and the other presents a superseded value. Edge has a
 * 60-second replay window that makes the loser recover rather than fail, but leaning
 * on it would still mean two round trips and two rotations to serve one need.
 */
let renewal: Promise<boolean> | null = null

/**
 * Renew this far before the token actually dies. Anything tighter turns clock skew
 * between this machine and the server into intermittent 401s.
 */
const RENEW_MARGIN_MS = 60_000

interface TokenPair {
  accessToken?: string | null
  refreshToken?: string | null
}

/** Every successful payload from the API arrives wrapped as `{ data: ... }`. */
interface Envelope<T> {
  data?: T
}

/**
 * Adopt a freshly issued pair.
 *
 * Persisting here rather than at each call site is what keeps rotation honest: the
 * moment the server hands out a successor the old value is dead, and a stored token
 * one rotation behind means the next launch starts with a request that cannot work.
 */
function adoptTokens(pair: TokenPair): boolean {
  if (!pair.accessToken || !pair.refreshToken) {
    return false
  }

  accessToken = pair.accessToken
  accessTokenExpiresAtMs = readJwtExpiryMs(pair.accessToken)
  saveRefreshToken(pair.refreshToken)

  return true
}

/**
 * When a JWT says it expires, in epoch milliseconds.
 *
 * Read from the token rather than assumed from a constant: the lifetime is the
 * server's decision and it has already changed once (24h to 7d, EDGE-602). Falling
 * back to "now" on an unreadable token is the safe direction — it forces a renewal on
 * first use instead of trusting an expiry we could not read.
 */
function readJwtExpiryMs(token: string): number {
  try {
    const payload = token.split('.')[1]

    if (!payload) {
      return Date.now()
    }

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { exp?: number }

    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : Date.now()
  } catch {
    return Date.now()
  }
}

/** Drop every local trace of the session. */
function forgetSession(): void {
  accessToken = null
  accessTokenExpiresAtMs = 0
  clearRefreshToken()
}

/**
 * Exchange the stored refresh token for a new pair.
 *
 * Resolves false when there is nothing to renew with or the server refused. In the
 * refusal case the stored token is dropped, so the next launch does not repeat a
 * request that can only fail.
 *
 * REJECTS on a transport failure, deliberately. Offline is not signed out, and a
 * caller that cannot tell them apart will prompt someone whose session is fine.
 */
async function renewNow(): Promise<boolean> {
  const stored = readRefreshToken()

  if (!stored) {
    return false
  }

  const response = await edgeRequest('/auth/refresh', { method: 'POST', json: { refreshToken: stored } })

  if (response.status === 401 || response.status === 403) {
    // The server has an opinion and it is no: revoked, expired, or replayed past the
    // grace window.
    forgetSession()

    return false
  }

  if (response.status < 200 || response.status >= 300) {
    // A 5xx says nothing about whether the token is valid, so keep it.
    return false
  }

  return adoptTokens(parseJsonBody<Envelope<TokenPair>>(response.body)?.data ?? {})
}

/** Renew, sharing one in-flight attempt across every concurrent caller. */
function renew(): Promise<boolean> {
  renewal ??= renewNow().finally(() => {
    renewal = null
  })

  return renewal
}

/** A usable access token, renewing when the held one is missing or close to expiry. */
async function usableAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < accessTokenExpiresAtMs - RENEW_MARGIN_MS) {
    return accessToken
  }

  return (await renew()) ? accessToken : null
}

/**
 * A request that carries the session, renewing once if the token turns out to be dead
 * despite looking alive.
 *
 * The retry exists because `usableAccessToken` can only reason about expiry. It cannot
 * know the session was revoked from another device, or that the account's tokens were
 * invalidated by a password change — both of which arrive as a 401 on a token whose
 * `exp` is comfortably in the future.
 */
async function authedRequest(path: string): Promise<{ status: number; body: string } | null> {
  const token = await usableAccessToken()

  if (!token) {
    return null
  }

  const first = await edgeRequest(path, { accessToken: token })

  if (first.status !== 401) {
    return first
  }

  if (!(await renew()) || !accessToken) {
    return null
  }

  return edgeRequest(path, { accessToken })
}

// ---------------------------------------------------------------------------
// Public surface — one function per IPC handler
// ---------------------------------------------------------------------------

/**
 * Who is signed in.
 *
 * The three outcomes are not interchangeable, and that is the whole reason
 * `EdgeUserRead` exists: `unknown` means the question could not be asked, and a
 * caller that reads it as `no-session` prompts over a live session on every blip.
 */
export async function fetchUser(): Promise<EdgeUserRead> {
  try {
    const response = await authedRequest('/auth/me')

    if (!response || response.status < 200 || response.status >= 300) {
      return { status: 'no-session' }
    }

    const user = parseJsonBody<Envelope<{ user?: EdgeUser }>>(response.body)?.data?.user

    return user ? { status: 'signed-in', user } : { status: 'no-session' }
  } catch {
    // Never reached the server, so nothing was established either way.
    return { status: 'unknown' }
  }
}

/**
 * The caption under the account name, e.g. `Pro Plan`.
 *
 * Null covers every non-answer: no plan (Edge answers 404 for Community, expired or
 * cancelled), no session, or a failed request. A caption is decoration beside a name
 * and must never take the menu down with it.
 */
export async function fetchPlanCaption(): Promise<string | null> {
  try {
    const response = await authedRequest('/me/subscription')

    if (!response || response.status < 200 || response.status >= 300) {
      return null
    }

    const displayName = parseJsonBody<Envelope<{ plan?: { displayName?: string | null } }>>(response.body)?.data?.plan
      ?.displayName

    // Same wording as Edge's own `contextSwitcher.planLabel`.
    return displayName ? `${displayName} Plan` : null
  } catch {
    return null
  }
}

/** Sign in with an email and password. */
export async function signIn(email: string, password: string): Promise<EdgeSignInOutcome> {
  try {
    const response = await edgeRequest('/auth/signin', { method: 'POST', json: { email, password } })

    if (response.status === 401) {
      return { status: 'invalid-credentials' }
    }

    if (response.status < 200 || response.status >= 300) {
      return { status: 'failed' }
    }

    const payload = parseJsonBody<Envelope<TokenPair & { user?: EdgeUser }>>(response.body)?.data

    // A verified account comes back with tokens; an unverified one comes back with
    // `accessToken: null` and the SAME 200. Reporting that as a failed sign-in sends
    // someone with the right password hunting for a wrong one.
    if (!payload?.accessToken) {
      return { status: 'email-unverified', email }
    }

    if (!adoptTokens(payload)) {
      // A usable access token with nothing to renew it with is half a session: it
      // would die in 7 days with no way back. Better to fail now.
      return { status: 'failed' }
    }

    return await completeSignIn(payload.user)
  } catch {
    return { status: 'failed' }
  }
}

/**
 * Adopt a pair harvested from a provider flow.
 *
 * Separate from `signIn` because a provider flow produces no password and hands its
 * tokens over out of band.
 */
export async function adoptProviderTokens(pair: TokenPair): Promise<EdgeSignInOutcome> {
  if (!adoptTokens(pair)) {
    return { status: 'failed' }
  }

  return completeSignIn(undefined)
}

/**
 * Finish a sign-in by naming the user.
 *
 * Only a positive read will do: `no-session` and `unknown` both mean we cannot say
 * who just signed in, which is a failed sign-in either way. Holding tokens we cannot
 * attribute to anyone would show an account menu with no name in it.
 */
async function completeSignIn(known: EdgeUser | undefined): Promise<EdgeSignInOutcome> {
  if (known) {
    return { status: 'signed-in', user: known }
  }

  const read = await fetchUser()

  if (read.status !== 'signed-in') {
    forgetSession()

    return { status: 'failed' }
  }

  return { status: 'signed-in', user: read.user }
}

/**
 * End the session.
 *
 * Local state is cleared before the request is even attempted. Someone who asked to
 * sign out must end up signed out even with the network down; leaving them looking at
 * an account they just left is the worse outcome, and the server-side token expires
 * on its own regardless.
 */
export async function signOut(): Promise<void> {
  const stored = readRefreshToken()

  forgetSession()

  if (!stored) {
    return
  }

  try {
    await edgeRequest('/auth/logout', { method: 'POST', json: { refreshToken: stored } })
  } catch {
    // The token is the server's to revoke; it expires regardless.
  }
}

/** Whether a session on this machine survives a restart. Surfaced to the UI. */
export { isEncryptionAvailable } from './session-store'

/** Test seam: drop in-memory state without touching what is on disk. */
export function __resetInMemorySessionForTests(): void {
  accessToken = null
  accessTokenExpiresAtMs = 0
  renewal = null
}
