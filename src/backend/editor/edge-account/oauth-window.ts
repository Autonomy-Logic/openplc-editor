/**
 * Provider sign-in (Google / Microsoft / Apple) for the desktop editor. Runs in an
 * owned `BrowserWindow`, not the system browser, so Electron's cookie API can read
 * Edge's `httpOnly` session cookies; each attempt gets a fresh partition so picking
 * the wrong account doesn't stick for the next attempt.
 */

import { BrowserWindow, session } from 'electron'

import type { EdgeOAuthProviderId } from '../../../middleware/shared/ports/edge-account-port'
import { assertTransportIsConfidential, getEdgeApiBaseUrl } from './edge-http'

/**
 * A current desktop Chrome UA. Electron's default advertises `Electron/x.y` and the
 * app name, which is precisely what embedded-browser detection looks for.
 */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * Long enough for a real person to find a password, pick an account and clear a
 * two-factor prompt. Anything tighter closes the window under someone mid-flow.
 */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000

export type OAuthFlowResult =
  | { status: 'tokens'; accessToken: string; refreshToken: string }
  /** The user closed the window. Not an error, and nothing to report to them. */
  | { status: 'cancelled' }
  /** The flow ran and produced no session. */
  | { status: 'failed'; reason?: string }

/** The providers, as they appear in Edge's own `/auth/{provider}` routes. */
const PROVIDER_IDS: readonly EdgeOAuthProviderId[] = ['google', 'microsoft', 'apple']

/** Where each provider's sign-in may legitimately take the window; kept narrow since a host too many lets a provider page navigate the window anywhere. */
const PROVIDER_HOSTS: Record<EdgeOAuthProviderId, readonly string[]> = {
  google: ['accounts.google.com', 'accounts.youtube.com'],
  microsoft: ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'account.live.com'],
  apple: ['appleid.apple.com', 'idmsa.apple.com'],
}

/** Mirrors the renderer's `getEdgeWebUrl` default; restated here since the main process can't import the adapters layer. */
const DEFAULT_EDGE_WEB_URL = 'https://edge.autonomylogic.com'

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The Edge hosts a flow starts on and returns to. */
function edgeHosts(): string[] {
  const web = process.env.OPENPLC_EDGE_WEB_URL?.trim()

  return [getEdgeApiBaseUrl(), web && web.length > 0 ? web : DEFAULT_EDGE_WEB_URL].flatMap((url) => {
    const host = hostnameOf(url)

    return host ? [host] : []
  })
}

