/**
 * Provider sign-in runs in an owned `BrowserWindow`, not the system browser, so
 * Electron's cookie API can read Edge's `httpOnly` session cookies. Each attempt gets
 * a fresh partition so a wrong account doesn't stick for the next one.
 */

import { BrowserWindow, session } from 'electron'

import type { EdgeOAuthProviderId } from '../../../middleware/shared/ports/edge-account-port'
import { assertTransportIsConfidential, getEdgeApiBaseUrl } from './edge-http'

/** Electron's default UA advertises `Electron/x.y` and the app name, which is exactly what provider embedded-browser detection blocks. */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** Long enough for a password, an account picker and a two-factor prompt. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000

export type OAuthFlowResult =
  | { status: 'tokens'; accessToken: string; refreshToken: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason?: string }

const PROVIDER_IDS: readonly EdgeOAuthProviderId[] = ['google', 'microsoft', 'apple']

/** Where a provider's sign-in may legitimately take the window; one host too many lets a provider page navigate it anywhere. */
const PROVIDER_HOSTS: Record<EdgeOAuthProviderId, readonly string[]> = {
  google: ['accounts.google.com', 'accounts.youtube.com'],
  microsoft: ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'account.live.com'],
  apple: ['appleid.apple.com', 'idmsa.apple.com'],
}

/** Mirrors the renderer's `getEdgeWebUrl` default; restated because the main process can't import the adapters layer. */
const DEFAULT_EDGE_WEB_URL = 'https://edge.autonomylogic.com'

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

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

/** Only Edge's own hosts and the provider's are allowed: the window renders third-party pages under a spoofed UA. */
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

/** Matches Edge's host itself or a parent domain of it, as opposed to a provider's or another site's. */
export function cookieBelongsToEdge(cookieDomain: string | undefined, edgeHost: string): boolean {
  if (!cookieDomain) {
    return false
  }

  return isHostOrSubdomain(edgeHost.toLowerCase(), cookieDomain.replace(/^\./, '').toLowerCase())
}

/**
 * Matches by path only, not origin: the renderer knows only the Edge WEB origin, while
 * the real endpoint lives on the API origin (a main-process env var).
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
 * `state=editor` marks the app for Edge's callback. The post-auth redirect target is
 * irrelevant: cookies are read from our own jar, not from wherever it points.
 */
function providerUrl(provider: EdgeOAuthProviderId): string {
  const url = new URL(`${getEdgeApiBaseUrl()}/auth/${provider}?state=editor`)

  // The callback sets session cookies on this origin; over cleartext to a remote host
  // they would be readable on the path, exactly like a password.
  assertTransportIsConfidential(url)

  return url.toString()
}

/** Never rejects: resolves once session cookies appear in our partition, the user closes the window, or on timeout. */
export function runOAuthFlow(provider: EdgeOAuthProviderId): Promise<OAuthFlowResult> {
  let startUrl: string

  try {
    startUrl = providerUrl(provider)
  } catch (error) {
    return Promise.resolve({ status: 'failed', reason: error instanceof Error ? error.message : 'invalid-api-url' })
  }

  return new Promise((resolve) => {
    // Unique per attempt, and without the `persist:` prefix so it dies with the window
    // rather than remembering the provider account.
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
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    win.setMenuBarVisibility(false)

    // A pop-up would be a window this process does not watch, outside every check below.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let settled = false

    const finish = (result: OAuthFlowResult) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)

      // Destroy, not close: `close` runs the closed handler below and would report a
      // cancellation over the real result.
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
     * Polled on every navigation rather than matched against an expected URL: the
     * redirect target isn't knowable here, so the cookies appearing is the signal.
     */
    const checkForSession = async () => {
      if (settled) {
        return
      }

      try {
        // Scoped to Edge's origin; an unscoped read also sweeps up the provider's cookies.
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
        // A jar we could not read is not a completed flow; wait for the next navigation.
      }
    }

    // `did-fail-load` counts: the callback's redirect to EDITOR_URL is often unreachable
    // on desktop, but the response that issued it already set the cookies.
    win.webContents.on('did-navigate', () => void checkForSession())
    win.webContents.on('did-redirect-navigation', () => void checkForSession())
    win.webContents.on('did-finish-load', () => void checkForSession())
    win.webContents.on('did-fail-load', () => void checkForSession())

    // Edge's `/unauthorized?reason=oauth_failed` ends the flow now instead of at the
    // timeout; everything else is held to the allowlist.
    const guardNavigation = (event: { preventDefault: () => void }, url: string) => {
      if (url.includes('reason=oauth_failed')) {
        finish({ status: 'failed', reason: 'provider-declined' })

        return
      }

      if (!isAllowedOAuthNavigation(url, provider)) {
        event.preventDefault()
      }
    }

    win.webContents.on('will-navigate', guardNavigation)
    // Redirects do not raise `will-navigate`, so without this the allowlist would cover
    // only the first hop of a provider's redirect chain.
    win.webContents.on('will-redirect', guardNavigation)

    win.on('closed', () => {
      finish({ status: 'cancelled' })
    })

    win.loadURL(startUrl, { userAgent: DESKTOP_USER_AGENT }).catch(() => {
      finish({ status: 'failed', reason: 'could-not-open-provider' })
    })
  })
}
