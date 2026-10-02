// Token-based (the desktop renderer has no Edge cookie). Refresh token persisted encrypted; access token in memory.

import { z } from 'zod'

import type { EdgeSignInOutcome, EdgeUser, EdgeUserRead } from '../../../middleware/shared/ports/edge-account-port'
import { logger } from '../services'
import { edgeRequest, parseJsonBodyAs } from './edge-http'
import { clearRefreshToken, readRefreshToken, saveRefreshToken } from './session-store'

let accessToken: string | null = null
let accessTokenExpiresAtMs = 0

// Single-flight: refresh tokens are single-use and rotate, so concurrent renewals race.
let renewal: Promise<boolean> | null = null

// Anything tighter turns clock skew against the server into intermittent 401s.
const RENEW_MARGIN_MS = 60_000

// `accessToken: null` is a real answer (unverified account signs in with a 200 and no tokens).
const TokenPairSchema = z.object({
  accessToken: z.string().nullish(),
  refreshToken: z.string().nullish(),
})

type TokenPair = z.infer<typeof TokenPairSchema>

const EdgeUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string(),
  profileImage: z.string().nullish(),
  customInitials: z.string().nullish(),
  initialsColor: z.string().nullish(),
  emailVerifiedAt: z.string().nullish(),
}) satisfies z.ZodType<EdgeUser>

const envelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) => z.object({ data: data.nullish() })

const RefreshResponseSchema = envelopeOf(TokenPairSchema)

const MeResponseSchema = envelopeOf(z.object({ user: EdgeUserSchema.nullish() }))

const SubscriptionResponseSchema = envelopeOf(
  z.object({ plan: z.object({ displayName: z.string().nullish() }).nullish() }),
)

const SignInResponseSchema = envelopeOf(TokenPairSchema.extend({ user: EdgeUserSchema.nullish() }))

const JwtPayloadSchema = z.object({ exp: z.number().optional() })

// Persists here, not at call sites: a stored token one rotation behind cannot work on next launch.
function adoptTokens(pair: TokenPair): boolean {
  if (!pair.accessToken || !pair.refreshToken) {
    return false
  }

  accessToken = pair.accessToken
  accessTokenExpiresAtMs = readJwtExpiryMs(pair.accessToken)

  const { persisted } = saveRefreshToken(pair.refreshToken)

  if (!persisted) {
    logger.warn(
      'Edge refresh token kept in memory only: the OS keychain is unavailable, so this session will not survive a restart.',
    )
  }

  return true
}

// Lifetime is the server's decision, so read it from the token; an unreadable one expires "now".
function readJwtExpiryMs(token: string): number {
  try {
    const payload = token.split('.')[1]

    if (!payload) {
      return Date.now()
    }

    const decoded = JwtPayloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')))

    return decoded.success && decoded.data.exp !== undefined ? decoded.data.exp * 1000 : Date.now()
  } catch {
    return Date.now()
  }
}

function forgetSession(): void {
  accessToken = null
  accessTokenExpiresAtMs = 0
  clearRefreshToken()
}

// False when nothing to renew with or the server refused; REJECTS on transport failure or 5xx (offline is not signed out).
async function renewNow(): Promise<boolean> {
  const stored = readRefreshToken()

  if (!stored) {
    return false
  }

  const response = await edgeRequest('/auth/refresh', { method: 'POST', json: { refreshToken: stored } })

  if (response.status === 401 || response.status === 403) {
    forgetSession()

    return false
  }

  if (response.status < 200 || response.status >= 300) {
    // Says nothing about the token's validity, so it is kept.
    throw new Error(`Autonomy Edge could not renew the session (answered ${response.status}).`)
  }

  return adoptTokens(parseJsonBodyAs(response.body, RefreshResponseSchema)?.data ?? {})
}

function renew(): Promise<boolean> {
  renewal ??= renewNow().finally(() => {
    renewal = null
  })

  return renewal
}

async function usableAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < accessTokenExpiresAtMs - RENEW_MARGIN_MS) {
    return accessToken
  }

  return (await renew()) ? accessToken : null
}

