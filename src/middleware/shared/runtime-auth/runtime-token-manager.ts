/**
 * RuntimeTokenManager — the single, platform-agnostic authority for a runtime
 * session's JWT.
 *
 * The OpenPLC runtime issues short-lived access tokens (≈15 min) with no
 * server-side sliding expiration, so a long-but-active session will otherwise
 * have its token age out mid-use. Historically each call path (status polling,
 * start/stop, project upload, EtherCAT) tracked and refreshed the token on its
 * own — or not at all — which is why stats could keep working while an upload
 * silently 401'd. This manager centralizes all of that so every runtime call
 * shares one token, one credential set, and one refresh path.
 *
 * It is intentionally dependency-free pure TS: the same code runs in the web
 * renderer adapter AND in the editor's Electron main process. Only the
 * `login` transport differs per platform (orchestrator POST vs. direct HTTPS),
 * which is injected.
 *
 * Behavior must be IDENTICAL on both platforms — this file is part of the
 * byte-identical shared surface between openplc-web and openplc-editor.
 */

export interface RuntimeCredentials {
  username: string
  password: string
}

export interface TokenLoginResult {
  success: boolean
  token?: string
  error?: string
  /** HTTP status of the runtime's reply, when it replied. 401 means it refused the credentials. */
  statusCode?: number
}

/** Credentials an own-account change replaces; absent fields keep their current value. */
export interface RuntimeCredentialChange {
  username?: string
  password?: string
}

export interface TokenLoginTransport {
  /**
   * Platform-specific authentication: POST the credentials to the runtime and
   * resolve with a fresh access token. The manager calls this for the initial
   * refresh wiring and for every re-authentication; it never inspects how the
   * request is transported.
   */
  login(credentials: RuntimeCredentials): Promise<TokenLoginResult>
}

export interface RuntimeTokenManager {
  /** The current access token, or null when not authenticated. */
  getToken(): string | null
  /** Whether a usable token is currently held. */
  hasToken(): boolean
  /** Username of the live session, or null when there is none.
   *
   *  Only the username: the password stays private to this module. Callers
   *  want it to attribute an action to an account -- the project snapshot
   *  records who uploaded -- not to authenticate with it. */
  getUsername(): string | null
  /** Adopt a token + the credentials that produced it (called on login). */
  setSession(token: string, credentials: RuntimeCredentials): void
  /** Forget the token and credentials (called on logout). */
  clear(): void
  /**
   * Re-authenticate with the stored credentials and adopt the fresh token.
   * Resolves false when there is nothing to re-authenticate with or the runtime
   * rejects the re-login. Concurrent calls share a single in-flight request
   * (single-flight) so a burst of expired calls triggers exactly one re-login.
   */
  refresh(): Promise<boolean>
  /**
   * Run an authenticated operation with the current token. If the result is
   * unauthorized, refresh once and retry exactly once with the new token.
   * `isUnauthorized` lets the caller classify its own transport's result shape;
   * it should match only an expired or revoked token (`isSessionExpiredStatus`).
   */
  withAuth<T>(operation: (token: string) => Promise<T>, isUnauthorized: (result: T) => boolean): Promise<T>
  /**
   * Subscribe to token changes (every successful refresh). Returns an
   * unsubscribe function. Used to keep mirrors (e.g. the store connection flag)
   * in sync.
   */
  onTokenChanged(callback: (newToken: string) => void): () => void
  /**
   * Subscribe to the end of the session: a re-authentication the runtime refused (401), as when the account was
   * deleted or its password changed elsewhere. The token and credentials are forgotten first.
   */
  onSessionEnded(callback: () => void): () => void
  /**
   * Run a change to the signed-in account with the current token, re-authenticating and retrying once when the
   * result is unauthorized. On success adopt the changed credentials and, when the password changed, sign in again
   * with them. A refresh requested meanwhile waits for the change to settle and then signs in once, with the
   * credentials in force afterwards.
   */
  changeOwnCredentials<T>(
    change: RuntimeCredentialChange,
    operation: (token: string) => Promise<T>,
    isUnauthorized: (result: T) => boolean,
    succeeded: (result: T) => boolean,
  ): Promise<T>
}

/** Whether a runtime reply means the token expired or was revoked. Any other refusal, 403 included, is final. */
export function isSessionExpiredStatus(statusCode: number | undefined): boolean {
  return statusCode === 401
}

