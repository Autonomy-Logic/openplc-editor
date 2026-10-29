import { z } from 'zod'

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

/** `unknown` is not `no-session`: a request that never reached the server says nothing about the session. */
export type EdgeUserRead =
  | { status: 'signed-in'; user: EdgeUser }
  /** The server answered, and there is no usable session. */
  | { status: 'no-session' }
  /** The question could not be asked — offline, DNS, CORS, a dropped connection. */
  | { status: 'unknown' }

export type EdgeSignInOutcome =
  | { status: 'signed-in'; user: EdgeUser }
  /** Credentials were right but the address is unverified; Edge answers 200 with null tokens, not an error. */
  | { status: 'email-unverified'; email: string }
  | { status: 'invalid-credentials' }
  | { status: 'failed' }

/** Runtime check: the desktop's `EdgeUserRead` arrives over IPC, where an annotation establishes nothing. */
export const EdgeUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string(),
  profileImage: z.string().nullish(),
  customInitials: z.string().nullish(),
  initialsColor: z.string().nullish(),
  emailVerifiedAt: z.string().nullish(),
}) satisfies z.ZodType<EdgeUser>

export const EdgeUserReadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed-in'), user: EdgeUserSchema }),
  z.object({ status: z.literal('no-session') }),
  z.object({ status: z.literal('unknown') }),
]) satisfies z.ZodType<EdgeUserRead>

export const EdgeSignInOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed-in'), user: EdgeUserSchema }),
  z.object({ status: z.literal('email-unverified'), email: z.string() }),
  z.object({ status: z.literal('invalid-credentials') }),
  z.object({ status: z.literal('failed') }),
]) satisfies z.ZodType<EdgeSignInOutcome>

/** The providers Edge itself offers. */
export type EdgeOAuthProviderId = 'google' | 'microsoft' | 'apple'

export interface EdgeOAuthProvider {
  id: EdgeOAuthProviderId
  label: string
}

/** `expired` and `no-session` are both 401s from the same endpoint; only one is the user's own session ending. */
export interface EdgeSessionState {
  /** True once a renewal has definitively failed. */
  isExpired(): boolean
  /** True when the last failure found no session to renew, rather than a dead one. */
  isAbsent(): boolean
  /** Fires when the session is gone for good. Returns an unsubscribe function. */
  onExpired(listener: () => void): () => void
  /** Fires when a session that HAD died works again. Returns an unsubscribe function. */
  onRestored(listener: () => void): () => void
  /** No-op unless something was announced dead, so safe on any healthy read. */
  markRestored(): void
}

export interface EdgeAccountPort {
  /** Origin of the Edge SPA, for the pages the editor links out to. */
  frontendBaseUrl: string
  oauthProviders: readonly EdgeOAuthProvider[]
  /** `returnTo` is carried through the provider so the round trip lands on the app that started it. */
  oauthUrl(provider: EdgeOAuthProviderId, returnTo: string): string
  /** See `EdgeUserRead`: a network failure is not a signed-out user. */
  fetchUser(): Promise<EdgeUserRead>
  /** e.g. `Pro Plan`; null when the account has no active subscription. */
  fetchPlanCaption(): Promise<string | null>
  signIn(email: string, password: string): Promise<EdgeSignInOutcome>
  signOut(): Promise<void>
  session: EdgeSessionState
}