/** Retried once after a 401. Null means no session; rejects when unreachable. */
export async function edgeAuthedRequest(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
    json?: unknown
    raw?: { body: Buffer; contentType: string }
    timeoutMs?: number
    headers?: Record<string, string>
  } = {},
): Promise<{ status: number; body: string } | null> {
  const token = await usableAccessToken()

  if (!token) {
    return null
  }

  const first = await edgeRequest(path, { ...init, accessToken: token })

  if (first.status !== 401) {
    return first
  }

  if (!(await renew()) || !accessToken) {
    return null
  }

  return edgeRequest(path, { ...init, accessToken })
}

/** The bearer for the streaming transport only; `forceRenewal` is its half of the one 401 retry. */
export async function edgeAccessToken({ forceRenewal = false } = {}): Promise<string | null> {
  if (!forceRenewal) {
    return usableAccessToken()
  }

  return (await renew()) ? accessToken : null
}

/** `unknown` means the question could not be asked; never read it as `no-session`. */
export async function fetchUser(): Promise<EdgeUserRead> {
  try {
    const response = await edgeAuthedRequest('/auth/me')

    if (!response) {
      return { status: 'no-session' }
    }

    // Only 401/403 mean "nobody is signed in"; another non-2xx is the server failing.
    if (response.status === 401 || response.status === 403) {
      return { status: 'no-session' }
    }

    if (response.status < 200 || response.status >= 300) {
      return { status: 'unknown' }
    }

    const user = parseJsonBodyAs(response.body, MeResponseSchema)?.data?.user

    return user ? { status: 'signed-in', user } : { status: 'no-session' }
  } catch {
    return { status: 'unknown' }
  }
}

/** Null for every non-answer; a 404 means no plan. */
export async function fetchPlanCaption(): Promise<string | null> {
  try {
    const response = await edgeAuthedRequest('/me/subscription')

    if (!response || response.status < 200 || response.status >= 300) {
      return null
    }

    const displayName = parseJsonBodyAs(response.body, SubscriptionResponseSchema)?.data?.plan?.displayName

    // Same wording as Edge's own `contextSwitcher.planLabel`.
    return displayName ? `${displayName} Plan` : null
  } catch {
    return null
  }
}

export async function signIn(email: string, password: string): Promise<EdgeSignInOutcome> {
  try {
    const response = await edgeRequest('/auth/signin', { method: 'POST', json: { email, password } })

    if (response.status === 401) {
      return { status: 'invalid-credentials' }
    }

    if (response.status < 200 || response.status >= 300) {
      return { status: 'failed' }
    }

    const payload = parseJsonBodyAs(response.body, SignInResponseSchema)?.data

    // An unverified account comes back with `accessToken: null` and the same 200.
    if (!payload?.accessToken) {
      return { status: 'email-unverified', email }
    }

    if (!adoptTokens(payload)) {
      return { status: 'failed' }
    }

    return await completeSignIn(payload.user ?? undefined)
  } catch {
    return { status: 'failed' }
  }
}

export async function adoptProviderTokens(pair: TokenPair): Promise<EdgeSignInOutcome> {
  if (!adoptTokens(pair)) {
    return { status: 'failed' }
  }

  return completeSignIn(undefined)
}

async function completeSignIn(known: EdgeUser | undefined): Promise<EdgeSignInOutcome> {
  if (known) {
    return { status: 'signed-in', user: known }
  }

  const read = await fetchUser()

  if (read.status === 'signed-in') {
    return { status: 'signed-in', user: read.user }
  }

  // Only a definitive "no session" throws the tokens away; `unknown` keeps them.
  if (read.status === 'no-session') {
    forgetSession()
  }

  return { status: 'failed' }
}

/** Local state is cleared before the request, so sign-out works offline. */
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

export { isEncryptionAvailable } from './session-store'

/** Test seam: drop in-memory state without touching what is on disk. */
export function __resetInMemorySessionForTests(): void {
  accessToken = null
  accessTokenExpiresAtMs = 0
  renewal = null
}
