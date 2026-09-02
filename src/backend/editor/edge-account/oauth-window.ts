/**
 * Provider sign-in (Google / Microsoft / Apple) for the desktop editor.
 *
 * WHY A WINDOW WE OWN, AND NOT THE SYSTEM BROWSER. Edge's OAuth callback hands the
 * session over as `httpOnly` cookies scoped to `COOKIE_DOMAIN`, then redirects to a
 * URL whose origin must match the server's `EDITOR_URL`. Nothing about the tokens
 * travels in the redirect. So the standard native-app pattern — system browser plus a
 * loopback listener — has nothing to catch: the tokens land in a cookie jar this
 * process cannot read, inside a browser it does not control. Driving the flow in a
 * `BrowserWindow` we own makes the jar ours, and Electron's cookie API reads
 * `httpOnly` values.
 *
 * KNOWN LIMIT, READ THIS BEFORE DEBUGGING A FAILURE. Google's policy refuses OAuth in
 * embedded browsers and can answer `disallowed_useragent` instead of a consent
 * screen. The desktop-Chrome user agent below is what makes it work in practice, but
 * it is a heuristic against a policy, not a contract. The durable fix is server-side:
 * an Edge endpoint that exchanges a one-time code for tokens, which would let this run
 * in the real system browser the way RFC 8252 intends. That change belongs to
 * autonomy-edge; until it exists, this is the only route that works from here.
 *
 * A FRESH PARTITION PER ATTEMPT is not a detail. Reusing one keeps the previous Google
 * account signed in inside the window, so a user who picked the wrong account could
 * never pick another — the next attempt would skip the chooser and hand back the same
 * identity, which reads as the app ignoring them.
 */

import { BrowserWindow, session } from 'electron'

import type { EdgeOAuthProviderId } from '../../../middleware/shared/ports/edge-account-port'
import { getEdgeApiBaseUrl } from './edge-http'

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

/**
 * Recognise a provider sign-in link the renderer asked to open.
 *
 * Matched on PATH ONLY, deliberately, not on origin. The shared sign-in dialog builds
 * its provider links from the Edge WEB origin, because that is the only Edge URL a
 * renderer bundle knows; the real endpoint is on the API origin, which is a
 * main-process env var. Rather than plumb that into the bundle, the renderer's URL is
 * treated as a statement of intent — "start a Google sign-in" — and this process builds
 * the actual request from its own configuration. Matching on origin would force the two
 * to agree about something only one of them can know.
 *
 * Returns null for everything else, which keeps ordinary links going to the system
 * browser.
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
 * Where a provider flow starts.
 *
 * `state=editor` is the marker Edge's callback reads to know which app began the
 * flow. It sends the browser to the server's own `EDITOR_URL` afterwards, which on a
 * desktop install is a page we neither need nor can reach — irrelevant, because the
 * cookies are set by the response that issues that redirect, and we read them from
 * our own jar rather than from wherever it points.
 */
function providerUrl(provider: EdgeOAuthProviderId): string {
  return `${getEdgeApiBaseUrl()}/auth/${provider}?state=editor`
}

/**
 * Run a provider flow to completion.
 *
 * Resolves once the session cookies appear in our partition, when the user closes the
 * window, or on timeout. Never rejects: every outcome is one the caller has to render,
 * not an exception to propagate.
 */
export function runOAuthFlow(provider: EdgeOAuthProviderId): Promise<OAuthFlowResult> {
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
        // This window renders a third party's login page. It gets no bridge, no Node
        // and no access to anything of ours: it exists only to let the provider talk
        // to Edge.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    win.setMenuBarVisibility(false)

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
     * Look for the session in our jar.
     *
     * Polled on every navigation rather than matched against an expected URL: the
     * redirect target is the server's `EDITOR_URL`, which this process has no way to
     * know. The cookies appearing IS the completion signal, and a more honest one
     * than a URL guess.
     */
    const checkForSession = async () => {
      if (settled) {
        return
      }

      try {
        const cookies = await oauthSession.cookies.get({})
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

    // Any of these can be the moment the cookies land — `did-fail-load` included, and
    // that one matters: the callback redirects to EDITOR_URL, which on a desktop
    // install is often unreachable. The redirect failing to load is irrelevant, since
    // the cookies were set by the response that issued it.
    win.webContents.on('did-navigate', () => void checkForSession())
    win.webContents.on('did-redirect-navigation', () => void checkForSession())
    win.webContents.on('did-finish-load', () => void checkForSession())
    win.webContents.on('did-fail-load', () => void checkForSession())

    // Edge sends a failed flow to the editor's `/unauthorized?reason=oauth_failed`.
    // Recognising it lets the user see a real message instead of a window that sits
    // there until the timeout.
    win.webContents.on('will-navigate', (_event, url) => {
      if (url.includes('reason=oauth_failed')) {
        finish({ status: 'failed', reason: 'provider-declined' })
      }
    })

    win.on('closed', () => {
      finish({ status: 'cancelled' })
    })

    win.loadURL(providerUrl(provider), { userAgent: DESKTOP_USER_AGENT }).catch(() => {
      finish({ status: 'failed', reason: 'could-not-open-provider' })
    })
  })
}