function isHostOrSubdomain(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`)
}

/**
 * Whether the sign-in window may follow a navigation to `url`. Only Edge's own hosts
 * and the provider's are allowed, since the window renders third-party pages under a spoofed UA.
 */
export function isAllowedOAuthNavigation(url: string, provider: EdgeOAuthProviderId): boolean {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false
  }

  const hostname = parsed.hostname.toLowerCase()

  return (
    edgeHosts().some((host) => hostname === host) ||
    PROVIDER_HOSTS[provider].some((host) => isHostOrSubdomain(hostname, host))
  )
}

/** Whether a cookie was set for Edge's host (itself or a parent domain), as opposed to a provider's or another site's. */
export function cookieBelongsToEdge(cookieDomain: string | undefined, edgeHost: string): boolean {
  if (!cookieDomain) {
    return false
  }

  return isHostOrSubdomain(edgeHost.toLowerCase(), cookieDomain.replace(/^\./, '').toLowerCase())
}

/**
 * Recognises a provider sign-in link by path only, not origin: the renderer only knows
 * the Edge WEB origin, while the real endpoint lives on the API origin (a main-process
 * env var). Returns null for anything else, which falls through to the system browser.
 */
export function edgeOAuthProviderFromUrl(url: string): EdgeOAuthProviderId | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')

    return PROVIDER_IDS.find((provider) => path === `/auth/${provider}`) ?? null
  } catch {
    return null
  }
}

/**
 * Where a provider flow starts. `state=editor` marks the app for Edge's callback; the
 * post-auth redirect target is irrelevant since cookies are read from our own jar, not
 * from wherever it points.
 */
function providerUrl(provider: EdgeOAuthProviderId): string {
  const url = new URL(`${getEdgeApiBaseUrl()}/auth/${provider}?state=editor`)

  // The callback sets the session cookies on this origin; over cleartext to a remote
  // host they would be readable on the path, exactly like a password would.
  assertTransportIsConfidential(url)

  return url.toString()
}

/**
 * Runs a provider flow to completion. Never rejects — resolves once session cookies
 * appear in our partition, the user closes the window, or on timeout.
 */
export function runOAuthFlow(provider: EdgeOAuthProviderId): Promise<OAuthFlowResult> {
  let startUrl: string

  try {
    startUrl = providerUrl(provider)
  } catch (error) {
    // Refused before a window exists: nothing to show, nothing to clean up.
    return Promise.resolve({ status: 'failed', reason: error instanceof Error ? error.message : 'invalid-api-url' })
  }

  return new Promise((resolve) => {
    // Unique per attempt, and without the `persist:` prefix so it dies with the
    // window rather than remembering the provider account.
    const partition = `edge-oauth-${provider}-${process.hrtime.bigint().toString(36)}`
    const oauthSession = session.fromPartition(partition)

    oauthSession.setUserAgent(DESKTOP_USER_AGENT)

    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: 'Sign in to Autonomy Edge',
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        // No bridge, no Node, no access to anything of ours — it exists only to let the provider talk to Edge.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    win.setMenuBarVisibility(false)

    // No pop-ups: a provider page that opens a new window would get one this process
    // does not watch, outside every check below.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let settled = false

    const finish = (result: OAuthFlowResult) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      // Destroy rather than close: `close` would run the closed handler below and
      // report a cancellation over the real result.
      if (!win.isDestroyed()) {
        win.destroy()
      }

      void oauthSession.clearStorageData().catch(() => undefined)

      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ status: 'failed', reason: 'timed-out' })
    }, FLOW_TIMEOUT_MS)

    /**
     * Looks for the session in our jar. Polled on every navigation rather than matched
     * against an expected URL, since the redirect target (the server's `EDITOR_URL`)
     * isn't knowable here — the cookies appearing is the completion signal.
     */
    const checkForSession = async () => {
      if (settled) {
        return
      }

      try {
        // Scoped to Edge's own origin — an unscoped read would also sweep up cookies the provider's pages set along the way.
        const edgeHost = new URL(startUrl).hostname
        const cookies = (await oauthSession.cookies.get({ url: startUrl })).filter((cookie) =>
          cookieBelongsToEdge(cookie.domain, edgeHost),
        )
        const refreshToken = cookies.find((cookie) => cookie.name === 'refreshToken')?.value
        const accessToken = cookies.find((cookie) => cookie.name === 'accessToken')?.value

        if (refreshToken && accessToken) {
          finish({ status: 'tokens', accessToken, refreshToken })
        }
      } catch {
        // A jar we could not read is not a completed flow. Wait for the next
        // navigation rather than declaring failure on one bad read.
      }
    }

    // `did-fail-load` matters too: the callback's redirect to EDITOR_URL is often unreachable on desktop, but the cookies were already set by the response that issued it.
    win.webContents.on('did-navigate', () => void checkForSession())
    win.webContents.on('did-redirect-navigation', () => void checkForSession())
    win.webContents.on('did-finish-load', () => void checkForSession())
    win.webContents.on('did-fail-load', () => void checkForSession())

    // Recognises Edge's `/unauthorized?reason=oauth_failed` so the user sees a real
    // message instead of waiting out the timeout; everything else is held to the allowlist.
    win.webContents.on('will-navigate', (event, url) => {
      if (url.includes('reason=oauth_failed')) {
        finish({ status: 'failed', reason: 'provider-declined' })

        return
      }

      if (!isAllowedOAuthNavigation(url, provider)) {
        event.preventDefault()
      }
    })

    win.on('closed', () => {
      finish({ status: 'cancelled' })
    })

    win.loadURL(startUrl, { userAgent: DESKTOP_USER_AGENT }).catch(() => {
      finish({ status: 'failed', reason: 'could-not-open-provider' })
    })
  })
}