export function createRuntimeTokenManager(transport: TokenLoginTransport): RuntimeTokenManager {
  let token: string | null = null
  let credentials: RuntimeCredentials | null = null
  let refreshInFlight: Promise<boolean> | null = null
  let loginInFlight: Promise<boolean> | null = null
  let changesInFlight = 0
  let changeChain: Promise<void> = Promise.resolve()
  const subscribers = new Set<(newToken: string) => void>()
  const sessionEndedSubscribers = new Set<() => void>()

  function getToken(): string | null {
    return token
  }

  function getUsername(): string | null {
    return credentials?.username ?? null
  }

  function hasToken(): boolean {
    return token !== null && token !== ''
  }

  function setSession(newToken: string, newCredentials: RuntimeCredentials): void {
    token = newToken
    credentials = newCredentials
  }

  function clear(): void {
    token = null
    credentials = null
  }

  function adoptToken(fresh: string): void {
    token = fresh
    subscribers.forEach((cb) => cb(fresh))
  }

  function endSession(): void {
    clear()
    sessionEndedSubscribers.forEach((cb) => cb())
  }

  async function reauthenticate(current: RuntimeCredentials): Promise<boolean> {
    const result = await transport.login(current)
    if (credentials !== current) return false
    if (result.success && result.token) {
      adoptToken(result.token)
      return true
    }
    if (result.statusCode === 401) endSession()
    return false
  }

  /** One sign-in with the credentials in force now; concurrent callers share it. */
  function signIn(): Promise<boolean> {
    if (loginInFlight) return loginInFlight
    const current = credentials
    if (!current) return Promise.resolve(false)
    const pending = reauthenticate(current)
      .catch(() => false)
      .finally(() => {
        loginInFlight = null
      })
    loginInFlight = pending
    return pending
  }

  async function settleChanges(): Promise<void> {
    while (changesInFlight > 0) await changeChain
  }

  function refresh(): Promise<boolean> {
    // Single-flight: a second caller that arrives while a re-login is in
    // progress joins the same promise instead of firing another login.
    if (refreshInFlight) return refreshInFlight
    if (!credentials) return Promise.resolve(false)

    const pending = (changesInFlight > 0 ? settleChanges().then(signIn) : signIn()).finally(() => {
      refreshInFlight = null
    })

    refreshInFlight = pending
    return pending
  }

  async function runChange<T>(
    change: RuntimeCredentialChange,
    operation: (token: string) => Promise<T>,
    isUnauthorized: (result: T) => boolean,
    succeeded: (result: T) => boolean,
  ): Promise<{ result: T; signInAgain: boolean }> {
    const before = credentials
    let result = await operation(token ?? '')
    if (isUnauthorized(result) && (await signIn())) result = await operation(token ?? '')
    if (!succeeded(result) || !before || credentials !== before) return { result, signInAgain: false }
    credentials = { username: change.username ?? before.username, password: change.password ?? before.password }
    return { result, signInAgain: change.password !== undefined }
  }

  async function changeOwnCredentials<T>(
    change: RuntimeCredentialChange,
    operation: (token: string) => Promise<T>,
    isUnauthorized: (result: T) => boolean,
    succeeded: (result: T) => boolean,
  ): Promise<T> {
    changesInFlight += 1
    const run = changeChain.then(() => runChange(change, operation, isUnauthorized, succeeded))
    changeChain = run.then(
      () => {
        changesInFlight -= 1
      },
      () => {
        changesInFlight -= 1
      },
    )
    const { result, signInAgain } = await run
    if (signInAgain) await refresh()
    return result
  }

  async function withAuth<T>(
    operation: (token: string) => Promise<T>,
    isUnauthorized: (result: T) => boolean,
  ): Promise<T> {
    const result = await operation(token ?? '')
    if (isUnauthorized(result) && (await refresh())) {
      return operation(token ?? '')
    }
    return result
  }

  function onTokenChanged(callback: (newToken: string) => void): () => void {
    subscribers.add(callback)
    return () => {
      subscribers.delete(callback)
    }
  }

  function onSessionEnded(callback: () => void): () => void {
    sessionEndedSubscribers.add(callback)
    return () => {
      sessionEndedSubscribers.delete(callback)
    }
  }

  return {
    getToken,
    getUsername,
    hasToken,
    setSession,
    clear,
    refresh,
    withAuth,
    onTokenChanged,
    onSessionEnded,
    changeOwnCredentials,
  }
}
