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
   * `isUnauthorized` lets the caller classify its own transport's result shape
   * (HTTP 401/403, etc.) without this module knowing the transport.
   */
  withAuth<T>(operation: (token: string) => Promise<T>, isUnauthorized: (result: T) => boolean): Promise<T>
  /**
   * Subscribe to token changes (every successful refresh). Returns an
   * unsubscribe function. Used to keep mirrors (e.g. the store connection flag)
   * in sync.
   */
  onTokenChanged(callback: (newToken: string) => void): () => void
}

export function createRuntimeTokenManager(transport: TokenLoginTransport): RuntimeTokenManager {
  let token: string | null = null
  let credentials: RuntimeCredentials | null = null
  let refreshInFlight: Promise<boolean> | null = null
  const subscribers = new Set<(newToken: string) => void>()

  function getToken(): string | null {
    return token
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

  function refresh(): Promise<boolean> {
    // Single-flight: a second caller that arrives while a re-login is in
    // progress joins the same promise instead of firing another login.
    if (refreshInFlight) return refreshInFlight
    if (!credentials) return Promise.resolve(false)

    const pending = transport
      .login(credentials)
      .then((result) => {
        if (result.success && result.token) {
          token = result.token
          const fresh = result.token
          subscribers.forEach((cb) => cb(fresh))
          return true
        }
        return false
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })

    refreshInFlight = pending
    return pending
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

  return { getToken, hasToken, setSession, clear, refresh, withAuth, onTokenChanged }
}
